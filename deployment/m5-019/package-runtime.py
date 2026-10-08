"""Package the accepted compiled web bytes with their pinned production dependencies."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
assert not destination.exists(), "destination_must_be_new"
inventory_path = source / "docs/delivery/evidence/m5-018/freeze-round4-inventory.json"
accepted_inventory = subprocess.check_output(
    ["git", "show", "703cfb21a4262675b088cd06289fe08a421ecdd8:docs/delivery/evidence/m5-018/freeze-round4-inventory.json"],
    cwd=source,
)
assert inventory_path.read_bytes() == accepted_inventory, "accepted_inventory_changed"
inventory = json.loads(accepted_inventory)
for row in inventory["source"] + inventory["build"]:
    path = (source / row["path"]).resolve()
    assert path.is_relative_to(source), "inventory_path_escape"
    assert digest(path) == row["sha256"], f"reviewed_bytes_changed: {row['path']}"

subprocess.run(
    ["corepack", "pnpm", "--filter", "@insignia/web", "deploy", "--prod", "--offline", "--legacy", str(destination)],
    cwd=source,
    check=True,
)
for child in destination.iterdir():
    if child.name in {"node_modules", "package.json"}:
        continue
    if child.is_dir() and not child.is_symlink():
        shutil.rmtree(child)
    else:
        child.unlink()
shutil.copytree(source / "apps/web/dist", destination / "dist")
shutil.copytree(source / "packages/database/migrations", destination / "migrations")

# Astro flattened the workspace adapter into a chunk with a root SDK import.
# Expose the SAME production SDK installed for @insignia/shopify, without a
# download, dependency upgrade, source edit or change to the compiled web bytes.
sdk_candidates = list((destination / "node_modules/.pnpm").glob(
    "@shopify+shopify-api@15.0.0/node_modules/@shopify/shopify-api"
))
assert len(sdk_candidates) == 1, "pinned_production_sdk_ambiguous"
sdk = sdk_candidates[0].resolve()
assert json.loads((sdk / "package.json").read_text())["version"] == "15.0.0"
link = destination / "node_modules/@shopify/shopify-api"
link.parent.mkdir(exist_ok=True)
assert not link.exists(), "unexpected_sdk_root_binding"
link.symlink_to(os.path.relpath(sdk, link.parent))
for path in destination.rglob("*"):
    if path.is_symlink():
        assert path.resolve().is_relative_to(destination), "runtime_symlink_escape"
assert digest(destination / "dist/server/entry.mjs") == "5dab1e4f21a7033582c1c2a326c97d6dcadae66ca04566a73a2aca113b4077f7"
print(json.dumps({
    "approvedMerge": "703cfb21a4262675b088cd06289fe08a421ecdd8",
    "reviewedSourceFiles": len(inventory["source"]),
    "reviewedBuildFiles": len(inventory["build"]),
    "webEntrySha256": digest(destination / "dist/server/entry.mjs"),
    "productionSdkVersion": "15.0.0",
    "newBuild": False,
    "providerRequests": 0,
}))
