#!/usr/bin/env python3
"""Keep the dated main CORS evidence when its exact tested sources are unchanged."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
checkpoint = json.loads((root / 'docs/evidence/2026-11-10-remote-resources/cors-checkpoint.json').read_text())
if checkpoint['nativeCORSPassed'] != 1091 or checkpoint['ciConclusion'] != 'success':
    raise ValueError('Cannot reuse incomplete main CORS evidence')
changed = any(not (root / name).is_file() or hashlib.sha256((root / name).read_bytes()).hexdigest() != expected
              for name, expected in checkpoint['sourceHashes'].items())
print('run' if changed else 'reuse')
