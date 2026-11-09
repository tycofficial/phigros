#!/usr/bin/env python3
"""Copy the complete existing runtime without selecting or re-encoding assets.

Developer scripts, tests, and work evidence stay outside the served game.
The existing check-pages-release.cjs validates the result, including its size
limit. This is a packaging check, not an official Phigros equivalence check.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    report = args.report.resolve()
    if output == source or output in source.parents:
        parser.error('Output cannot replace the source directory or an ancestor')
    if any(output == source / name or source / name in output.parents
           for name in ('assets', 'css', 'js', 'workers', 'tests', 'scripts')):
        parser.error('Output cannot be inside a source or resource directory')
    if output.exists() and any(output.iterdir()):
        parser.error('Output must be a new or empty directory')
    if report == output or output in report.parents:
        parser.error('The development report must stay outside the runtime')
    output.mkdir(parents=True, exist_ok=True)
    runtime_roots = ['index.html', 'sw.js', '.nojekyll', 'assets', 'css', 'js', 'workers']
    entries = []
    for name in runtime_roots:
        item = source / name
        paths = sorted(p for p in item.rglob('*') if p.is_file()) if item.is_dir() else [item]
        for path in paths:
            relative = path.relative_to(source)
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            with path.open('rb') as stream:
                original_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
            with target.open('rb') as stream:
                copied_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
            if original_hash != copied_hash:
                raise RuntimeError('Copy verification failed: ' + str(relative))
            entries.append({'path': relative.as_posix(), 'bytes': path.stat().st_size,
                            'sha256': copied_hash})
    checked = subprocess.run(['node', str(source / 'scripts/check-pages-release.cjs'), str(output)],
                             cwd=source, capture_output=True, text=True)
    result = {'scope': 'Complete unchanged runtime packaging, not official consistency',
              'officialReferenceVersion': None, 'officialAcceptance': '阻塞',
              'source': str(source), 'output': str(output), 'runtimeRoots': runtime_roots,
              'excludedDevelopmentPaths': ['tests/', 'scripts/', 'work/', '.git/', 'repository documentation'],
              'runtimeFileCount': len(entries), 'runtimeBytes': sum(item['bytes'] for item in entries),
              'resourceFilesRemoved': 0, 'resourceFilesReencoded': 0,
              'validationExitCode': checked.returncode,
              'validationStdout': checked.stdout, 'validationStderr': checked.stderr,
              'files': entries}
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'files'}, ensure_ascii=False))
    return checked.returncode


if __name__ == '__main__':
    raise SystemExit(main())
