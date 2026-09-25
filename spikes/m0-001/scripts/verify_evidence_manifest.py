#!/usr/bin/env python3
"""Verify one flat evidence directory against its SHA-256/length manifest."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def verify(manifest_path):
    root = manifest_path.parent
    if manifest_path.name != "manifest.json" or manifest_path.is_symlink():
        raise ValueError("expected a regular manifest.json")
    manifest = json.loads(manifest_path.read_text(), object_pairs_hook=reject_duplicate_keys)
    listed = manifest.get("receiptFiles")
    if not isinstance(listed, dict) or not listed or len(listed) > 1000:
        raise ValueError("invalid receipt file inventory")
    actual = {p.name for p in root.iterdir() if p.name != "manifest.json"}
    if set(listed) != actual:
        raise ValueError("listed files differ from directory contents")
    for name, record in listed.items():
        if name != Path(name).name or "/" in name or "\\" in name or name in (".", "..", "manifest.json"):
            raise ValueError("unsafe receipt name")
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("non-regular receipt")
        if not isinstance(record, dict) or not isinstance(record.get("bytes"), int) or isinstance(record["bytes"], bool) or record["bytes"] < 0:
            raise ValueError("invalid receipt length")
        digest = record.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("invalid receipt hash")
        if path.stat().st_size != record["bytes"]:
            raise ValueError("receipt length mismatch")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("receipt hash mismatch")
    return len(listed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    try:
        count = verify(args.manifest)
    except (OSError, ValueError, TypeError) as exc:
        print(f"manifest verification failed: {exc}", file=sys.stderr)
        return 1
    print(f"verified {count} evidence files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
