"""Freeze only a fully qualified M5-020 pre-release gate; no provider access."""
import importlib.util
import json
from pathlib import Path
import sys

path = Path(__file__).with_name('release-existing.py')
spec = importlib.util.spec_from_file_location('existing_release', path)
op = importlib.util.module_from_spec(spec)
spec.loader.exec_module(op)


def main():
    op.require(len(sys.argv) == 1, 'no_gate_overrides_allowed')
    reviews = json.loads((op.NEUTRAL / 'pre-release-review-bindings.json').read_text())
    paths = op.required_files(reviews)
    gate = {'slice': 'M5-020', 'frozen': True, 'releaseCeiling': 1, 'versionCreationCeiling': 0,
            'versionId': '1158986629121', 'versionTag': op.TAG,
            'sourceHead': op.git('rev-parse', 'HEAD'), 'sourceTree': op.git('rev-parse', 'HEAD^{tree}'),
            'gitDirectory': op.git('rev-parse', '--absolute-git-dir'), 'reviews': reviews,
            'files': [{'path': str(p), 'kind': 'symlink' if p.is_symlink() else 'file', 'sha256': op.digest(p)}
                      for p in sorted(paths)]}
    op.validate_gate_data(gate)
    destination = op.NEUTRAL / 'pre-release-gate.json'
    op.durable_new(destination, gate)
    op.validate_gate(destination)
    print(json.dumps({'classification': 'FULL_PRE_RELEASE_GATE_FROZEN', 'sourceHead': gate['sourceHead'],
                      'fileCount': len(paths), 'gateSha256': op.digest(destination), 'providerRequests': 0}))


if __name__ == '__main__':
    main()
