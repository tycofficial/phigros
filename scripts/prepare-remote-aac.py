#!/usr/bin/env python3
"""Stage existing AAC fallbacks for remote catalog audio without transcoding.

Only the output directory is written. The source catalogs, original OGG assets,
and publishing checkout stay unchanged. Existing matching output files may be
reused; conflicting output files cause an error.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


def read_catalog(path):
    text = path.read_text(encoding="utf-8")
    prefix = "globalThis.PhiFullCatalog="
    if prefix not in text:
        raise ValueError(f"Missing catalog declaration: {path}")
    return json.loads(text.split(prefix, 1)[1].rsplit(";", 1)[0])


def sha256(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def local_asset(root, url):
    if not isinstance(url, str) or not url.startswith("./assets/"):
        raise ValueError(f"Expected a local source asset URL: {url}")
    path = (root / url[2:]).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"Source asset escapes its root: {url}")
    if not path.is_file():
        raise ValueError(f"Missing source asset: {path}")
    return path


def stage(source, destination, expected_bytes, expected_sha256):
    if destination.exists():
        if destination.stat().st_size != expected_bytes or sha256(destination) != expected_sha256:
            raise ValueError(f"Conflicting output asset: {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=destination.name + ".", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        shutil.copyfile(source, temporary)
        if temporary.stat().st_size != expected_bytes or sha256(temporary) != expected_sha256:
            raise ValueError(f"Copied asset failed verification: {destination}")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", type=Path, default=Path("/workspace/phigros"))
    parser.add_argument("--publish", type=Path, default=Path("/workspace/phigros-publish"))
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--expected-count", type=int, default=173)
    args = parser.parse_args()
    full, publish, output = (path.resolve() for path in (args.full, args.publish, args.output))
    if any(output == root or output.is_relative_to(root) for root in (full, publish)):
        raise SystemExit("Output must be outside the full and publishing checkouts")
    source_catalog = read_catalog(full / "js/full-catalog.js")
    published_catalog = read_catalog(publish / "js/full-catalog.js")
    remote_audio = {key: spec for key, spec in published_catalog["audio"].items() if spec.get("remote")}
    if len(remote_audio) != args.expected_count:
        raise SystemExit(f"Expected {args.expected_count} remote tracks, found {len(remote_audio)}")
    assets, safe_ids, jobs = {}, set(), []
    for key, published in sorted(remote_audio.items()):
        source = source_catalog["audio"].get(key)
        if source is None:
            raise ValueError(f"No full catalog audio for: {key}")
        original = source.get("high", {})
        # The asset key alone is insufficient: require the same original audio
        # bytes/hash in both catalogs before associating an AAC derivative.
        for field in ("bytes", "sha256"):
            if not published.get(field) or original.get(field) != published[field]:
                raise ValueError(f"Original OGG {field} mismatch: {key}")
        if published.get("original") != published.get("url"):
            raise ValueError(f"Unexpected published original audio URL: {key}")
        fallback = source.get("lowFallback")
        if not fallback or fallback.get("mime") != "audio/mp4":
            raise ValueError(f"No AAC/MP4 fallback for: {key}")
        source_path = local_asset(full, fallback["url"])
        size = source_path.stat().st_size
        if size != fallback.get("bytes"):
            raise ValueError(f"Source AAC byte length mismatch: {key}")
        digest = sha256(source_path)
        if fallback.get("sha256") and digest != fallback["sha256"]:
            raise ValueError(f"Source AAC SHA256 mismatch: {key}")
        safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", key)
        if safe_id in {"", ".", ".."} or safe_id in safe_ids:
            raise ValueError(f"Unsafe or colliding output ID: {key}")
        safe_ids.add(safe_id)
        relative_path = f"music/{safe_id}.m4a"
        assets[key] = {
            "assetKey": key,
            "path": relative_path,
            "url": "./" + relative_path,
            "bytes": size,
            "sha256": digest,
            "mime": "audio/mp4",
            "duration": published.get("duration"),
            "sourceAAC": {
                "url": fallback["url"], "bytes": size, "sha256": digest,
                "sha256PresentInSource": bool(fallback.get("sha256")),
            },
            "sourceOGG": {field: published[field] for field in ("url", "bytes", "sha256", "mime")},
        }
        jobs.append((source_path, output / relative_path, size, digest))
    # Validate every input before copying any media.
    for job in jobs:
        stage(*job)
    result = {
        "format": "phi-catalog-aac-fallback-v1",
        "complete": True,
        "fileCount": len(assets),
        "totalBytes": sum(asset["bytes"] for asset in assets.values()),
        "sourceCatalogVersion": source_catalog.get("version"),
        "publishedCatalogVersion": published_catalog.get("version"),
        "originalOGGPreserved": True,
        "transcoded": False,
        "assets": assets,
    }
    output.mkdir(parents=True, exist_ok=True)
    index = output / "asset-index.json"
    temporary_index = index.with_suffix(".json.tmp")
    temporary_index.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary_index, index)
    print(f"Verified and staged {result['fileCount']} existing AAC files ({result['totalBytes']:,} bytes).")
    print(f"Index: {index}")


if __name__ == "__main__":
    main()
