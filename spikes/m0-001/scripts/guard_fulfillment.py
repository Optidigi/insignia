#!/usr/bin/env python3
"""Fail closed on a projected native fulfillment form before any submit click.

This checks a *read-only projection*. A passing form does not authorize a
mutation: the actual outgoing native request must also be captured and matched.
"""

import argparse
import json
import sys
from pathlib import Path


def positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def line_key(line):
    return (line.get("fulfillmentOrderLineItemId"), line.get("lineItemId"))


def valid_identity(key):
    return (
        isinstance(key[0], str) and key[0].startswith("gid://shopify/FulfillmentOrderLineItem/")
        and isinstance(key[1], str) and key[1].startswith("gid://shopify/LineItem/")
    )


def guard(form):
    reasons = []
    selected = []
    if not isinstance(form, dict) or not str(form.get("fulfillmentOrderId", "")).startswith("gid://shopify/FulfillmentOrder/"):
        return {"allowed": False, "submissionAuthorized": False, "phase": "FORM_ONLY", "selected": [], "reasons": ["missing fulfillment order identity"]}
    intent = form.get("intent")
    rows = form.get("rows")
    aggregate = form.get("aggregateSelectedCount")
    if not isinstance(intent, list) or not intent or not isinstance(rows, list) or not rows:
        return {"allowed": False, "submissionAuthorized": False, "phase": "FORM_ONLY", "selected": [], "reasons": ["missing intent or rows"]}
    if not positive_int(aggregate):
        reasons.append("invalid aggregate count")
    intended = {}
    for line in intent:
        if not isinstance(line, dict) or not valid_identity(line_key(line)) or not positive_int(line.get("quantity")) or line["quantity"] == 0:
            if isinstance(line, dict) and not valid_identity(line_key(line)):
                reasons.append("invalid identity format")
            reasons.append("invalid intent line")
            continue
        key = line_key(line)
        if key in intended:
            reasons.append("duplicate intent identity")
        intended[key] = line["quantity"]
    if len(intended) != 1 or list(intended.values()) != [1]:
        reasons.append("exactly one target unit required")
    observed = {}
    for line in rows:
        if not isinstance(line, dict) or not valid_identity(line_key(line)) or not positive_int(line.get("effectiveQuantity")):
            if isinstance(line, dict) and not valid_identity(line_key(line)):
                reasons.append("invalid identity format")
            reasons.append("unmapped or invalid row")
            continue
        key = line_key(line)
        if key in observed:
            reasons.append("duplicate row identity")
        quantity = line["effectiveQuantity"]
        observed[key] = quantity
        if (
            type(line.get("checked")) is not bool
            or type(line.get("disabled")) is not bool
            or type(line.get("indeterminate")) is not bool
            or line.get("ariaChecked") not in ("true", "false")
            or line.get("inputValue") != str(quantity)
        ):
            reasons.append("unknown control state")
        elif line["indeterminate"] or line["ariaChecked"] != str(line["checked"]).lower():
            reasons.append("inconsistent control state")
        if line.get("checked") is True and key not in intended:
            reasons.append("checked non-target row")
        if quantity > 0:
            selected.append({"fulfillmentOrderLineItemId": key[0], "lineItemId": key[1], "quantity": quantity})
            if key not in intended:
                reasons.append("non-target positive quantity")
            if line.get("checked") is False:
                reasons.append("unchecked positive quantity")
        if line.get("disabled") is True and quantity > 0:
            reasons.append("disabled positive quantity")
    if set(intended) - set(observed):
        reasons.append("target row missing")
    if {key: qty for key, qty in observed.items() if qty > 0} != intended:
        reasons.append("selected identities or quantities mismatch")
    if positive_int(aggregate) and aggregate != sum(intended.values()):
        reasons.append("aggregate quantity mismatch")
    if positive_int(aggregate) and aggregate != sum(observed.values()):
        reasons.append("aggregate versus effective quantities mismatch")
    return {
        "allowed": not reasons,
        "submissionAuthorized": False,
        "phase": "FORM_ONLY",
        "selected": sorted(selected, key=lambda item: (item["fulfillmentOrderLineItemId"], item["lineItemId"])),
        "reasons": sorted(set(reasons)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--form", required=True, type=Path)
    args = parser.parse_args()
    try:
        source = sys.stdin.read() if str(args.form) == "-" else args.form.read_text()
        result = guard(json.loads(source))
    except (OSError, ValueError, TypeError) as exc:
        result = {"allowed": False, "submissionAuthorized": False, "phase": "FORM_ONLY", "selected": [], "reasons": [f"invalid input: {type(exc).__name__}"]}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["allowed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
