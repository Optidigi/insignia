#!/usr/bin/env python3
"""Bind retained live receipts to reviewed source and the Wasm used by preview."""

import base64
import hashlib
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[3]
SPIKE = REPO / "spikes/m0-006"
EVIDENCE = SPIKE / "evidence"
LIVE = EVIDENCE / "live-artifact-manifest.json"
WASM = {
    "transform": SPIKE / "extensions/transform/target/wasm32-unknown-unknown/release/m0-006-cart-transform.wasm",
    "validation": SPIKE / "extensions/validation/target/wasm32-unknown-unknown/release/m0-006-cart-validation.wasm",
}
PREVIEW_BUNDLE_WASM = {
    name: EVIDENCE / f"live-preview-{name}.wasm" for name in WASM
}
PREVIEW_BUNDLE_BASE64 = {
    name: EVIDENCE / f"live-preview-{name}.base64" for name in WASM
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path):
    return str(path.relative_to(REPO))


def source_paths():
    own = [
        p for root in (SPIKE / "extensions", SPIKE / "scripts", SPIKE / "web")
        for p in root.rglob("*") if p.is_file()
        and not any(part in {"target", ".shopify", "__pycache__"} for part in p.parts)
    ]
    own += [SPIKE / "shopify.app.toml", SPIKE / "package.json", SPIKE / ".gitignore"]
    imported = [
        REPO / "spikes/m0-004/ts/allocation.ts",
        REPO / "spikes/m0-005/ts/whole-quote.ts",
    ]
    imported += [p for p in (REPO / "spikes/m0-005/rust/authorization").rglob("*")
                 if p.is_file() and "target" not in p.parts]
    return sorted(set(own + imported))


def receipt_paths():
    return sorted(p for p in EVIDENCE.iterdir() if p.suffix in {".json", ".png", ".wasm", ".base64", ".graphql", ".md"}
                  and p.name not in {"live-artifact-manifest.json", "ci-manifest.json", "ci-preview-replay.json"})


def mapping(paths):
    return {relative(p): digest(p) for p in paths}


def hashes(paths):
    return {name: digest(path) for name, path in paths.items()}


def preview_identity():
    identity = json.loads((EVIDENCE / "preview-bundle-identity.json").read_text())
    by_name = {row["handle"].removeprefix("m0-006-live-"): row["sha256"]
               for row in identity["functions"]}
    raw = hashes(PREVIEW_BUNDLE_BASE64)
    if by_name != raw:
        raise SystemExit(f"preview bundle manifest differs from retained encoded assets: {by_name} != {raw}")
    for name in WASM:
        decoded = base64.b64decode(PREVIEW_BUNDLE_BASE64[name].read_bytes(), validate=True)
        if decoded[:4] != b"\x00asm" or decoded != PREVIEW_BUNDLE_WASM[name].read_bytes():
            raise SystemExit(f"decoded preview bundle mismatch: {name}")
    return {"encoded": raw, "executable": hashes(PREVIEW_BUNDLE_WASM)}


if len(sys.argv) != 2 or sys.argv[1] not in {"write-live", "verify"}:
    raise SystemExit("usage: capture-manifest.py write-live|verify")

current = {
    "sourceSha256": mapping(source_paths()),
    "retainedReceiptSha256": mapping(receipt_paths()),
}
if sys.argv[1] == "write-live":
    if LIVE.exists():
        raise SystemExit("live manifest already exists; remove it only after inspecting source/evidence changes")
    current.update({
        "provenance": "Shopify CLI 4.8.2 app dev preview on insignia-staging, 2026-09-26 UTC. Bundle dist/index.wasm is base64 text; encoded and decoded executable hashes are both retained and cross-checked against the sanitized bundle manifest. The preview target executables matched decoded bundle bytes; later rebuilds are reported separately.",
        "apiVersion": "2026-07",
        "reviewedPr8Head": "eb1abc3b1828d3aa5e6b99cc785f5e25f2839ffa",
        "branchStartMerge": "9f08c8ff6ee8a6a908b976c26f8435e4301308c5",
        "shopId": "gid://shopify/Shop/78935261342",
        "appClientId": "942e6668fd1177524c0fc48b104b0ac3",
        "functionIds": {
            "transform": "01a0dd73-c92d-7e3d-9fce-0de90d2de0e6",
            "validation": "01a0dd73-c92d-7c82-b5fe-9db76eafaeb5",
        },
        "livePreviewBundleSha256": preview_identity(),
        "previewTargetWasmSha256": {
            "transform": "f98e32af930b7e3cb27b9b48bed245515510bcdc141e5e0c43a68b3cf4296639",
            "validation": "701582c4d750c8ce42abfff3d9627814459e522d1d0f225f466d242759e5b9fb",
        },
    })
    LIVE.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
    print(relative(LIVE))
else:
    live = json.loads(LIVE.read_text())
    if live["livePreviewBundleSha256"] != preview_identity():
        raise SystemExit("retained preview bundle assets differ from recorded live hashes")
    for key in ("sourceSha256", "retainedReceiptSha256"):
        if live[key] != current[key]:
            old, new = set(live[key]), set(current[key])
            changed = sorted(p for p in old & new if live[key][p] != current[key][p])
            raise SystemExit(f"{key} mismatch: removed={sorted(old-new)}, added={sorted(new-old)}, changed={changed}")
    built = hashes(WASM)
    print(json.dumps({
        "sourceFileCount": len(current["sourceSha256"]),
        "retainedReceiptCount": len(current["retainedReceiptSha256"]),
        "reviewedPr8Head": live["reviewedPr8Head"],
        "livePreviewBundleSha256": live["livePreviewBundleSha256"],
        "currentBuildWasmSha256": built,
        "byteIdenticalToLivePreview": {name: built[name] == live["livePreviewBundleSha256"]["executable"][name]
                                       for name in built},
    }, indent=2, sort_keys=True))
