#!/usr/bin/env python3
"""Stage lossless Pages resource optimization and add complete songs.

The deployed checkout and full corpus are read-only. Raw chart JSON bytes are
preserved inside a new gzip stream; verified lossless WebP replaces PNG only in
this staging release. All previously published entries and identities survive.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def catalog(path):
    return json.loads(path.read_text().split('globalThis.PhiFullCatalog=', 1)[1].rsplit(';', 1)[0])


def refs(value):
    if isinstance(value, str):
        return {value[2:]} if value.startswith('./assets/') else set()
    if isinstance(value, dict):
        return set().union(*(refs(child) for child in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(refs(child) for child in value)) if value else set()
    return set()


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary=path.with_name(path.name+'.expand-tmp')
    temporary.write_bytes(data)
    os.replace(temporary,path)


def prepare_charts(full, cache):
    source = catalog(full/'js/full-catalog.js')
    by_url = {}
    for index,spec in enumerate((item for item in source['assets'] if item.get('method')==9),1):
        packed=(full/spec['url'][2:]).read_bytes()
        raw=gzip.decompress(packed)
        if digest(raw)!=spec['sha256']:
            raise ValueError('Source chart SHA mismatch: '+spec['id'])
        # gzip level7 gives most level9 savings without spending several times
        # the CPU. mtime=0 makes the container deterministic.
        original=Path(spec['url'][2:])
        cache_path=cache/original
        if cache_path.exists():
            optimized=cache_path.read_bytes()
            if gzip.decompress(optimized)!=raw:
                raise ValueError('Stale packed chart: '+spec['id'])
        else:
            optimized=gzip.compress(raw,compresslevel=7,mtime=0)
            atomic(cache_path,optimized)
        packed_sha=digest(optimized)
        name=original.name.removesuffix('.json.gz')+'-'+packed_sha[:10]+'.json.gz'
        by_url[spec['url']]={'url':'./'+str(original.parent/name),'bytes':len(optimized),'sha256':packed_sha,
                              'source':str(cache_path),'oldBytes':len(packed),'rawSHA256':digest(raw)}
        if index%200==0:
            print('Packed charts:',index,flush=True)
    result={'byOriginalURL':by_url,'charts':len(by_url),'gzipLevel':7,'rawJSONBytesPreserved':True,
            'savedBytes':sum(item['oldBytes']-item['bytes'] for item in by_url.values())}
    atomic(cache/'chart-index.json',(json.dumps(result,indent=2)+'\n').encode())
    print('Chart cache ready:',len(by_url),'saved bytes',result['savedBytes'],flush=True)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--full-source',type=Path,default=Path('/workspace/phigros'))
    parser.add_argument('--publish',type=Path,default=Path('/workspace/phigros-publish'))
    parser.add_argument('--output',type=Path,default=Path('/workspace/phigros-expanded-release'))
    parser.add_argument('--cache',type=Path,default=Path('/workspace/phigros-pages-packed-assets'))
    parser.add_argument('--media-index',type=Path,default=Path('/workspace/phigros-media-opt/lossless-art-index.json'))
    parser.add_argument('--max-bytes',type=int,default=990_000_000)
    parser.add_argument('--prepare-charts-only',action='store_true')
    parser.add_argument('--keep-legacy-aggregates',action='store_true')
    args=parser.parse_args()
    full,publish,output,cache=(path.resolve() for path in [args.full_source,args.publish,args.output,args.cache])
    if args.prepare_charts_only:
        prepare_charts(full,cache)
        return
    if output.exists() and any(output.iterdir()):
        raise SystemExit('Staging output must be new/empty')
    if output==full or output==publish or full in output.parents or publish in output.parents:
        raise SystemExit('Staging output must be isolated')
    chart_index=json.loads((cache/'chart-index.json').read_text())
    media_index=json.loads(args.media_index.read_text())
    if not media_index.get('complete'):
        raise SystemExit('Wait for complete verified lossless artwork index')
    charts=chart_index['byOriginalURL']; images=media_index['byOriginalURL']
    current,complete=catalog(publish/'js/full-catalog.js'),catalog(full/'js/full-catalog.js')
    source=deepcopy(complete)
    locations={}
    for spec in source['assets']:
        old=spec['url']
        if old in charts:
            value=charts[old]
            spec.update(url=value['url'],byteLength=value['bytes'],packedSha256=value['sha256'])
            locations[value['url'][2:]]=Path(value['source'])
        elif old in images:
            value=images[old]
            if not value.get('rgbaEquivalent'):
                raise ValueError('Unverified artwork: '+old)
            spec.update(url=value['url'],byteLength=value['bytes'],usize=value['bytes'],sha256=value['sha256'],mime='image/webp')
            locations[value['url'][2:]]=full/value['url'][2:]
    art_extensions={}
    for ident,spec in source['artwork'].items():
        old=spec['original']
        if old in images:
            value=images[old]
            spec['original']=value['url']
            spec['losslessStorage']={key:value[key] for key in ['pixelSHA256','originalSHA256','rgbaEquivalent','metadataPreserved','encoding'] if key in value}
            art_extensions[ident]='.webp'
    for entry in source['entries']:
        old_name=entry['meta']['illustration']
        art=next(file for file in entry['files'] if file['name']==old_name)
        if art['asset'] in art_extensions:
            name=Path(old_name).stem+art_extensions[art['asset']]
            entry['meta']['illustration']=name
            art['name']=name
    asset_by_id={spec['id']:spec for spec in source['assets']}
    groups=defaultdict(list)
    for entry in source['entries']:
        groups[entry['audioHash']].append(entry)
    bundle_specs={}
    for song,entries in groups.items():
        ids={file['asset'] for entry in entries for file in entry['files']}
        audio_ids={file['asset'] for entry in entries for file in entry['files'] if file['name']==entry['meta']['music']}
        art_ids={file['asset'] for entry in entries for file in entry['files'] if file['name']==entry['meta']['illustration']}
        files=refs([asset_by_id[ident] for ident in ids])|refs([source['audio'][ident] for ident in audio_ids])|refs([source['artwork'][ident] for ident in art_ids])
        def locate(path):
            return locations.get(path,full/path)
        size=sum(locate(path).stat().st_size for path in files)
        bundle_specs[song]={'entries':entries,'assets':ids,'audio':audio_ids,'artwork':art_ids,'files':files,'bytes':size}
    existing_songs={entry['audioHash'] for entry in current['entries']}
    if not existing_songs.issubset(groups):
        raise ValueError('Full corpus does not contain every existing published song')
    # Only runtime-independent aggregate containers can be omitted. Current
    # builtin assets point to individual files; the source-only manifest is
    # rewritten below to keep its own references and rebuild script usable.
    old_aggregates=[] if args.keep_legacy_aggregates else list((publish/'assets/charts').glob('*.bin'))
    omitted={str(path.relative_to(publish)) for path in old_aggregates}
    changing={'js/full-catalog.js','assets/meta/catalog-coverage.json','assets/meta/pages-release.json','README.md','index.html','assets/manifest.json','assets/meta/lossless-expansion.json'}
    baseline=[]
    for path in publish.rglob('*'):
        if not path.is_file() or '.git' in path.relative_to(publish).parts:
            continue
        rel=str(path.relative_to(publish))
        if rel.startswith(('assets/catalog-charts/','assets/catalog-media/')) or rel in changing or rel in omitted:
            continue
        baseline.append(rel)
    baseline_bytes=sum((publish/path).stat().st_size for path in baseline)
    # Reserve enough metadata space; another full song is never partly copied.
    selected=set(existing_songs)
    selected_bytes=sum(bundle_specs[song]['bytes'] for song in selected)
    available=args.max_bytes-baseline_bytes-1_700_000
    if selected_bytes>available:
        raise ValueError('Existing songs exceed optimized budget; no removals permitted')
    for song in sorted((song for song in groups if song not in selected),key=lambda song:(bundle_specs[song]['bytes'],song)):
        if selected_bytes+bundle_specs[song]['bytes']<=available:
            selected.add(song);selected_bytes+=bundle_specs[song]['bytes']
    entries=[entry for entry in source['entries'] if entry['audioHash'] in selected]
    ids=set().union(*(bundle_specs[song]['assets'] for song in selected))
    audio_ids=set().union(*(bundle_specs[song]['audio'] for song in selected))
    art_ids=set().union(*(bundle_specs[song]['artwork'] for song in selected))
    app=(publish/'js/app.js').read_text()
    builtin=json.loads(re.search(r'const BUILTIN_PACKS\s*=\s*(\[.*?\]);',app,re.S)[1])
    builtin_assets=json.loads(re.search(r'const BUILTIN_ASSETS\s*=\s*(\[.*?\]);',app,re.S)[1])
    for spec in builtin_assets:
        if spec['url'].removeprefix('./') in omitted:
            raise ValueError('Aggregate is still needed at runtime: '+spec['id'])
    song_ids={entry['audioHash'].removeprefix('reference-song:') for entry in [*builtin,*entries]}
    assignments={song:value for song,value in source['collectionAssignments'].items() if song in song_ids}
    group_ids={entry['meta']['collectionId'] for entry in entries}|{value['collectionId'] for value in assignments.values()}
    if any(entry['meta'].get('difficultyClass')=='SP' for entry in builtin):
        group_ids.add('special')
    coverage={**source['coverage'],'addedSongs':len(selected),'addedCharts':len(entries),'historicalSPChartsAdded':sum(entry['audioHash'].startswith('reference-song:historical-sp:') for entry in entries),
              'playableCharts':len(builtin)+len(entries),'playableSongVersions':len(song_ids),'visibleCollections':len(group_ids),
              'releaseType':'github-pages-lossless-expanded-subset','fullSourcePlayableCharts':complete['coverage']['playableCharts'],'fullSourceSongVersions':complete['coverage']['playableSongVersions'],
              'omittedSongVersionsForHostingBudget':len(groups)-len(selected),'allHistoricalAprilFools':False,'chapterStoryAnimationsIncluded':False}
    subset={**source,'entries':entries,'assets':[spec for spec in source['assets'] if spec['id'] in ids],
            'audio':{ident:value for ident,value in source['audio'].items() if ident in audio_ids},
            'artwork':{ident:value for ident,value in source['artwork'].items() if ident in art_ids},
            'collections':[value for value in source['collections'] if value['id'] in group_ids],
            'collectionAssignments':assignments,'coverage':coverage}
    selected_files=set().union(*(bundle_specs[song]['files'] for song in selected))
    output.mkdir(parents=True,exist_ok=True)
    def copy(src,rel):
        dest=output/rel;dest.parent.mkdir(parents=True,exist_ok=True)
        if str(rel).startswith('assets/'):
            try:os.link(src,dest);return
            except OSError:pass
        shutil.copy2(src,dest)
    for rel in baseline:
        copy(publish/rel,rel)
    for rel in selected_files:
        copy(locations.get(rel,full/rel),rel)
    atomic(output/'js/full-catalog.js',('/* Lossless expanded Pages subset; full source retained separately. */\nglobalThis.PhiFullCatalog='+compact(subset)+';\n').encode())
    atomic(output/'assets/meta/catalog-coverage.json',(json.dumps({'version':source['version'],'source':source['source'],**coverage},ensure_ascii=False,indent=2)+'\n').encode())
    manifest=json.loads((publish/'assets/manifest.json').read_text())
    if old_aggregates:
        specs={spec['id']:spec for spec in builtin_assets}
        for entry in manifest['entries']:
            if entry.get('file') in omitted:
                spec=specs[entry['id']]
                entry.update(file=spec['url'][2:],offset=0,bytes=spec['byteLength'],method=spec['method'],originalBytes=spec['usize'],sha256=spec.get('packedSha256') or spec.get('sha256'))
                if spec.get('sha256'):entry['decodedSha256']=spec['sha256']
        manifest['layout']='individual-chart-assets; aggregate sources retained in full development corpus'
    atomic(output/'assets/manifest.json',(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
    prior=json.loads((publish/'assets/meta/pages-release.json').read_text())
    report={**prior,'songs':coverage['playableSongVersions'],'charts':coverage['playableCharts'],'addedSongs':len(selected),'addedCharts':len(entries),
            'publishedSongVersions':coverage['playableSongVersions'],'publishedCharts':coverage['playableCharts'],'selectedNewSongVersions':len(selected),'visibleCollections':len(group_ids),
            'selectedAudioHashes':sorted(selected),'omittedNewSongVersions':len(groups)-len(selected),'sourceCoverage':complete['coverage'],
            'previousPublishedSongVersions':current['coverage']['playableSongVersions'],'previousPublishedCharts':current['coverage']['playableCharts'],
            'selection':'preserve every published song; lossless chart/art storage; then smallest complete additional song bundles',
            'originalQualityPreserved':True,'maxBytes':args.max_bytes,'baseBytes':baseline_bytes,'selectedBundleBytes':selected_bytes}
    atomic(output/'assets/meta/pages-release.json',(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode())
    old_chart_urls={spec['url'] for spec in current['assets'] if spec.get('method')==9}
    old_art_urls={spec['original'] for spec in current['artwork'].values()}
    optimized_old_chart_bytes=sum(charts[url]['oldBytes']-charts[url]['bytes'] for url in old_chart_urls if url in charts)
    optimized_old_art_bytes=sum(images[url]['savedBytes'] for url in old_art_urls if url in images)
    expansion={'previousSongs':current['coverage']['playableSongVersions'],'previousCharts':current['coverage']['playableCharts'],
               'songs':coverage['playableSongVersions'],'charts':coverage['playableCharts'],'addedSongVersionsThisUpdate':len(selected-existing_songs),
               'addedChartsThisUpdate':len(entries)-len(current['entries']),'existingEntryIDsPreserved':all(entry['id'] in {item['id'] for item in entries} for entry in current['entries']),
               'savedPublishedChartBytes':optimized_old_chart_bytes,'savedPublishedArtworkBytes':optimized_old_art_bytes,
               'legacyAggregateBytesRemoved':sum(path.stat().st_size for path in old_aggregates),'chartRawJSONBytesPreserved':True,'artworkDecodedRGBAIdentical':True,
               'audioBytesUnchanged':True,'fullSourceOriginalsUntouched':True,
               'nextCompleteBundleBytes':min((bundle_specs[song]['bytes'] for song in groups if song not in selected),default=0),
               'addedAudioHashes':sorted(selected-existing_songs),'removedFiles':sorted(omitted|{url[2:] for url in old_chart_urls if url in charts}|{url[2:] for url in old_art_urls if url in images}),
               'requiredSyncFiles':['js/full-catalog.js','assets/manifest.json','assets/meta/catalog-coverage.json','assets/meta/pages-release.json','assets/meta/lossless-expansion.json','README.md'],
               'indexIntegration':'Only update pagesReleaseSummary counts in the latest index; preserve independently deployed code/versions.'}
    atomic(output/'assets/meta/lossless-expansion.json',(json.dumps(expansion,ensure_ascii=False,indent=2)+'\n').encode())
    readme=(publish/'README.md').read_text()
    readme=re.sub(r'142 个歌曲／活动版本、429 张谱面',f"{coverage['playableSongVersions']} 个歌曲／活动版本、{coverage['playableCharts']} 张谱面",readme)
    readme=re.sub(r'共 22 个有内容',f"共 {len(group_ids)} 个有内容",readme)
    readme=readme.replace('原始高清曲绘','与原 PNG 解码像素完全一致的无损 WebP 高清曲绘')
    readme+='\n\n本次扩容保留所有已发布歌曲及成绩标识；谱面仅重新 gzip 压缩，解压后的 JSON 字节不变。高清原图以逐像素校验相同的无损 WebP 存储，原 PNG 保留于完整开发资源库，音乐不重编码。旧聚合谱面包由已存在的 individual 文件取代，发布清单同步更新；游玩、导出和离线备份仍使用同一资源索引。扩容报告见 `assets/meta/lossless-expansion.json`。\n'
    atomic(output/'README.md',readme.encode())
    index=(publish/'index.html').read_text()
    index=re.sub(r'Pages 曲库：\d+ 个歌曲／版本 · \d+ 张谱面',f"Pages 曲库：{coverage['playableSongVersions']} 个歌曲／版本 · {coverage['playableCharts']} 张谱面",index)
    atomic(output/'index.html',index.encode())
    own=Path(__file__).resolve()
    copy(own,'scripts/expand-pages-catalog.py')
    art_script=full/'scripts/build-lossless-catalog-art.py'
    if art_script.exists():copy(art_script,'scripts/build-lossless-catalog-art.py')
    # Verify the newly referenced files before publishing any result.
    for spec in subset['assets']:
        raw=(output/spec['url'][2:]).read_bytes()
        if len(raw)!=spec['byteLength'] or digest(raw)!=(spec['packedSha256'] if spec.get('method')==9 else spec['sha256']):
            raise ValueError('Staged asset mismatch: '+spec['id'])
    for path in refs([subset['assets'],subset['audio'],subset['artwork']]):
        if not (output/path).is_file():raise ValueError('Missing staged resource: '+path)
    for _ in range(3):
        total=sum(path.stat().st_size for path in output.rglob('*') if path.is_file())
        report.update(bytes=total,releaseBytes=total,headroomBytes=args.max_bytes-total)
        atomic(output/'assets/meta/pages-release.json',(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode())
    total=sum(path.stat().st_size for path in output.rglob('*') if path.is_file())
    if total>args.max_bytes:raise ValueError('Staging exceeds budget: '+str(total))
    print(json.dumps({key:expansion[key] for key in ['previousSongs','songs','previousCharts','charts','addedSongVersionsThisUpdate','savedPublishedChartBytes','savedPublishedArtworkBytes','legacyAggregateBytesRemoved']},ensure_ascii=False,indent=2))
    print('Staged bytes:',total,'headroom:',args.max_bytes-total,'output:',output)


if __name__=='__main__':
    main()
