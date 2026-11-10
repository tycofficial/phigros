"""Classify dated audit applicability; never claim fresh network measurements."""
import hashlib


def source_state(root, checkpoint):
    state = 'exact'
    for name, measured in checkpoint['sourceHashes'].items():
        file = root / name
        if not file.is_file():
            return 'changed'
        current = file.read_bytes()
        digest = hashlib.sha256(current).hexdigest()
        if digest == measured:
            continue
        proof = checkpoint.get('scopedSourceChanges', {}).get(name)
        if not proof or digest != proof['currentSHA256']:
            return 'changed'
        if proof['measuredSHA256'] != measured:
            raise ValueError('Scoped change points to different measured source')
        reconstructed = current
        for edit in proof['reverseEdits']:
            before, after = edit['before'].encode(), edit['after'].encode()
            if not before or reconstructed.count(before) != edit['count']:
                raise ValueError('Recorded scoped edit count differs')
            reconstructed = reconstructed.replace(before, after)
        if hashlib.sha256(reconstructed).hexdigest() != measured:
            raise ValueError('Scoped edits do not reconstruct measured source')
        state = 'scoped'
    return state
