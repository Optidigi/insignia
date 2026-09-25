#!/usr/bin/env python3
"""Check the resumed run's direct precondition receipts against protected history."""

import json
from pathlib import Path


root = Path(__file__).resolve().parent.parent / "evidence"
current = root / "m0-003r"
prior = root / "m0-003"


def read(folder, name):
    return json.loads((folder / name).read_text())


for name in ("baseline.json", "protected-order.json", "protected-fulfillment.json"):
    assert read(current, name) == read(prior, name), f"protected baseline changed: {name}"

orders = read(current, "order-inventory.json")["orders"]
assert orders["pageInfo"]["hasNextPage"] is False
assert [(item["id"], item["name"], item["test"]) for item in orders["nodes"]] == [
    ("gid://shopify/Order/7184619962526", "#1001", True)
]

readiness = read(current, "readiness.json")
assert readiness["protectedOrder"] == "gid://shopify/Order/7184619962526"
assert readiness["protectedFulfillment"] == "gid://shopify/Fulfillment/6511606562974"
assert readiness["captureMode"] == "NATIVE_UI_PLUS_PUBLIC_API_RECEIPTS"
assert readiness["historicalRootCause"] == "UNDETERMINED"
assert readiness["gateStatus"] == "G1_IN_PROGRESS"
print("PASS: resumed preconditions, protected history and zero-new-order inventory")
