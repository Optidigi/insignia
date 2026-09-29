"""Keep archived Cargo spikes independent of the new root workspace."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
manifests = sorted((ROOT / "spikes").rglob("Cargo.toml"))
if not manifests:
    raise SystemExit("No archived Cargo manifests found")

for manifest in manifests:
    result = subprocess.run(
        [
            "cargo",
            "metadata",
            "--manifest-path",
            str(manifest),
            "--no-deps",
            "--format-version",
            "1",
            "--locked",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    workspace_root = Path(json.loads(result.stdout)["workspace_root"])
    if workspace_root != manifest.parent:
        raise SystemExit(f"Archived crate joined another workspace: {manifest}")

print(f"{len(manifests)} archived Cargo manifests remain independent")
