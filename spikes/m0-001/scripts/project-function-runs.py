#!/usr/bin/env python3
"""Project selected Shopify Function logs without cart-line IDs or session data."""

import hashlib
import json
import sys
from pathlib import Path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def project(path: Path) -> dict:
    raw = path.read_bytes()
    record = json.loads(raw)
    if (
        record["storeName"] != "insignia-staging.myshopify.com"
        or record["shopId"] != 78935261342
        or record["apiClientId"] != 427859050497
        or record["source"] != "m0-001-same-variant"
    ):
        raise ValueError(f"unexpected Function log identity: {path.name}")
    payload = record["payload"]
    lines = payload["input"]["cart"]["lines"]
    operations = payload["output"]["operations"]
    return {
        "sourceFile": path.name,
        "sourceSha256": sha256(raw),
        "timestamp": record["logTimestamp"],
        "status": record["status"],
        "shopId": record["shopId"],
        "apiClientId": record["apiClientId"],
        "functionHandle": record["source"],
        "fuelConsumed": payload.get("fuelConsumed"),
        "inputLines": [
            {
                "cartLineIdSha256": sha256(line["id"].encode()),
                "quantity": line["quantity"],
                "marker": (line.get("marker") or {}).get("value"),
                "currency": line["cost"]["amountPerQuantity"]["currencyCode"],
                "merchandiseType": line["merchandise"]["__typename"],
                "variantId": line["merchandise"]["id"],
            }
            for line in lines
        ],
        "outputOperations": [
            {
                "cartLineIdSha256": sha256(op["lineExpand"]["cartLineId"].encode()),
                "expandedCartItems": op["lineExpand"]["expandedCartItems"],
            }
            for op in operations
        ],
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: project-function-runs.py OUTPUT LOG [LOG ...]")
    output = Path(sys.argv[1])
    projected = [project(Path(name)) for name in sys.argv[2:]]
    output.write_text(json.dumps(projected, indent=2, ensure_ascii=False) + "\n")
