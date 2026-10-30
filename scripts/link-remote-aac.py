#!/usr/bin/env python3
"""Link verified, already-published AAC derivatives to the online catalog."""
import argparse
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--index', type=Path, required=True)
parser.add_argument('--commit', required=True)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
args = parser.parse_args()
if not re.fullmatch('[0-9a-f]{40}', args.commit):
    parser.error('A full immutable media commit is required')
root = args.root.resolve()
index = json.loads(args.index.read_text())
catalog_path = root / 'js/full-catalog.js'
catalog_text = catalog_path.read_text()
prefix, payload = catalog_text.split('globalThis.PhiFullCatalog=', 1)
catalog = json.loads(payload.rsplit(';', 1)[0])
remote = {key: audio for key, audio in catalog['audio'].items() if audio.get('remote')}
if not index.get('complete') or set(remote) != set(index['assets']):
    raise ValueError('AAC coverage must match the complete remote audio catalog')
manifest_path = root / 'assets/meta/online-manifest.json'
manifest = json.loads(manifest_path.read_text())
for key, audio in remote.items():
    item = index['assets'][key]
    if any(audio[field] != item['sourceOGG'][field] for field in ('url', 'bytes', 'sha256', 'mime')):
        raise ValueError('Original OGG association differs: ' + key)
    if not re.fullmatch(r'music/[A-Za-z0-9._-]+\.m4a', item['path']):
        raise ValueError('Invalid AAC path: ' + key)
    if not re.fullmatch('[0-9a-f]{64}', item['sha256']) or not isinstance(item['bytes'], int) or item['bytes'] <= 0:
        raise ValueError('Invalid AAC digest or size: ' + key)
    url = f"https://raw.githubusercontent.com/tycofficial/phigros/{args.commit}/{item['path']}"
    spec = {field: item[field] for field in ('bytes', 'sha256', 'mime')}
    audio['lowFallback'] = {'url': url, **spec}
    manifest[url] = {**spec, 'mirror': f"https://cdn.jsdelivr.net/gh/tycofficial/phigros@{args.commit}/{item['path']}"}
code_path = root / 'js/remote-assets.js'
code = code_path.read_text()
start = code.index('const known = Object.freeze(') + len('const known = Object.freeze(')
end = code.index('), allowed = new Map();', start)
compact = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
catalog_path.write_text(prefix + 'globalThis.PhiFullCatalog=' + compact(catalog) + ';\n')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
code_path.write_text(code[:start] + compact(manifest) + code[end:])
index['mediaCommit'] = args.commit
(root / 'assets/meta/remote-aac-source.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
print(f"Linked {len(remote)} compatible AAC tracks; original OGG references retained.")
