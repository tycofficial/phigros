#!/usr/bin/env python3
"""Keep the dated main CORS evidence when its exact tested sources are unchanged."""
import json
from pathlib import Path
from checkpoint_sources import source_state

root = Path(__file__).resolve().parents[1]
checkpoint = json.loads((root / 'docs/evidence/2026-11-10-remote-resources/cors-checkpoint.json').read_text())
if checkpoint['nativeCORSPassed'] != 1091 or checkpoint['ciConclusion'] != 'success':
    raise ValueError('Cannot reuse incomplete main CORS evidence')
state = source_state(root, checkpoint)
print({'changed': 'run', 'exact': 'reuse', 'scoped': 'reuse-scoped'}[state])
