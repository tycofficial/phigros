#!/usr/bin/env python3
"""Resume a bounded byte-integrity audit of a fixed plan; no official parity claim.

Uses inherited HTTP(S) proxy/CA settings. Verified resources are cached outside
the runtime assets and never downloaded again by this audit. Browser CORS is a
separate result: server-side HTTP success cannot establish browser availability.
"""
import argparse
import concurrent.futures
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone


def utc():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def audit(args):
    def read(path):
        data = path.read_bytes()
        return gzip.decompress(data) if path.suffix == '.gz' else data
    plan_bytes = read(args.plan)
    plan = json.loads(plan_bytes)
    plan_hash = hashlib.sha256(plan_bytes).hexdigest()
    resources = plan['resources']
    root = Path(__file__).resolve().parents[1]
    if plan.get('scopeKind') == 'vision':
        paths = ['assets/meta/vision-media.json', 'assets/meta/vision-audio.json']
        manifest_bytes = b'\0'.join((root / p).read_bytes() for p in paths)
        known = {}
        for p, key in zip(paths, ['videos', 'audios']):
            for entry in json.loads((root / p).read_text())[key]:
                known[entry['url']] = known[entry['mirror']] = entry
    else:
        manifest_bytes = (root / 'js/remote-assets.js').read_bytes()
        source_text = manifest_bytes.decode()
        marker = 'const known = Object.freeze('
        known = json.JSONDecoder().raw_decode(source_text.split(marker, 1)[1])[0]
    if hashlib.sha256(manifest_bytes).hexdigest() != plan['manifestSHA256']:
        raise ValueError('Current remote manifest differs from the evidence plan')
    assert len({r['url'] for r in resources}) == len(resources)
    assert sum(r['expectedBytes'] for r in resources) == plan['expectedTotalBytes']
    if {r['url'] for r in resources} != set(known):
        raise ValueError('The plan does not cover exactly the current allowlist')
    for spec in resources:
        current = known[spec['url']]
        if (spec['expectedBytes'], spec['expectedSHA256'], spec['mirror']) != (
                current['bytes'], current['sha256'], current['mirror']):
            raise ValueError('Plan expectations differ from the current fixed entry')
        if not re.fullmatch('[0-9a-f]{40}', spec['expectedGitBlobSHA']):
            raise ValueError('Missing expected upstream Git blob hash')
    if args.verify_journal:
        rows = [json.loads(line) for line in read(args.verify_journal).decode().splitlines()]
        by_url = {row['url']: row for row in rows}
        if len(rows) != len(by_url) or set(by_url) != set(known):
            raise ValueError('Journal has duplicate or missing fixed URLs')
        for spec in resources:
            row = by_url[spec['url']]
            if row['planSHA256'] != plan_hash:
                raise ValueError('Journal plan fingerprint differs')
            if args.allow_blocked and row['status'] == 'blocked' and row.get('httpStatus') in (401, 403, 429, 451) and row.get('reason'):
                continue
            if row['status'] != 'passed' or (row['actualBytes'], row['actualSHA256'], row['actualGitBlobSHA']) != (spec['expectedBytes'], spec['expectedSHA256'], spec['expectedGitBlobSHA']):
                raise ValueError('Journal measurement does not match the fixed plan')
        print(json.dumps({'scope': 'Consistency of historical measured evidence, no network requests',
                          'passed': True, 'resources': len(rows), 'bytes': plan['expectedTotalBytes'],
                          'contentPassed': sum(x['status'] == 'passed' for x in rows),
                          'externallyBlocked': sum(x['status'] == 'blocked' for x in rows),
                          'networkRequests': 0, 'browserCORS': 'not_checked_by_this_validator'}))
        return 0
    output = args.output.resolve()
    if output == root or output == root / 'assets' or root / 'assets' in output.parents:
        raise ValueError('Audit output must not overwrite the runtime root or assets')
    args.output.mkdir(parents=True, exist_ok=True)
    cache = args.output / 'cache'
    cache.mkdir(exist_ok=True)
    journal = args.output / 'results.jsonl'
    existing = {}
    if journal.exists():
        for line in journal.read_text().splitlines():
            row = json.loads(line)
            if row['planSHA256'] != plan_hash:
                raise ValueError('Plan changed: use another output directory, do not mix evidence')
            existing[row['url']] = row
    lock = threading.Lock()
    stopped_hosts = {}
    stopped_refs = {}
    session_started = utc()
    previously_recorded = len(existing)

    def append(row):
        row['planSHA256'] = plan_hash
        row['recordedAt'] = utc()
        with lock:
            with journal.open('a') as stream:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            existing[row['url']] = row
            passed = [r for r in existing.values() if r['status'] == 'passed']
            print(json.dumps({'at': utc(), 'completed': len(existing), 'passed': len(passed),
                              'verifiedBytes': sum(r['actualBytes'] for r in passed),
                              'lastStatus': row['status'], 'lastURL': row['url']}, ensure_ascii=False), flush=True)

    # Reuse the four prior measured results without inventing missing cache bytes.
    for sample in plan.get('historicalSamples', []):
        if sample['url'] in existing:
            continue
        expected = next(r for r in resources if r['url'] == sample['url'])
        if (sample['actualBytes'], sample['actualSHA256'], sample['actualGitBlobSHA']) != (
                expected['expectedBytes'], expected['expectedSHA256'], expected['expectedGitBlobSHA']):
            raise ValueError('Historical sample differs from fixed plan')
        append({**sample, 'source': expected['source'], 'references': expected['references'],
                'status': 'passed', 'reusedHistoricalEvidence': True,
                'checkedAt': plan['historicalSampleDate'],
                'timestampPrecision': 'day; prior sample log has no per-item UTC timestamp',
                'cacheFile': None, 'browserCORS': 'not_verified'})

    pending = [r for r in resources if r['url'] not in existing or
               (args.retry_failed and existing[r['url']]['status'] != 'passed')]
    if args.limit:
        pending = pending[:args.limit]

    def one(spec):
        host = urllib.parse.urlsplit(spec['url']).hostname
        with lock:
            denied = stopped_hosts.get(host) or stopped_refs.get((host, spec['source']['fixedRef']))
        base = {'url': spec['url'], 'source': spec['source'], 'references': spec['references'],
                'expectedBytes': spec['expectedBytes'], 'expectedSHA256': spec['expectedSHA256'],
                'expectedGitBlobSHA': spec['expectedGitBlobSHA'], 'checkedAt': utc(),
                'browserCORS': 'not_verified', 'backend': 'urllib / inherited proxy and CA trust'}
        if denied:
            return {**base, 'status': 'skipped', 'reason': denied}
        target = cache / (spec['expectedSHA256'] + '.bin')
        temporary = cache / (spec['expectedSHA256'] + '.' + uuid.uuid4().hex + '.part')
        began = time.monotonic()
        try:
            # A primary byte cache never substitutes for a first independent
            # mirror measurement. Previously passed URL rows are skipped above.
            cached = target.exists() and spec.get('allowSharedCacheReuse', True)
            sha256 = hashlib.sha256()
            sha1 = hashlib.sha1(b'blob ' + str(spec['expectedBytes']).encode() + b'\0')
            received = 0
            if cached:
                source = target.open('rb')
                sink = None
                metadata = {'reusedCache': True, 'cacheFile': str(target)}
            else:
                request = urllib.request.Request(spec['url'], headers={'User-Agent': 'Phigros-fixed-resource-audit'})
                source = urllib.request.build_opener(NoRedirect()).open(request, timeout=20)
                sink = temporary.open('wb')
                metadata = {'httpStatus': source.status, 'responseURL': source.url,
                            'contentType': source.headers.get('Content-Type'),
                            'allowOriginHeader': source.headers.get('Access-Control-Allow-Origin'),
                            'etag': source.headers.get('ETag'), 'reusedCache': False}
                if source.url != spec['url'] or source.status != 200:
                    source.close()
                    sink.close()
                    raise ValueError('Unexpected status/redirect; not a match to the pinned URL')
            with source:
                try:
                    while True:
                        if time.monotonic() - began > 120:
                            raise TimeoutError('Resource audit exceeded 120 seconds')
                        block = source.read(min(1024 * 1024, spec['expectedBytes'] + 1 - received))
                        if not block:
                            break
                        received += len(block)
                        if received > spec['expectedBytes']:
                            raise ValueError('Response exceeds the pinned byte length')
                        sha256.update(block)
                        sha1.update(block)
                        if sink:
                            sink.write(block)
                finally:
                    if sink:
                        sink.close()
            measured = {'actualBytes': received, 'actualSHA256': sha256.hexdigest(),
                        'actualGitBlobSHA': sha1.hexdigest() if received == spec['expectedBytes'] else None}
            valid = (received, sha256.hexdigest(), measured['actualGitBlobSHA']) == (
                spec['expectedBytes'], spec['expectedSHA256'], spec['expectedGitBlobSHA'])
            if valid and not cached:
                temporary.replace(target)
            return {**base, **metadata, **measured, 'status': 'passed' if valid else 'failed',
                    'cacheFile': str(target) if valid else None,
                    'reason': None if valid else 'Byte length, SHA256 or Git blob hash mismatch',
                    'elapsedSeconds': round(time.monotonic() - began, 3)}
        except urllib.error.HTTPError as error:
            blocked = error.code in (401, 403, 451, 429)
            detail = error.read(1024).decode('utf-8', 'replace')
            reason = str(error) + '; ' + detail
            if error.code == 429:
                reason += '; Retry-After=' + str(error.headers.get('Retry-After'))
            if blocked:
                with lock:
                    if error.code == 403 and 'file size' in detail.lower():
                        pass  # Explicit file-size denial: other files are independent.
                    elif error.code == 403 and 'package size' in detail.lower():
                        stopped_refs[(host, spec['source']['fixedRef'])] = reason
                    else:
                        stopped_hosts[host] = 'Source paused after ' + reason + '; no mirror or automatic retry'
            return {**base, 'status': 'blocked' if blocked else 'failed', 'httpStatus': error.code,
                    'reason': reason, 'elapsedSeconds': round(time.monotonic() - began, 3)}
        except (OSError, ValueError, TimeoutError) as error:
            return {**base, 'status': 'failed', 'reason': str(error),
                    'elapsedSeconds': round(time.monotonic() - began, 3)}
        finally:
            temporary.unlink(missing_ok=True)

    # Submit only one item per worker at a time, so an access/rate denial can
    # stop its host without enqueuing the entire manifest.
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        iterator = iter(pending)
        running = {}
        for spec in list(next(iterator, None) for _ in range(args.workers)):
            if spec:
                running[pool.submit(one, spec)] = spec
        while running:
            done, _ = concurrent.futures.wait(running, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                running.pop(future)
                append(future.result())
                spec = next(iterator, None)
                if spec:
                    running[pool.submit(one, spec)] = spec
    counts = {status: sum(r['status'] == status for r in existing.values())
              for status in ('passed', 'failed', 'blocked', 'skipped')}
    summary = {'scope': 'Content integrity at fixed URLs, not browser CORS or official authenticity',
               'planSHA256': plan_hash, 'sessionStartedAt': session_started, 'finishedAt': utc(),
               'expectedResources': len(resources), 'expectedTotalBytes': plan['expectedTotalBytes'],
               'previouslyRecordedResources': previously_recorded, 'scheduledResources': len(pending),
               'recordedResources': len(existing), 'notAttempted': len(resources) - len(existing),
               **counts, 'verifiedBytes': sum(r.get('actualBytes', 0) for r in existing.values() if r['status'] == 'passed'),
               'workers': args.workers, 'browserCORS': 'not_verified', 'officialAcceptance': 'blocked'}
    (args.output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 1 if any(counts[x] for x in ('failed', 'blocked', 'skipped')) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify-journal', type=Path, help='Validate archived measurements without downloads')
    parser.add_argument('--allow-blocked', action='store_true', help='Validate denial evidence without accepting blocked content as passed')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=3)
    parser.add_argument('--limit', type=int, default=0, help='Maximum new resources, zero means all pending')
    parser.add_argument('--retry-failed', action='store_true')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('--limit must be nonnegative')
    if not args.output and not args.verify_journal:
        parser.error('--output is required for a network audit')
    return audit(args)


if __name__ == '__main__':
    raise SystemExit(main())
