#!/usr/bin/env python3
"""Probe and fully decode already verified cached media; no network/media writes."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', required=True, type=Path)
    p.add_argument('--cache', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    plan = json.loads(args.plan.read_text())
    report = {'scope': 'Cached original bytes, container metadata and FFmpeg full decode to null; not official audiovisual fidelity or complete browser playback',
              'startedAt': now(), 'networkRequests': 0, 'results': [], 'officialAcceptance': 'blocked'}
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        report.update(status='blocked', reason='ffmpeg or ffprobe unavailable')
    else:
        report['ffmpegVersion'] = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
        report['ffprobeVersion'] = subprocess.check_output(['ffprobe', '-version'], text=True).splitlines()[0]

        def inspect(spec):
            path = args.cache / (spec['sha256'] + '.bin')
            data = path.read_bytes()
            if len(data) != spec['bytes'] or hashlib.sha256(data).hexdigest() != spec['sha256']:
                raise ValueError('Cache does not match expected original bytes: ' + spec['id'])
            probe = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)], capture_output=True, text=True, timeout=30)
            cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-xerror', '-threads', '1', '-i', str(path), '-map', '0:v?', '-map', '0:a?', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-']
            decode = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            progress = dict(line.split('=', 1) for line in decode.stdout.splitlines() if '=' in line)
            result = {'id': spec['id'], 'url': spec['url'], 'checkedAt': now(), 'bytes': len(data), 'sha256': spec['sha256'],
                      'probeExitCode': probe.returncode, 'metadata': json.loads(probe.stdout) if probe.returncode == 0 else None,
                      'probeError': probe.stderr, 'decodeExitCode': decode.returncode, 'decodeError': decode.stderr,
                      'fullDecodeProgress': progress, 'decodeCommand': cmd, 'sourceMediaModified': False,
                      'status': 'passed' if probe.returncode == 0 and decode.returncode == 0 and not decode.stderr.strip() and progress.get('progress') == 'end' else 'failed'}
            print(json.dumps({'id': spec['id'], 'status': result['status'], 'at': now()}), flush=True)
            return result

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            report['results'] = list(pool.map(inspect, plan['contents']))
        report['status'] = 'passed' if all(x['status'] == 'passed' for x in report['results']) else 'failed'
    report['finishedAt'] = now()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'decoded': len(report['results']), 'networkRequests': 0}))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
