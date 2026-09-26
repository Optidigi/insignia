#!/usr/bin/env python3
"""Project a real Shopify dev Function log to the query-limited review fields."""
import hashlib
import json
import pathlib
import sys


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: project-function-log.py <.shopify/log.json> <evidence.json>")
    source, target = map(pathlib.Path, sys.argv[1:])
    raw = source.read_bytes()
    event = json.loads(raw)
    if event["shopId"] != 78935261342 or event["apiClientId"] != 427859050497:
        raise SystemExit("unexpected shop/app identity")
    if event["source"] not in {"m0-006-live-transform", "m0-006-live-validation"}:
        raise SystemExit("unexpected Function source")
    payload = event["payload"]
    if payload["target"] not in {"cart.transform.run", "cart.validations.generate.run"}:
        raise SystemExit("unexpected Function target")
    # Both pinned input queries exclude customer and address fields. Keep those
    # exact Shopify-reported inputs and outputs, not reconstructed fixtures.
    projection = {
        "provenance": "Shopify CLI app dev Function log",
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "logTimestamp": event["logTimestamp"],
        "shopId": event["shopId"],
        "apiClientId": event["apiClientId"],
        "source": event["source"],
        "status": event["status"],
        "target": payload["target"],
        "functionId": payload["functionId"],
        "inputBytes": payload["inputBytes"],
        "outputBytes": payload["outputBytes"],
        "fuelConsumed": payload["fuelConsumed"],
        "input": payload["input"],
        "output": payload["output"],
    }
    target.write_text(json.dumps(projection, indent=2) + "\n")


if __name__ == "__main__":
    main()
