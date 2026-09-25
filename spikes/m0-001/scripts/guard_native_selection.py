#!/usr/bin/env python3
"""Fail closed on an observed native fulfillment form and complete API rows.

The summary counts selected physical units in the observed Admin form. The
group parent is presentation only. A passing projection is not authorization.
"""

import argparse
import json
from pathlib import Path


def check(form, receipt, target_marker):
    errors = []
    order = receipt.get("order") or {}
    if form.get("store") != "insignia-staging" or form.get("orderNumericId") != order.get("id", "").rsplit("/", 1)[-1]:
        errors.append("store or order identity mismatch")
    if order.get("test") is not True or order.get("displayFinancialStatus") != "PAID":
        errors.append("order is not a paid test order")
    if order.get("lineItems", {}).get("pageInfo", {}).get("hasNextPage") is not False:
        errors.append("order line inventory paginated or unknown")
    if form.get("sectionTitle") != "Mark as fulfilled" or form.get("locationText") != "Shop location":
        errors.append("native form or location mismatch")
    if form.get("customerNotificationChecked") is not False:
        errors.append("customer notification not off")

    lines = {}
    for line in order.get("lineItems", {}).get("nodes", []):
        attrs = line.get("customAttributes") or []
        marker = next((a.get("value") for a in attrs if a.get("key") in ("Insignia diagnostic", "_insignia_m0_001")), None)
        if not marker or marker in lines:
            errors.append("missing or duplicate API marker")
        lines[marker] = line
    fol_by_line = {}
    fos = order.get("fulfillmentOrders", {}).get("nodes", [])
    if len(fos) != 1 or fos[0].get("assignedLocation", {}).get("location", {}).get("id") != "gid://shopify/Location/89465290910":
        errors.append("fulfillment order or location mismatch")
    for fo in fos:
        if fo.get("lineItems", {}).get("pageInfo", {}).get("hasNextPage") is not False:
            errors.append("fulfillment line inventory paginated or unknown")
        for fol in fo.get("lineItems", {}).get("nodes", []):
            lid = fol.get("lineItem", {}).get("id")
            if lid in fol_by_line:
                errors.append("duplicate fulfillment line mapping")
            fol_by_line[lid] = fol

    rows = form.get("rows") or []
    if len(rows) != len(lines) or {r.get("marker") for r in rows} != set(lines):
        errors.append("native row inventory differs from API lines")
    selected_rows = []
    resolved = []
    for row in rows:
        marker = row.get("marker")
        line = lines.get(marker) or {}
        fol = fol_by_line.get(line.get("id")) or {}
        if not line or not fol or line.get("unfulfilledQuantity") != fol.get("remainingQuantity"):
            errors.append(f"unmapped or inconsistent API line: {marker}")
        if row.get("variantLabel") != line.get("variantTitle") or row.get("sku") != line.get("sku"):
            errors.append(f"native variant mismatch: {marker}")
        if type(row.get("checkboxChecked")) is not bool or row.get("checkboxChecked") != row.get("shadowInputChecked") or row.get("checkboxIndeterminate") is not False or row.get("checkboxDisabled") is not False:
            errors.append(f"unknown native selection control: {marker}")
        selected = row.get("checkboxChecked") is True
        if selected:
            selected_rows.append(row)
            q = row.get("quantityInput")
            if not isinstance(q, dict) or not q.get("value", "").isdigit() or q.get("valid") is not True or q.get("ariaInvalid") != "false" or not q.get("min", "").isdigit() or not q.get("max", "").isdigit():
                errors.append(f"unknown selected quantity: {marker}")
                quantity = None
            else:
                quantity = int(q["value"])
                if not int(q["min"]) <= quantity <= min(int(q["max"]), fol.get("remainingQuantity", -1)):
                    errors.append(f"selected quantity outside remaining range: {marker}")
            if row.get("selectedClass") is not True or row.get("collapsedQuantityDisplay") is not None:
                errors.append(f"selected row display inconsistent: {marker}")
        else:
            quantity = 0
            if row.get("quantityInput") is not None or row.get("selectedClass") is not False or row.get("collapsedQuantityDisplay") != f"×\n\n{fol.get('remainingQuantity')}":
                errors.append(f"unselected row display inconsistent: {marker}")
        resolved.append({"marker": marker, "lineItemId": line.get("id"), "fulfillmentOrderLineItemId": fol.get("id"), "effectiveQuantity": quantity})
    summary = form.get("selectionSummary") or {}
    selected_units = sum(x["effectiveQuantity"] or 0 for x in resolved)
    if summary.get("label") != f"{selected_units} item selected" or summary.get("checked") is not False or summary.get("indeterminate") is not True or summary.get("shadowInputAriaChecked") != "mixed":
        errors.append("selected-row summary inconsistent")
    if len(selected_rows) != 1 or selected_rows[0].get("marker") != target_marker:
        errors.append("target is not sole selected row")
    if {x["marker"]: x["effectiveQuantity"] for x in resolved} != {m: (1 if m == target_marker else 0) for m in lines}:
        errors.append("effective quantity multiset mismatch")
    if len(fol_by_line) != len(lines):
        errors.append("fulfillment order line inventory incomplete")
    return {"allowed": not errors, "submissionAuthorized": False, "errors": sorted(set(errors)), "resolved": resolved}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--form", type=Path, required=True)
    parser.add_argument("--order", type=Path, required=True)
    parser.add_argument("--target-marker", required=True)
    args = parser.parse_args()
    result = check(json.loads(args.form.read_text()), json.loads(args.order.read_text()), args.target_marker)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["allowed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
