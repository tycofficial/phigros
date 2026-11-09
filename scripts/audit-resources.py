#!/usr/bin/env python3
"""Audit installed resource bytes and references without claiming official parity.

Run: python3 scripts/audit-resources.py --output work/resource-audit
Node.js loads the project's existing catalog installers. Pillow, fontTools and
ffprobe, when available, inspect local media; missing tools remain unverified.
No network requests are made and no game resources or saved data are modified.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import gzip
import hashlib
import json
import lzma
import pathlib
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from urllib.parse import unquote

try:
    from PIL import Image
except ImportError:
    Image = None
try:
    from fontTools.ttLib import TTFont
except ImportError:
    TTFont = None

CATALOG_SCRIPT = r"""
const fs=require('node:fs'),vm=require('node:vm');const context={};
for(const name of ['full-catalog.js','hosted-manifest.js','catalog-runtime.js'])
  vm.runInNewContext(fs.readFileSync('js/'+name,'utf8'),context);
const source=fs.readFileSync('js/app.js','utf8');
function original(name){
  const match=source.match(new RegExp('^  const '+name+' = (\\[.*\\]);$','m'));
  if(!match)throw Error('Missing '+name);return JSON.parse(match[1]);
}
const entries=original('BUILTIN_PACKS'),assets=original('BUILTIN_ASSETS');
const result=context.PhiCatalogRuntime.install({entries,assets,hostedManifest:context.PhiHostedManifest});
process.stdout.write(JSON.stringify({entries,assets,result,hosted:context.PhiHostedManifest,
  source:context.PhiFullCatalog.source}));
"""
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
MEDIA_EXTENSIONS = {'.ogg', '.m4a', '.mp3', '.wav', '.flac', '.mp4', '.webm'}
FONT_EXTENSIONS = {'.ttf', '.otf', '.woff', '.woff2'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def local_name(value):
    if not isinstance(value, str) or value.startswith(('https:', 'http:', 'data:', 'blob:')):
        return None
    clean = unquote(value.split('?', 1)[0].split('#', 1)[0]).removeprefix('./')
    if clean.startswith('assets/') and '..' not in pathlib.PurePosixPath(clean).parts:
        return clean
    return None


def fontconfig_metadata(path, reason):
    scanner = shutil.which('fc-scan')
    if not scanner:
        return {'status': '未验证', 'reason': reason + '; fc-scan unavailable'}
    try:
        result = subprocess.run([scanner, '--format', '%{family}\n%{style}\n%{fullname}\n%{fontversion}\n', str(path)],
                                capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'status': '未验证', 'reason': reason + '; fc-scan unavailable: ' + str(error)}
    names = result.stdout.splitlines()
    if result.returncode or len(names) < 4 or not names[0]:
        return {'status': '未验证', 'reason': reason + '; fc-scan could not inspect font', 'detail': result.stderr.strip()}
    return {'status': '通过', 'method': 'fc-scan / FreeType metadata fallback',
            'names': {'family': [names[0]], 'style': [names[1]], 'fullName': [names[2]], 'fontVersionRaw': [names[3]]},
            'inspectionScope': 'Names and raw font version; glyph count not inspected by fallback', 'fallbackReason': reason}


def inspect_file(root, path, ffprobe):
    name = path.relative_to(root).as_posix()
    result = {'path': name, 'bytes': path.stat().st_size, 'sha256': None,
              'officialVersion': None, 'officialProvenanceStatus': '阻塞',
              'cropAndLoopAgainstOfficial': '阻塞'}
    try:
        hasher = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                hasher.update(block)
        result['sha256'] = hasher.hexdigest()
        result['fileReadStatus'] = '通过'
    except OSError as error:
        result.update(fileReadStatus='未通过', error=str(error))
        return result
    suffix = path.suffix.lower()
    if suffix in FONT_EXTENSIONS:
        if TTFont is None:
            result['font'] = fontconfig_metadata(path, 'fontTools unavailable')
        else:
            try:
                with TTFont(path) as font:
                    names = {}
                    for key, ident in [('family', 1), ('style', 2), ('fullName', 4), ('version', 5), ('postscriptName', 6)]:
                        names[key] = sorted({record.toUnicode() for record in font['name'].names if record.nameID == ident})
                    result['font'] = {'status': '通过', 'names': names, 'glyphCount': font['maxp'].numGlyphs}
            except ImportError as error:
                result['font'] = fontconfig_metadata(path, 'Optional fontTools decoder unavailable: ' + str(error))
            except Exception as error:
                result['font'] = {'status': '未通过', 'error': str(error)}
    if suffix in IMAGE_EXTENSIONS:
        if Image is None:
            result['image'] = {'status': '未验证', 'reason': 'Pillow unavailable'}
        else:
            try:
                with Image.open(path) as im:
                    result['image'] = {'status': '通过', 'width': im.width, 'height': im.height,
                                       'format': im.format, 'mode': im.mode,
                                       'frames': getattr(im, 'n_frames', 1)}
                    im.load()
            except Exception as error:
                result['image'] = {'status': '未通过', 'error': str(error)}
    if suffix == '.svg':
        try:
            element = ET.parse(path).getroot()
            if element.tag.rsplit('}', 1)[-1] != 'svg':
                raise ValueError('SVG root element missing')
            result['image'] = {'status': '通过', 'format': 'SVG', 'width': element.get('width'),
                               'height': element.get('height'), 'viewBox': element.get('viewBox'),
                               'inspectionScope': 'Declared intrinsic geometry only; CSS-rendered dimensions and official parity not verified'}
        except Exception as error:
            result['image'] = {'status': '未通过', 'error': str(error)}
    if suffix in MEDIA_EXTENSIONS:
        if not ffprobe:
            result['media'] = {'status': '未验证', 'reason': 'ffprobe unavailable'}
        else:
            try:
                process = subprocess.run([ffprobe, '-v', 'error', '-show_entries',
                    'format=duration,format_name:stream=codec_type,codec_name,sample_rate,channels,width,height,avg_frame_rate,duration',
                    '-of', 'json', str(path)], capture_output=True, text=True, timeout=60)
                if process.returncode:
                    raise ValueError(process.stderr.strip())
                result['media'] = {'status': '通过', 'method': 'container/stream probe, not full decode',
                                   **json.loads(process.stdout)}
            except Exception as error:
                result['media'] = {'status': '未通过', 'error': str(error)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('work/resource-audit'))
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    root = args.root.resolve()
    out = args.output.resolve()
    if out == root / 'assets' or root / 'assets' in out.parents:
        parser.error('Output must not be inside assets/')
    out.mkdir(parents=True, exist_ok=True)
    ffprobe = shutil.which('ffprobe')
    catalog = json.loads(subprocess.check_output(['node', '-e', CATALOG_SCRIPT], cwd=root, text=True))
    paths = sorted(p for p in (root / 'assets').rglob('*') if p.is_file())
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        inventory = list(executor.map(lambda p: inspect_file(root, p, ffprobe), paths))
    files = {item['path']: item for item in inventory}
    references = defaultdict(list)
    remote = defaultdict(list)
    checks = []
    errors = []
    duration_comparisons = []

    def reference(value, origin, role, expected_bytes=None, expected_sha=None, offset=None):
        if not isinstance(value, str):
            return
        evidence = {'origin': origin, 'role': role}
        if expected_bytes is not None:
            evidence['expectedBytes'] = expected_bytes
        if expected_sha:
            evidence['expectedSha256'] = expected_sha
        if offset is not None:
            evidence['byteOffset'] = offset
        if value.startswith(('https://', 'http://')):
            remote[value].append(evidence)
            return
        name = local_name(value)
        if name is None:
            return
        references[name].append(evidence)
        result = {'path': name, **evidence, 'status': '通过'}
        item = files.get(name)
        measured = item
        if item is not None and offset is not None:
            if not isinstance(offset, int) or offset < 0 or not isinstance(expected_bytes, int) or expected_bytes < 0 or offset + expected_bytes > item['bytes']:
                result.update(status='未通过', reason='Invalid byte range')
            else:
                with (root / name).open('rb') as stream:
                    stream.seek(offset)
                    segment = stream.read(expected_bytes)
                measured = {'bytes': len(segment), 'sha256': digest(segment)}
        if item is None:
            result.update(status='未通过', reason='Referenced local file missing')
        elif result['status'] != '未通过' and expected_bytes is not None and measured['bytes'] != expected_bytes:
            result.update(status='未通过', reason='Byte length mismatch', actualBytes=measured['bytes'])
        elif result['status'] != '未通过' and expected_sha and measured['sha256'] != expected_sha:
            result.update(status='未通过', reason='SHA-256 mismatch', actualSha256=measured['sha256'])
        checks.append(result)
        if result['status'] == '未通过':
            errors.append(result)

    by_id = {item['id']: item for item in catalog['assets']}
    chart_ids = {linked['asset'] for entry in catalog['entries'] for linked in entry['files']
                 if linked['name'] == entry['meta'].get('chart')}
    reference_fixtures = json.loads((root / 'tests/fixtures/chart-reference-sha256.json').read_text())
    original_chart_hashes = {local_name(item['url']): item['sha256'] for item in reference_fixtures}
    decoded = {}
    for asset in catalog['assets']:
        reference(asset.get('url'), 'runtime.assets:' + asset['id'], 'encoded asset',
                  asset.get('byteLength'),
                  asset.get('packedSha256') or (asset.get('sha256') if asset.get('method') == 0 else None), asset.get('offset'))
        name = local_name(asset.get('url'))
        if name is None or name not in files:
            continue
        if asset.get('method') in (9, 14) or asset['id'] in chart_ids:
            try:
                data = (root / name).read_bytes()
                if asset.get('offset') is not None:
                    start = asset['offset']
                    data = data[start:start + asset['byteLength']]
                if asset.get('method') == 9:
                    data = gzip.decompress(data)
                elif asset.get('method') == 14:
                    data = lzma.decompress(data)
                elif asset.get('method', 0) != 0:
                    raise ValueError('Unsupported encoding method: ' + str(asset.get('method')))
                entry = {'assetId': asset['id'], 'path': name, 'decodedBytes': len(data),
                         'decodedSha256': digest(data), 'status': '通过'}
                if asset.get('sha256'):
                    entry['expectedDecodedSha256'] = asset['sha256']
                if asset.get('sha256') and digest(data) != asset['sha256']:
                    raise ValueError('Decoded SHA-256 mismatch')
                if asset.get('usize') is not None and len(data) != asset['usize']:
                    raise ValueError('Decoded length mismatch')
                if asset['id'] not in chart_ids:
                    data.decode('utf-8')
                    entry['kind'] = 'UTF-8 metadata; byte integrity only'
                    decoded[asset['id']] = entry
                    continue
                if data.startswith(b'P9C1'):
                    data = subprocess.check_output(['node', '-e',
                        "require('./js/chart-codec.js');const fs=require('node:fs');process.stdout.write(JSON.stringify(PhiChartCodec.decodePacked(new Uint8Array(fs.readFileSync(0)))));"],
                        input=data, cwd=root)
                    entry['reconstructedJSONSha256'] = digest(data)
                expected_original = original_chart_hashes.get(name)
                if expected_original:
                    entry['expectedOriginalJSONSha256'] = expected_original
                    if digest(data) != expected_original:
                        raise ValueError('Original JSON SHA-256 differs from existing reference fixture')
                payload = json.loads(data)
                if isinstance(payload, dict) and isinstance(payload.get('judgeLineList'), list):
                    lines = payload['judgeLineList']
                    if any(not isinstance(line, dict) or not isinstance(line.get('notesAbove', []), list) or not isinstance(line.get('notesBelow', []), list) for line in lines):
                        raise ValueError('Chart judgment line or note array has invalid structure')
                    entry.update(kind='chart', formatVersion=payload.get('formatVersion'),
                                 lines=len(lines), notes=sum(len(line.get('notesAbove', [])) + len(line.get('notesBelow', [])) for line in lines),
                                 declaredNotes=payload.get('numOfNotes'),
                                 blockAreas=sum(len(line.get('blockAreaList', [])) for line in lines),
                                 semanticParity='阻塞')
                else:
                    raise ValueError('Chart role requires an object with a judgeLineList array')
                decoded[asset['id']] = entry
            except Exception as error:
                entry = {'assetId': asset['id'], 'path': name, 'status': '未通过', 'reason': str(error)}
                decoded[asset['id']] = entry
                errors.append(entry)

    chart_rows = []
    for entry in catalog['entries']:
        for linked in entry['files']:
            asset = by_id.get(linked['asset'])
            if asset is None:
                errors.append({'entryId': entry['id'], 'status': '未通过', 'reason': 'Missing runtime asset id', 'assetId': linked['asset']})
                continue
            reference(asset.get('url'), 'runtime.entry:' + entry['id'], linked['name'])
            if linked['name'] == entry['meta'].get('chart'):
                row = {'entryId': entry['id'], 'name': entry['name'], 'difficulty': entry['meta'].get('difficultyClass'),
                       'collectionId': entry['meta'].get('collectionId'), 'assetId': linked['asset'],
                       'url': asset.get('url'), 'declaredCatalogNotes': entry.get('notes'),
                       'byteVerification': '未验证' if entry.get('remote') else '未通过',
                       'officialParity': '阻塞'}
                if linked['asset'] in decoded:
                    result = decoded[linked['asset']]
                    row.update(byteVerification=result['status'], decoded=result)
                    if result['status'] != '通过' or result.get('notes') is None or entry.get('notes') is None:
                        row['catalogCountStatus'] = '未验证'
                    elif result['notes'] != entry['notes']:
                        row['catalogCountStatus'] = '未通过'
                        errors.append({'entryId': entry['id'], 'status': '未通过', 'reason': 'Catalog note count differs from parsed raw chart', 'catalogNotes': entry['notes'], 'rawNotes': result['notes']})
                    else:
                        row['catalogCountStatus'] = '通过'
                chart_rows.append(row)
        reference(entry.get('thumbnailData'), 'runtime.entry:' + entry['id'], 'thumbnail')

    def walk_media(value, origin):
        if isinstance(value, dict):
            if isinstance(value.get('url'), str):
                reference(value['url'], origin + '.url', 'media', value.get('bytes'), value.get('sha256'))
                measured = files.get(local_name(value['url']), {}).get('media', {}).get('format', {}).get('duration')
                if value.get('duration') is not None and measured is not None:
                    duration_comparisons.append({'origin': origin, 'path': local_name(value['url']),
                        'declaredSeconds': value['duration'], 'measuredContainerSeconds': float(measured),
                        'differenceSeconds': float(measured) - value['duration'],
                        'officialStatus': '阻塞', 'interpretation': 'Measured difference only; no tolerance or equivalence is assumed.'})
            for key, child in value.items():
                if key in ('original', 'file') and isinstance(child, str):
                    reference(child, origin + '.' + key, key)
                elif isinstance(child, (list, dict)):
                    walk_media(child, origin + '.' + str(key))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk_media(child, origin + '[' + str(index) + ']')

    walk_media(catalog['hosted'], 'runtime.hosted')
    for file in ['assets/meta/vision-media.json', 'assets/meta/vision-audio.json']:
        walk_media(json.loads((root / file).read_text()), file)
    original_manifest = json.loads((root / 'assets/manifest.json').read_text())
    for entry in original_manifest.get('entries', []):
        reference(entry['file'], 'assets/manifest.json:' + entry['id'], 'manifest encoded asset',
                  entry.get('bytes'), entry.get('sha256'), entry.get('offset'))
    online = json.loads((root / 'assets/meta/online-manifest.json').read_text())
    for address, spec in online.items():
        reference(address, 'assets/meta/online-manifest.json', 'remote declared bytes only', spec.get('bytes'), spec.get('sha256'))

    # Literal references supplement the runtime catalog. Dynamic strings are not
    # interpreted, and absence from this scan never proves a resource is unused.
    literal = re.compile(r'''["'\(]((?:\.\./|\./|/)?assets/[^\s"'\)<>`]+)["'\)]''')
    code_paths = [root / 'index.html', root / 'sw.js', *sorted((root / 'js').rglob('*.js')), *sorted((root / 'css').rglob('*.css'))]
    unresolved_literals = []
    for path in code_paths:
        for line, text in enumerate(path.read_text().splitlines(), 1):
            for match in literal.finditer(text):
                value = match.group(1).removeprefix('/')
                if value.startswith('../assets/') and path.suffix == '.css':
                    value = (path.parent / value).resolve().relative_to(root).as_posix()
                name = local_name(value)
                if name in files:
                    reference(value, path.relative_to(root).as_posix() + ':' + str(line), 'static code literal')
                elif name and pathlib.PurePosixPath(name).suffix and path.suffix in ('.html', '.css'):
                    reference(value, path.relative_to(root).as_posix() + ':' + str(line), 'explicit static HTML/CSS file reference')
                else:
                    unresolved_literals.append({'origin': path.relative_to(root).as_posix() + ':' + str(line), 'literal': value,
                                                'status': '未验证', 'reason': 'May be constructed path, prefix, stale literal or missing file; not assumed active'})
    for item in inventory:
        item['references'] = references.get(item['path'], [])
        item['usageStatus'] = 'indexed reference found' if item['references'] else '未验证：no indexed literal/runtime reference; not proof of unused file'
        if item.get('fileReadStatus') == '未通过':
            errors.append({'path': item['path'], 'status': '未通过', 'reason': 'File read failed', 'detail': item.get('error')})
        for key in ('image', 'media', 'font'):
            if item.get(key, {}).get('status') == '未通过':
                errors.append({'path': item['path'], 'status': '未通过', 'reason': key + ' inspection failed', 'detail': item[key]})

    revision, tracked_paths, tracked_existing, tracked_bytes = None, None, None, None
    git_unavailable_reason = 'No .git metadata in source archive; tracked-file publication size cannot be established.'
    if (root / '.git').exists() and shutil.which('git'):
        try:
            revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, stderr=subprocess.PIPE).strip()
            tracked_paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root, stderr=subprocess.PIPE).decode().split('\0')
            tracked_paths = [name for name in tracked_paths if name]
            tracked_existing = [name for name in tracked_paths if (root / name).is_file()]
            tracked_bytes = sum((root / name).stat().st_size for name in tracked_existing)
        except (OSError, subprocess.CalledProcessError) as error:
            revision, tracked_paths, tracked_existing, tracked_bytes = None, None, None, None
            git_unavailable_reason = 'Git metadata unavailable: ' + str(error)
    metadata_unverified = sum(item.get(kind, {}).get('status') == '未验证' for item in inventory for kind in ('image', 'media', 'font'))
    summary = {'generatedAtUTC': datetime.now(timezone.utc).isoformat(), 'repositoryHead': revision,
               'officialReference': {'status': '阻塞', 'version': None, 'platform': None,
                   'reason': 'Repository version labels and third-party sources do not identify one verified official installation, settings or complete original resource set.'},
               'scope': 'All current assets/ regular files; installed runtime catalog; literal code references; no network download; no full audio decode or official comparison.',
               'tools': {'python': sys.version.split()[0], 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
                         'pillow': Image.__version__ if Image else None, 'ffprobe': ffprobe, 'fcScan': shutil.which('fc-scan')},
               'counts': {'localFiles': len(inventory), 'localBytes': sum(item['bytes'] for item in inventory),
                    'fileHashesComputed': sum(bool(item['sha256']) for item in inventory),
                    'encodedHashExpectationChecks': sum(bool(check.get('expectedSha256')) for check in checks),
                    'uniqueFilesWithEncodedHashExpectations': len({check['path'] for check in checks if check.get('expectedSha256')}),
                    'decodedHashExpectationChecks': sum(bool(item.get('expectedDecodedSha256') or item.get('expectedOriginalJSONSha256')) for item in decoded.values()),
                    'imagesInspected': sum('image' in item for item in inventory),
                    'mediaProbed': sum('media' in item for item in inventory),
                    'fontsInspected': sum('font' in item for item in inventory),
                    'fontMetadataUnverified': sum(item.get('font', {}).get('status') == '未验证' for item in inventory),
                    'runtimeCharts': len(chart_rows), 'localChartsDecoded': sum(row['byteVerification'] == '通过' for row in chart_rows),
                    'remoteChartsUnverified': sum(row['byteVerification'] == '未验证' for row in chart_rows),
                    'uniqueRemoteURLsUnverified': len(remote), 'referenceChecks': len(checks),
                    'unresolvedStaticLiterals': len(unresolved_literals), 'integrityFailures': len(errors)},
               'localIntegrityStatus': '未通过' if errors else ('未验证' if metadata_unverified else '通过'),
               'fileReadAndExpectedHashStatus': '未通过' if any(check['status'] != '通过' for check in checks) or any(item['fileReadStatus'] != '通过' for item in inventory) else '通过',
               'metadataUnverifiedCount': metadata_unverified,
               'localIntegrityMeaning': 'Only listed file, hash, decode, note-count and metadata probe checks; not official resource authenticity or gameplay correctness.',
               'officialAcceptanceStatus': '阻塞', 'runtimeCatalog': catalog['result'], 'catalogSourceDeclarations': catalog['source'],
               'publicationSizeSnapshot': {'method': 'Current bytes of git tracked regular files only; excludes untracked work/ evidence and untracked new code/tests.',
                    'trackedFilesPresent': len(tracked_existing) if tracked_existing is not None else None, 'trackedBytes': tracked_bytes,
                    'trackedFilesMissing': [name for name in tracked_paths if name not in tracked_existing] if tracked_paths is not None else None,
                    'siteGuardBytes': 1000000000,
                    'status': '未验证',
                    'reason': 'Final staged publication must include explicit new source/tests and be checked by scripts/check-pages-release.cjs in a clean staging directory.' if tracked_paths is not None else git_unavailable_reason},
               'knownRepositoryOmissions': catalog['result'].get('coverage', {}).get('excludedCharts', []),
               'gaps': ['No verified single official reference version/platform/settings.',
                        'Remote bytes were not downloaded or measured.',
                        'Crop, loop behavior and official UI/resource correspondence require official captures and original resources.',
                        'Container metadata inspection is not full audio/video decoding or audiovisual synchronization testing.',
                        'Parsed chart counts do not prove gameplay events or official judgment rules.']}
    def write(name, data):
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    write('summary.json', summary)
    write('local-files.json', inventory)
    write('reference-checks.json', checks)
    write('charts.json', chart_rows)
    write('remote-unverified.json', [{'url': url, 'status': '未验证', 'officialStatus': '阻塞', 'references': refs} for url, refs in sorted(remote.items())])
    write('integrity-failures.json', errors)
    write('duration-comparisons.json', duration_comparisons)
    write('unresolved-static-literals.json', unresolved_literals)
    with (out / 'local-files.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=['path', 'bytes', 'sha256', 'width', 'height', 'duration', 'referenceCount', 'officialStatus'])
        writer.writeheader()
        for item in inventory:
            writer.writerow({'path': item['path'], 'bytes': item['bytes'], 'sha256': item['sha256'],
                             'width': item.get('image', {}).get('width', ''), 'height': item.get('image', {}).get('height', ''),
                             'duration': item.get('media', {}).get('format', {}).get('duration', ''),
                             'referenceCount': len(item['references']), 'officialStatus': '阻塞'})
    print(json.dumps({'output': str(out), 'counts': summary['counts'], 'localIntegrityStatus': summary['localIntegrityStatus'],
                      'officialAcceptanceStatus': summary['officialAcceptanceStatus']}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
