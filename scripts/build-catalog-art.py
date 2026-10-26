#!/usr/bin/env python3
"""Keep pinned full-resolution catalog artwork and a clear gameplay derivative.

Small selection thumbnails are prepared separately. This script never enlarges
an image and never modifies audio or the twelve pre-existing bundled songs.
Requires Pillow; upstream artwork remains attributed to its original artists.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART_SHA = "0c7e90ee5d8ffaaa756d79d8aef879338fdde423"


def sha256(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def file_spec(path, width, height):
    return {"url": "./" + path.relative_to(ROOT).as_posix(),
            "bytes": path.stat().st_size, "sha256": sha256(path),
            "width": width, "height": height}


def prepare(song, source, destination):
    ident = hashlib.sha256(song.encode("utf-8")).hexdigest()[:16]
    original = destination / (ident + "-full.png")
    clear = destination / (ident + "-full-clear.jpg")
    # Copy the actual upstream original; a larger canvas around a small image
    # or an upscale is never a substitute for this file.
    source_hash = sha256(source)
    if not original.exists() or sha256(original) != source_hash:
        shutil.copyfile(source, original)
    with Image.open(source) as image:
        image.load()
        width, height = image.size
        # JPEG is a clearly identified lossy derivative at the original pixel
        # dimensions. Keep the source PNG for export and original-image access.
        if not clear.exists() or clear.stat().st_mtime < original.stat().st_mtime:
            rgb = image.convert("RGB")
            rgb.save(clear, "JPEG", quality=91, progressive=True, optimize=True)
    return song, {
        "original": file_spec(original, width, height),
        "stage2": file_spec(clear, width, height),
        "sourceResolution": "illustration",
        "source": {"repository": "7aGiven/Phigros_Resource", "branch": "illustration",
                   "commit": ART_SHA, "path": source.name, "sha256": source_hash},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artwork", type=Path, required=True)
    parser.add_argument("--music", type=Path, required=True,
                        help="Music filenames define the ordinary song IDs to prepare")
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=3)
    args = parser.parse_args()
    actual = subprocess.check_output(["git", "-C", str(args.artwork), "rev-parse", "HEAD"], text=True).strip()
    if actual != ART_SHA:
        raise SystemExit(f"Unexpected artwork HEAD: {actual}; expected {ART_SHA}")
    app = (ROOT / "js/app.js").read_text()
    packs = json.loads(re.search(r"const BUILTIN_PACKS\s*=\s*(\[.*?\]);", app, re.S)[1])
    existing = {entry.get("audioHash", "").removeprefix("reference-song:") for entry in packs}
    destination = ROOT / "assets/catalog-media"
    destination.mkdir(parents=True, exist_ok=True)
    jobs, missing = [], []
    for music in sorted(args.music.glob("*.ogg")):
        song = music.stem
        if song in existing:
            continue
        image = args.artwork / (song + ".png")
        if not image.exists():
            # Difficulty-specific covers are not silently chosen for every
            # difficulty. Report any absent common cover for explicit handling.
            missing.append({"song": song, "expected": image.name})
            continue
        jobs.append((song, image, destination))
    result, failures = {}, {}
    with ThreadPoolExecutor(max_workers=max(1, min(4, args.jobs))) as executor:
        futures = {executor.submit(prepare, *job): job[0] for job in jobs}
        for future in as_completed(futures):
            song = futures[future]
            try:
                key, item = future.result()
                result[key] = item
            except Exception as error:
                failures[song] = str(error)
            if (len(result) + len(failures)) % 25 == 0:
                print(f"Prepared full artwork {len(result)}/{len(jobs)}; failures {len(failures)}", flush=True)
    args.index.parent.mkdir(parents=True, exist_ok=True)
    args.index.write_text(json.dumps(dict(sorted(result.items())), ensure_ascii=False, indent=2) + "\n")
    args.index.with_suffix(".report.json").write_text(json.dumps({
        "sourceCommit": ART_SHA, "prepared": len(result), "missing": missing,
        "failures": failures, "originalBytes": sum(value["original"]["bytes"] for value in result.values()),
        "clearBytes": sum(value["stage2"]["bytes"] for value in result.values()),
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"Full artwork index: {args.index}; prepared {len(result)}, missing {len(missing)}, failed {len(failures)}", flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
