#!/usr/bin/env python3
"""Verify deployed runtime bytes against this checkout; not official-game parity."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

FILES = (
    'index.html', 'sw.js', 'css/style.css', 'css/interactive-replay.css',
    'js/hosted-media.js', 'js/app.js', 'js/loading-presentation.js', 'js/course-mode.js', 'js/interactive-replay.js',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--timeout', type=float, default=540)
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    base = args.base_url.rstrip('/') + '/'
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
        parser.error('A public HTTP(S) base URL is required')
    expected = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in FILES}
    revision = os.environ.get('GITHUB_SHA') or expected['index.html']
    deadline = time.monotonic() + max(0, args.timeout)
    report = {'scope': 'Published file identity, not gameplay or official fidelity',
              'baseUrl': base, 'revision': revision, 'passed': False, 'attempts': []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    while True:
        attempt = {'atUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'files': []}
        for name, digest in expected.items():
            path = '' if name == 'index.html' else name
            url = urllib.parse.urljoin(base, path) + '?deploy=' + urllib.parse.quote(revision, safe='')
            item = {'file': name, 'url': url, 'expectedSHA256': digest}
            try:
                request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Phigros-release-verification'})
                with urllib.request.urlopen(request, timeout=20) as response:
                    body = response.read()
                    item.update(httpStatus=response.status, bytes=len(body),
                                actualSHA256=hashlib.sha256(body).hexdigest())
                    item['passed'] = response.status == 200 and item['actualSHA256'] == digest
            except (urllib.error.URLError, OSError, TimeoutError) as error:
                item.update(passed=False, error=str(error))
            attempt['files'].append(item)
        report['attempts'].append(attempt)
        report['passed'] = all(item['passed'] for item in attempt['files'])
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        if report['passed']:
            print(json.dumps({'passed': True, 'baseUrl': base, 'revision': revision,
                              'verifiedFiles': len(expected), 'attempts': len(report['attempts'])}))
            return 0
        failed = [item['file'] for item in attempt['files'] if not item['passed']]
        print('Waiting for matching deployed files: ' + ', '.join(failed), flush=True)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return 1
        time.sleep(min(max(0.1, args.interval), remaining))


if __name__ == '__main__':
    raise SystemExit(main())
