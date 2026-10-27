#!/usr/bin/env python3
"""Create pixel-equivalent WebP derivatives without changing source PNG files.

WebP is already required by this game's built-in UI and note skin. ``quality``
here controls lossless encoder effort, never visual quality. Each output must
decode to exactly the original RGBA pixels, size and retained color metadata.
The emitted URL map is applied to an isolated release by the catalog builder.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import os
import time

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def optimize(path, root):
    old_url = './' + path.relative_to(root).as_posix()
    output = path.with_name(path.stem + '-lossless.webp')
    temporary = output.with_name(output.name + '.partial')
    with path.open('rb') as header:
        png_header = header.read(25)
    if png_header[:8] != b'\x89PNG\r\n\x1a\n' or len(png_header) < 25:
        raise ValueError('Not a valid PNG header: ' + str(path))
    if png_header[24] > 8:
        return old_url, None, {'reason': 'PNG bit depth exceeds lossless WebP capability', 'bitDepth': png_header[24]}
    with Image.open(path) as source:
        # WebP cannot directly carry these PNG color interpretation chunks.
        # Leave any such image unchanged rather than alter its browser colors.
        unsupported = sorted(set(source.info) & {'gamma', 'srgb', 'chromaticity'})
        if unsupported:
            return old_url, None, {'reason': 'unsupported PNG color metadata', 'keys': unsupported}
        pixels = source.convert('RGBA').tobytes()
        pixel_hash = digest(pixels)
        metadata = {key: source.info[key] for key in ['icc_profile', 'exif', 'xmp'] if source.info.get(key)}

        def validate(candidate):
            with Image.open(candidate) as decoded:
                if decoded.size != source.size or decoded.convert('RGBA').tobytes() != pixels:
                    raise ValueError('Lossless RGBA verification failed: ' + str(path))
                for key, value in metadata.items():
                    if decoded.info.get(key) != value:
                        raise ValueError('Metadata verification failed: ' + key + ': ' + str(path))

        if output.exists():
            validate(output)
        else:
            try:
                source.save(temporary, 'WEBP', lossless=True, quality=80, method=4,
                            exact=True, **metadata)
                validate(temporary)
                # An atomic replacement never changes a hard-linked source inode.
                os.replace(temporary, output)
            finally:
                temporary.unlink(missing_ok=True)
        old_bytes, new_bytes = path.stat().st_size, output.stat().st_size
        if new_bytes >= old_bytes:
            return old_url, None, {'reason': 'no byte saving', 'oldBytes': old_bytes, 'candidateBytes': new_bytes}
        return old_url, {
            'url': './' + output.relative_to(root).as_posix(), 'bytes': new_bytes,
            'sha256': digest(output.read_bytes()), 'mime': 'image/webp',
            'pixelSHA256': pixel_hash, 'width': source.width, 'height': source.height,
            'oldBytes': old_bytes, 'savedBytes': old_bytes - new_bytes,
            'originalSHA256': digest(path.read_bytes()),
            'rgbaEquivalent': True, 'metadataPreserved': sorted(metadata),
            'encoding': 'WebP lossless; effort quality=80, method=4',
        }, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT)
    parser.add_argument('--priority-release', type=Path)
    parser.add_argument('--only-release', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    root = args.source.resolve()
    files = list((root / 'assets/catalog-media').glob('*-full.png'))
    release = args.priority_release.resolve() if args.priority_release else None
    if args.only_release and not release:
        raise SystemExit('--only-release requires --priority-release')
    if args.only_release:
        files = [path for path in files if (release / path.relative_to(root)).is_file()]
    files.sort(key=lambda path: (0 if release and (release / path.relative_to(root)).is_file() else 1, path.name))
    report = {'byOriginalURL': {}, 'removedUnreferenced': [], 'savedBytes': 0,
              'plannedImages': len(files), 'processedImages': 0, 'skipped': {}, 'failures': {},
              'complete': False, 'sourcePNGsPreserved': True,
              'verification': 'every derivative: exact decoded RGBA bytes, dimensions, ICC/Exif/XMP'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()

    def checkpoint():
        temporary = args.output.with_name(args.output.name + '.partial')
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        os.replace(temporary, args.output)

    with ThreadPoolExecutor(max_workers=max(1, min(4, args.jobs))) as executor:
        futures = {executor.submit(optimize, path, root): path for path in files}
        for future in as_completed(futures):
            path = futures[future]
            try:
                old_url, spec, skip = future.result()
                if spec:
                    report['byOriginalURL'][old_url] = spec
                    report['savedBytes'] += spec['savedBytes']
                elif skip:
                    report['skipped'][old_url] = skip
            except Exception as error:
                report['failures'][str(path.relative_to(root))] = str(error)
            report['processedImages'] += 1
            if report['processedImages'] % 10 == 0:
                checkpoint()
                print(f"Verified {report['processedImages']}/{len(files)}; saved {report['savedBytes']:,} bytes", flush=True)
    report['complete'] = True
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    checkpoint()
    print(json.dumps({key: value for key, value in report.items() if key not in {'byOriginalURL', 'skipped', 'failures'}}, ensure_ascii=False, indent=2))
    print('Skipped:', len(report['skipped']), 'Failures:', len(report['failures']))
    if report['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
