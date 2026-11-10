#!/usr/bin/env python3
"""Reuse dated vision measurements, retaining their nonzero blocked gate."""
import hashlib
import json
from pathlib import Path
from checkpoint_sources import source_state

root = Path(__file__).resolve().parents[1]
directory = root / 'docs/evidence/2026-11-10-vision-resources'
checkpoint = json.loads((directory / 'cors-checkpoint.json').read_text())
raw = (directory / 'ci10-final.json').read_bytes()
if hashlib.sha256(raw).hexdigest() != checkpoint['evidenceSHA256']:
    raise ValueError('Vision checkpoint evidence differs')
evidence = json.loads(raw)
network = evidence['visionNetwork']
required = {'index.html', 'js/app.js', 'js/vision-replay.js',
            'js/site-network-guard.js', 'assets/meta/vision-media.json',
            'assets/meta/vision-audio.json', 'scripts/audit-vision-cors.cjs',
            'docs/evidence/2026-11-10-vision-resources/plan.json',
            'docs/evidence/2026-11-10-vision-resources/content-results.jsonl'}
if set(checkpoint['sourceHashes']) != required:
    raise ValueError('Incomplete vision source dependencies')
if (evidence['head'] != checkpoint['head'] or evidence['run']['id'] != 42870234551
        or evidence['run']['conclusion'] != 'failure'
        or network['status'] != 'blocked' or not network['executableChecksPassed']
        or network['availableCORS'] != 24 or network['externalBlocked'] != 2
        or len(network['fullLoaderResults']) != 4
        or len(network['controlledChecks']) != 7 or network['pageErrors']
        or any(row['status'] != 'passed' for row in
               network['fullLoaderResults'] + network['controlledChecks'])):
    raise ValueError('Incomplete or misclassified vision evidence')
state = source_state(root, checkpoint)
print({'changed': 'run', 'exact': 'reuse-blocked', 'scoped': 'reuse-blocked-scoped'}[state])
