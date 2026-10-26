#!/usr/bin/env python3
"""Prepare same-origin, on-demand catalog media from pinned upstream checkouts.

The original OGG is copied byte for byte. Small Opus and AAC variants are
explicitly lossy. illustrationLowRes sources remain identified as low resolution.
Requires ffmpeg, ffprobe and Pillow. Existing bundled songs are omitted.
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
MUSIC_SHA = "5142ba2673ccbeb23173886f3bd851e9c881e6ec"
ART_SHA = "931e2effc5bd2e33d547092afbb1ac012bd15161"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def variant(path, mime=None):
    result = {
        "url": "./" + path.relative_to(ROOT).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }
    if mime:
        result["mime"] = mime
    return result


def transcode(source, dest, *args):
    if dest.exists() and dest.stat().st_size:
        return
    temporary = dest.with_name(dest.stem + ".partial" + dest.suffix)
    try:
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1",
            "-i", str(source), "-map_metadata", "-1", "-vn", "-threads", "1",
            *args, str(temporary),
        ], check=True, capture_output=True)
        temporary.replace(dest)
    finally:
        temporary.unlink(missing_ok=True)


def compact_audio(source, low, fallback):
    opus_args = ["-c:a", "libopus", "-compression_level", "0", "-b:a", "24k", "-vbr", "on", "-ac", "2"]
    aac_args = ["-c:a", "aac", "-aac_coder", "fast", "-b:a", "32k", "-ar", "22050", "-ac", "2", "-movflags", "+faststart"]
    if low.exists() or fallback.exists():
        transcode(source, low, *opus_args)
        transcode(source, fallback, *aac_args)
        return
    # Decode the original once and encode both browser-compatible variants.
    temporary_low = low.with_name(low.stem + ".partial" + low.suffix)
    temporary_fallback = fallback.with_name(fallback.stem + ".partial" + fallback.suffix)
    try:
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1",
            "-i", str(source), "-map_metadata", "-1", "-vn", "-threads", "1",
            *opus_args, str(temporary_low), "-map_metadata", "-1", "-vn", "-threads", "1",
            *aac_args, str(temporary_fallback),
        ], check=True, capture_output=True)
        temporary_low.replace(low)
        temporary_fallback.replace(fallback)
    finally:
        temporary_low.unlink(missing_ok=True)
        temporary_fallback.unlink(missing_ok=True)


def prepare(song, music_path, artwork_path, destination):
    ident = hashlib.sha256(song.encode("utf-8")).hexdigest()[:16]
    original = destination / (ident + ".ogg")
    low = destination / (ident + "-low.ogg")
    fallback = destination / (ident + "-low.m4a")
    if not original.exists():
        shutil.copyfile(music_path, original)
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", str(original),
    ], check=True, capture_output=True, text=True)
    duration = float(json.loads(probe.stdout)["format"]["duration"])
    compact_audio(original, low, fallback)
    high_variant = variant(original, 'audio/ogg; codecs="vorbis"')
    result = {"music": {
        **high_variant, "duration": duration, "original": high_variant["url"],
        "high": high_variant, "low": variant(low, 'audio/ogg; codecs="opus"'),
        "lowFallback": variant(fallback, "audio/mp4"),
    }}
    if artwork_path and artwork_path.exists():
        image_path = destination / (ident + artwork_path.suffix.lower())
        if not image_path.exists():
            shutil.copyfile(artwork_path, image_path)
        stages = []
        with Image.open(artwork_path) as upstream:
            original_image = upstream.convert("RGB")
            for suffix, width, quality in [("tiny", 96, 55), ("medium", 640, 78), ("clear", original_image.width, 91)]:
                output = destination / (ident + "-" + suffix + ".jpg")
                if not output.exists():
                    image = original_image.copy()
                    image.thumbnail((width, width))
                    image.save(output, "JPEG", quality=quality, progressive=True, optimize=True)
                stages.append(variant(output))
        result["artwork"] = {"original": variant(image_path)["url"], "stages": stages,
                             "sourceResolution": "historicalBundle" if song.startswith("historical-sp:") else "illustrationLowRes"}
        result["thumbnail"] = stages[0]["url"]
    return song, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--music", required=True, type=Path)
    parser.add_argument("--artwork", required=True, type=Path)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--historical-sp", type=Path,
                        help="Optional verified historical-SP bundle directory")
    parser.add_argument("--full-art-index", type=Path,
                        help="Optional full-resolution artwork index from build-catalog-art.py")
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--include-existing", action="store_true")
    args = parser.parse_args()
    for checkout, expected in [(args.music, MUSIC_SHA), (args.artwork, ART_SHA)]:
        head = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        if head != expected:
            raise SystemExit(f"Unexpected upstream HEAD: {checkout}: {head}; expected {expected}")
    source = (ROOT / "js/app.js").read_text()
    packs = json.loads(re.search(r"const BUILTIN_PACKS\s*=\s*(\[.*?\]);", source, re.S)[1])
    existing = {entry.get("audioHash", "").removeprefix("reference-song:") for entry in packs}
    destination = ROOT / "assets/catalog-media"
    destination.mkdir(parents=True, exist_ok=True)
    jobs = []
    for path in sorted(args.music.glob("*.ogg")):
        song = path.stem
        if not args.include_existing and song in existing:
            continue
        jobs.append((song, path, args.artwork / (song + ".png"), destination))
    if args.historical_sp:
        for folder in sorted(args.historical_sp.iterdir()):
            music = folder / "music.ogg"
            if folder.is_dir() and music.exists():
                artwork = next((path for path in [folder / "illustration.jpg", folder / "illustration.png"] if path.exists()), None)
                jobs.append(("historical-sp:" + folder.name, music, artwork, destination))
    result, failures = {}, {}
    with ThreadPoolExecutor(max_workers=max(1, min(4, args.jobs))) as executor:
        future_songs = {executor.submit(prepare, *job): job[0] for job in jobs}
        for future in as_completed(future_songs):
            song = future_songs[future]
            try:
                key, item = future.result()
                result[key] = item
            except Exception as error:
                failures[song] = str(error)
            if (len(result) + len(failures)) % 10 == 0:
                print(f"Prepared {len(result)}/{len(jobs)} songs; failures {len(failures)}", flush=True)
    if args.full_art_index:
        for song, artwork in json.loads(args.full_art_index.read_text()).items():
            if song not in result or "artwork" not in result[song]:
                continue
            spec = result[song]["artwork"]
            spec["original"] = artwork["original"]["url"]
            spec["stages"][2] = artwork["stage2"]
            spec["sourceResolution"] = artwork["sourceResolution"]
            spec["source"] = artwork["source"]
    args.index.parent.mkdir(parents=True, exist_ok=True)
    args.index.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    args.index.with_suffix(".failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2) + "\n")
    print(f"Media index: {args.index}; ready {len(result)}, failed {len(failures)}", flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
