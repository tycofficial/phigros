#!/usr/bin/env python3
"""Build a pinned, same-origin Phigros catalog from checked-out upstream branches.

Network access is intentionally separate: provide the pinned branch checkouts and
media-index.json produced by prepare-catalog-media.py under --source-root. Music,
artwork and charts retain their upstream authorship; repository availability does
not grant an independent license to their contents.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'info': 'da34d1de07cd59b096ca0520b2815a2ea11cc13e',
    'chart': '5d40bfdf05bee53f5107a6ea5620ca0e953de815',
    'music': '5142ba2673ccbeb23173886f3bd851e9c881e6ec',
    'illustrationLowRes': '931e2effc5bd2e33d547092afbb1ac012bd15161',
}
META_COMMIT = '6bb6fad1db8702d2c8d470930c31538581d16a31'
TIERS = ('EZ', 'HD', 'IN', 'AT', 'SP')
SUPPORTED = {1, 3, 3473}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compact(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'))


def read_tsv(path):
    return {row[0]: row[1:] for line in path.read_text().splitlines() if (row := line.split('\t')) and row[0]}


def collection_id(chapter):
    if chapter.startswith('Single-') or chapter == '单曲精选集':
        return 'singles'
    if chapter.startswith('Chapter Legacy'):
        return 'chapter-legacy'
    match = re.match(r'Chapter (\d+)\b', chapter)
    if match:
        return 'chapter-' + match[1]
    if chapter == '--':
        return 'tutorial'
    if chapter == 'SP':
        return 'special'
    return 'collection-' + digest(chapter.encode())[:12]


def check_pin(path, pin):
    actual = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != pin:
        raise ValueError(f'{path.name}: expected pinned commit {pin}, got {actual}')


def media_variants(media):
    """Accept the media preparation index's documented variant fields."""
    audio = media.get('music') or media
    original = audio.get('high') or audio.get('original')
    if isinstance(original, str):
        raise ValueError('Media index must include original bytes, mime and sha256')
    return original, audio.get('low'), audio.get('lowFallback'), audio.get('duration') or media.get('duration')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--sp-source', type=Path, help='Optional pinned historical SP bundles downloaded from FallingMY/phi-zone.github.io')
    parser.add_argument('--chart-source', type=Path, help='Chart checkout when stored outside source root')
    parser.add_argument('--allow-missing-media', action='store_true', help='Record unavailable songs instead of failing; never emit broken references')
    args = parser.parse_args()
    src = args.source_root
    chart_source = args.chart_source or src / 'chart'
    for branch, pin in PINS.items():
        check_pin(chart_source if branch == 'chart' else src / branch, pin)
    info = read_tsv(src / 'info/info.tsv')
    difficulties = read_tsv(src / 'info/difficulty.tsv')
    chapters = json.loads((src / 'infolist.json').read_text())
    media_index = json.loads((src / 'media-index.json').read_text())
    if 'songs' in media_index:
        media_index = media_index['songs']
    full_art_path = src / 'full-art-index.json'
    full_art = json.loads(full_art_path.read_text()) if full_art_path.exists() else {}
    for song, spec in full_art.items():
        if song in media_index and media_index[song].get('artwork'):
            media_index[song]['artwork']['original'] = spec['original']
            media_index[song]['artwork']['stages'][2] = spec['stage2']
            media_index[song]['artwork']['sourceResolution'] = spec.get('sourceResolution', 'illustration')
            media_index[song]['artwork']['source'] = spec.get('source', {})
    # chaplist preserves the source's group sequence. It is an independent
    # community metadata source, not a claim that official UI ordering was tested.
    chapter_order = [line.split(':', 1)[0] for line in (src / 'chaplist.yaml').read_text().splitlines() if line and not line[0].isspace()]
    for chapter in [value.get('chapter', '--') for value in chapters.values()] + ['SP']:
        if chapter not in chapter_order:
            chapter_order.append(chapter)
    collection_specs = [{'id': collection_id(title), 'title': title if title != '--' else '教学', 'order': order}
                        for order, title in enumerate(chapter_order)]
    collection_by_title = {title: collection_specs[i] for i, title in enumerate(chapter_order)}
    app = (ROOT / 'js/app.js').read_text()
    existing = json.loads(re.search(r'const BUILTIN_PACKS\s*=\s*(\[.*?\]);', app, re.S)[1])
    existing_keys = {(entry.get('audioHash', '').removeprefix('reference-song:'), entry['meta']['difficultyClass']) for entry in existing}
    source_order = {song: order for order, song in enumerate(info)}
    assignments = {}
    for song, value in chapters.items():
        chapter = value.get('chapter', '--')
        group = collection_by_title[chapter]
        assignments[song] = {'collectionId': group['id'], 'collectionTitle': group['title'],
                             'chapter': group['title'], 'collectionOrder': group['order'],
                             'songOrder': source_order.get(song, len(source_order))}
    entries, assets, artwork, audio = [], [], {}, {}
    emitted_media = set()
    skipped, upstream_tiers = [], Counter()
    source_chart_count = 0
    reused = 0
    directories = sorted(p for p in chart_source.iterdir() if p.is_dir() and not p.name.startswith('.'))
    dest = ROOT / 'assets/catalog-charts'
    dest.mkdir(parents=True, exist_ok=True)
    for folder in directories:
        # Upstream .0 is the ordinary chart, Random .1 through .6 are six
        # authored variants, sharing the same credited song and audio.
        song = re.sub(r'\.\d+$', '', folder.name)
        variant_match = re.search(r'\.(\d+)$', folder.name)
        variant = int(variant_match[1]) if variant_match else 0
        fields = info.get(song)
        for chart_path in sorted(folder.glob('*.json')):
            source_chart_count += 1
            tier = chart_path.stem.upper()
            upstream_tiers[tier] += 1
            if tier not in TIERS:
                skipped.append({'path': f'{folder.name}/{chart_path.name}', 'reason': 'unsupported-difficulty-name'})
                continue
            raw = chart_path.read_bytes()
            chart = json.loads(raw)
            if chart.get('formatVersion') not in SUPPORTED:
                skipped.append({'path': f'{folder.name}/{chart_path.name}', 'reason': 'unsupported-format', 'formatVersion': chart.get('formatVersion')})
                continue
            if (song, tier) in existing_keys and variant == 0:
                reused += 1
                continue
            if fields is None:
                skipped.append({'path': f'{folder.name}/{chart_path.name}', 'reason': 'missing-song-credits'})
                continue
            media = media_index.get(song)
            if not media:
                if not args.allow_missing_media:
                    raise ValueError(f'Missing media for {song}; use --allow-missing-media to record an unavailable song')
                skipped.append({'path': f'{folder.name}/{chart_path.name}', 'reason': 'missing-music-or-artwork'})
                continue
            original, low, low_fallback, duration = media_variants(media)
            art = media.get('artwork')
            if not all((original, low, low_fallback, duration, art)):
                raise ValueError(f'Incomplete media variants for {song}')
            # Upstream chart semantics are preserved verbatim inside gzip.
            # Keep method 9 (gzip) compatible with the existing loader.
            song_hash = digest(song.encode())[:16]
            suffix = f'-v{variant}' if variant else ''
            stem = song_hash + suffix + '-' + tier.lower()
            chart_dest = dest / (stem + '.json.gz')
            packed = chart_dest.read_bytes() if chart_dest.exists() else b''
            if not packed or gzip.decompress(packed) != raw:
                packed = gzip.compress(raw, compresslevel=1, mtime=0)
                chart_dest.write_bytes(packed)
            chart_id, music_id, art_id = 'catalog-' + stem, 'catalog-' + song_hash + '-music', 'catalog-' + song_hash + '-art'
            assets.append({'id': chart_id, 'method': 9, 'usize': len(raw), 'byteLength': len(packed),
                           'url': './' + chart_dest.relative_to(ROOT).as_posix(), 'sha256': digest(raw), 'packedSha256': digest(packed),
                           'sourcePath': f'{folder.name}/{chart_path.name}'})
            if song not in emitted_media:
                emitted_media.add(song)
                for asset_id, spec in [(music_id, original), (art_id, art.get('original'))]:
                    if isinstance(spec, str):
                        file = ROOT / spec.removeprefix('./')
                        spec = {'url': spec, 'bytes': file.stat().st_size, 'sha256': digest(file.read_bytes())}
                    assets.append({'id': asset_id, 'method': 0, 'usize': spec['bytes'], 'byteLength': spec['bytes'],
                                   'url': spec['url'], 'sha256': spec['sha256']})
                audio[music_id] = {'url': low_fallback['url'], 'bytes': low_fallback['bytes'], 'duration': duration,
                                   'original': original['url'], 'high': original, 'low': low, 'lowFallback': low_fallback}
                artwork[art_id] = {'original': art['original']['url'] if isinstance(art['original'], dict) else art['original'],
                                   'stages': art['stages'], 'sourceResolution': art.get('sourceResolution', 'historical-bundle'), 'source': art.get('source', {})}
            group = assignments.get(song)
            if not group:
                # All ordinary credited songs should have an upstream chapter.
                raise ValueError(f'Missing chapter assignment: {song}')
            title = fields[0]
            tier_index = TIERS.index(tier)
            difficulty_values = difficulties.get(song, [])
            difficulty = float(difficulty_values[tier_index]) if tier_index < len(difficulty_values) and difficulty_values[tier_index] else 0
            charter = fields[3 + tier_index] if 3 + tier_index < len(fields) else ''
            if tier == 'SP':
                # SP is never silently assigned an ordinary chart's constant.
                difficulty = 0
                group = {'collectionId': 'special', 'collectionTitle': 'SP', 'chapter': 'SP',
                         'collectionOrder': chapter_order.index('SP'), 'songOrder': source_order[song]}
            note_count = sum(sum(1 for note in line.get(key, []) if not note.get('isFake', False))
                             for line in chart.get('judgeLineList', []) for key in ['notesAbove', 'notesBelow'])
            entry_id = 'catalog-' + stem
            entries.append({'id': entry_id, 'name': title,
                            'sourceName': f'{title} {tier}' + (f' · 随机变体 {variant}' if variant else ''),
                            'parser': 'pgr', 'audioHash': 'reference-song:' + song,
                            'meta': {'name': title, 'composer': fields[1], 'illustrator': fields[2], 'charter': charter,
                                     'difficultyClass': tier, 'difficulty': difficulty,
                                     'level': f'{tier} Lv.{int(difficulty)}' if difficulty > 0 else tier,
                                     'chart': 'chart.json', 'music': 'music.ogg', 'illustration': 'illustration.png',
                                     **group, 'variant': variant},
                            'thumbnailKey': song, 'thumbnailData': art['stages'][0]['url'],
                            'notes': note_count, 'lines': len(chart.get('judgeLineList', [])),
                            'scoreIdentity': entry_id,
                            'files': [{'name': 'chart.json', 'asset': chart_id}, {'name': 'music.ogg', 'asset': music_id},
                                      {'name': 'illustration.png', 'asset': art_id}]})
    historical_sp_count = 0
    if args.sp_source:
        for folder in sorted(args.sp_source.iterdir()):
            if not folder.is_dir():
                continue
            song = 'historical-sp:' + folder.name
            chart_path, info_path = folder / 'Chart_SP.json', folder / 'info.json'
            if not chart_path.exists() or not info_path.exists():
                continue
            fields = json.loads(info_path.read_text())
            raw = chart_path.read_bytes()
            chart = json.loads(raw)
            media = media_index.get(song)
            if chart.get('formatVersion') not in SUPPORTED or not media:
                skipped.append({'path': 'historical-sp/' + folder.name, 'reason': 'missing-media-or-unsupported-format'})
                continue
            original, low, low_fallback, duration = media_variants(media)
            art = media['artwork']
            song_hash = digest(song.encode())[:16]
            stem = song_hash + '-sp'
            chart_dest = dest / (stem + '.json.gz')
            packed = chart_dest.read_bytes() if chart_dest.exists() else b''
            if not packed or gzip.decompress(packed) != raw:
                packed = gzip.compress(raw, compresslevel=1, mtime=0)
                chart_dest.write_bytes(packed)
            chart_id, music_id, art_id = 'catalog-' + stem, 'catalog-' + song_hash + '-music', 'catalog-' + song_hash + '-art'
            assets.append({'id': chart_id, 'method': 9, 'usize': len(raw), 'byteLength': len(packed),
                           'url': './' + chart_dest.relative_to(ROOT).as_posix(), 'sha256': digest(raw), 'packedSha256': digest(packed),
                           'sourcePath': ('hidden/' if folder.name in {'burn(haocore-mix)', 'christmas', 'spasmodic(haocore-mix)', 'wintercube-(original-mix)'} else 'single/') + folder.name + '/Chart_SP.json'})
            for asset_id, spec in [(music_id, original), (art_id, art.get('original'))]:
                if isinstance(spec, str):
                    file = ROOT / spec.removeprefix('./')
                    spec = {'url': spec, 'bytes': file.stat().st_size, 'sha256': digest(file.read_bytes())}
                assets.append({'id': asset_id, 'method': 0, 'usize': spec['bytes'], 'byteLength': spec['bytes'],
                               'url': spec['url'], 'sha256': spec['sha256']})
            audio[music_id] = {'url': low_fallback['url'], 'bytes': low_fallback['bytes'], 'duration': duration,
                               'original': original['url'], 'high': original, 'low': low, 'lowFallback': low_fallback}
            artwork[art_id] = {'original': art['original']['url'] if isinstance(art['original'], dict) else art['original'], 'stages': art['stages'], 'sourceResolution': art.get('sourceResolution', 'historical-bundle'), 'source': art.get('source', {})}
            group = {'collectionId': 'special', 'collectionTitle': 'SP', 'chapter': 'SP',
                     'collectionOrder': chapter_order.index('SP'), 'songOrder': len(source_order) + historical_sp_count}
            title = fields['name']
            charter = next((item.get('charter', '') for item in fields.get('charts', []) if item.get('level') == 'SP'), '')
            note_count = sum(sum(1 for note in line.get(key, []) if not note.get('isFake', False))
                             for line in chart.get('judgeLineList', []) for key in ['notesAbove', 'notesBelow'])
            entry_id = 'catalog-' + stem
            entries.append({'id': entry_id, 'name': title, 'sourceName': title + ' SP', 'parser': 'pgr',
                            'audioHash': 'reference-song:' + song,
                            'meta': {'name': title, 'composer': fields.get('composer', ''), 'illustrator': fields.get('illustrator', ''),
                                     'charter': charter, 'difficultyClass': 'SP', 'difficulty': 0, 'level': 'SP',
                                     'chart': 'chart.json', 'music': 'music.ogg', 'illustration': 'illustration.png', **group, 'variant': 0},
                            'thumbnailKey': song, 'thumbnailData': art['stages'][0]['url'], 'notes': note_count,
                            'lines': len(chart.get('judgeLineList', [])), 'scoreIdentity': entry_id,
                            'files': [{'name': 'chart.json', 'asset': chart_id}, {'name': 'music.ogg', 'asset': music_id},
                                      {'name': 'illustration.png', 'asset': art_id}]})
            emitted_media.add(song)
            historical_sp_count += 1
    entries.sort(key=lambda e: (e['meta']['collectionOrder'], e['meta']['songOrder'], e['meta']['variant'], TIERS.index(e['meta']['difficultyClass'])))
    visible_groups = {entry['meta']['collectionId'] for entry in entries}
    visible_groups.update(assignments.get(entry.get('audioHash', '').removeprefix('reference-song:'), {}).get('collectionId') for entry in existing)
    visible_groups.discard(None)
    coverage = {'upstreamSongDirectories': len(directories), 'upstreamCharts': source_chart_count,
                'upstreamDifficultyCounts': dict(upstream_tiers), 'addedSongs': len(emitted_media),
                'addedCharts': len(entries), 'historicalSPChartsAdded': historical_sp_count, 'reusedExistingCharts': reused, 'existingCharts': len(existing),
                'playableCharts': len(existing) + len(entries),
                'playableSongVersions': len({entry.get('audioHash') for entry in [*existing, *entries]}),
                'visibleCollections': len(visible_groups),
                'excludedCharts': skipped,
                'allHistoricalAprilFools': False, 'chapterStoryAnimationsIncluded': False,
                'notes': ['Upstream supplies only one chart named SP; historical April Fools coverage is incomplete.',
                          'Chapter assignments and group sequence are community metadata; official in-game layout was not independently verified.',
                          'Catalog audio/art/chart availability does not verify every special visual or original-game behavior.']}
    catalog = {'version': (src / 'info/version.txt').read_text().strip(),
               'source': {'repository': 'https://github.com/7aGiven/Phigros_Resource',
                          'branches': {**{branch: {'commit': pin} for branch, pin in PINS.items()}, **({'illustration': {'commit': '0c7e90ee5d8ffaaa756d79d8aef879338fdde423'}} if full_art else {})},
                          'historicalSP': {'repository': 'https://github.com/FallingMY/phi-zone.github.io', 'commit': '6254d6d4fa5765f32f475cfed1d78c50aac667f0', 'paths': ['hidden/', 'single/']},
                          'metadata': {'repository': 'https://github.com/Catrong/phi-plugin', 'commit': META_COMMIT,
                                       'files': ['resources/info/infolist.json', 'resources/info/chaplist.yaml', 'resources/info/spinfo.json']}},
               'entries': entries, 'assets': assets, 'audio': audio, 'artwork': artwork,
               'collections': collection_specs, 'collectionAssignments': assignments, 'coverage': coverage}
    (ROOT / 'js/full-catalog.js').write_text('/* Generated by scripts/build-full-catalog.py; pinned provenance and coverage below. */\nglobalThis.PhiFullCatalog=' + compact(catalog) + ';\n')
    (ROOT / 'assets/meta/catalog-coverage.json').write_text(json.dumps({'version': catalog['version'], 'source': catalog['source'], **coverage}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(coverage, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
