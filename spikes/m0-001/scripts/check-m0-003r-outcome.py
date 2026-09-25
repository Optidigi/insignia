#!/usr/bin/env python3
"""Reconcile M0-003R's native actions against direct Shopify API receipts."""

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "evidence" / "m0-003r"
PROTECTED = "gid://shopify/Order/7184619962526"
SMALL = "INS-M0-001-BLK-S"
MEDIUM = "INS-M0-001-BLK-M"


def read(name):
    return json.loads((ROOT / name).read_text())


def order(name):
    return read(name)["order"]


def money(value):
    assert value["shopMoney"]["currencyCode"] == "USD"
    return Decimal(value["shopMoney"]["amount"])


def stock(name):
    result = {}
    for variant in read(name)["productByHandle"]["variants"]["nodes"]:
        levels = variant["inventoryItem"]["inventoryLevels"]["nodes"]
        assert len(levels) == 1 and levels[0]["location"]["id"] == "gid://shopify/Location/89465290910"
        result[variant["sku"]] = {q["name"]: q["quantity"] for q in levels[0]["quantities"]}
    return result


def line_by_marker(o, marker):
    matches = []
    for line in o["lineItems"]["nodes"]:
        attrs = line["customAttributes"]
        if any(a["value"] == marker for a in attrs):
            matches.append(line)
    assert len(matches) == 1, (o["name"], marker)
    return matches[0]


def fulfillment_multiset(name):
    result = []
    for fulfillment in order(name)["fulfillments"]:
        assert fulfillment["status"] == "SUCCESS"
        assert fulfillment["location"]["id"] == "gid://shopify/Location/89465290910"
        lines = fulfillment["fulfillmentLineItems"]["nodes"]
        assert fulfillment["totalQuantity"] == sum(x["quantity"] for x in lines)
        result.append((fulfillment["id"], sorted((x["lineItem"]["id"], x["quantity"]) for x in lines)))
    return result


def assert_test_order(o, name, amount, units):
    assert o["name"] == name and o["test"] is True and o["paymentGatewayNames"] == ["bogus"]
    assert money(o["totalPriceSet"]) == Decimal(amount)
    assert sum(x["quantity"] for x in o["lineItems"]["nodes"]) == units
    assert o["lineItems"]["pageInfo"]["hasNextPage"] is False
    assert len(o["fulfillmentOrders"]["nodes"]) == 1
    assert o["fulfillmentOrders"]["pageInfo"]["hasNextPage"] is False
    fo = o["fulfillmentOrders"]["nodes"][0]
    assert fo["assignedLocation"]["location"]["id"] == "gid://shopify/Location/89465290910"
    assert fo["lineItems"]["pageInfo"]["hasNextPage"] is False


c0 = order("order-C-accepted.json")
c1 = order("order-C-after-partial.json")
c2 = order("order-C-after-refund.json")
assert_test_order(c0, "#1002", "80", 4)
assert c0["displayFinancialStatus"] == "PAID" and c0["displayFulfillmentStatus"] == "UNFULFILLED"
assert len(c0["lineItems"]["nodes"]) == 2 and all(x["lineItemGroup"] is None for x in c0["lineItems"]["nodes"])
ct = line_by_marker(c0, "M0-003R-C-20260925-target")
cb = line_by_marker(c0, "M0-003R-C-20260925-bystander")
assert (ct["quantity"], cb["quantity"]) == (3, 1)
assert ct["variant"]["id"] == cb["variant"]["id"]
assert money(ct["originalUnitPriceSet"]) == money(cb["originalUnitPriceSet"]) == Decimal("20")
assert [(x["lineItemId"], x["effectiveQuantity"]) for x in read("control-C-guard.json")["resolved"]] == [(cb["id"], 0), (ct["id"], 1)]
assert read("control-C-guard.json")["allowed"] is True
assert fulfillment_multiset("fulfillment-C-after-partial.json") == [("gid://shopify/Fulfillment/6512308158622", [(ct["id"], 1)])]
assert line_by_marker(c1, "M0-003R-C-20260925-target")["unfulfilledQuantity"] == 2
assert line_by_marker(c1, "M0-003R-C-20260925-bystander")["unfulfilledQuantity"] == 1
assert money(c2["totalRefundedSet"]) == Decimal("80") and c2["displayFinancialStatus"] == "REFUNDED"
assert all(x["unfulfilledQuantity"] == 0 for x in c2["lineItems"]["nodes"])
assert stock("stock-C-after-refund.json") == stock("baseline.json")

r0 = order("order-R-accepted.json")
r1 = order("order-R-after-partial.json")
r2 = order("order-R-after-remainder.json")
r3 = order("order-R-after-one-refund.json")
r4 = order("order-R-after-final-refund.json")
assert_test_order(r0, "#1003", "170", 6)
rt = line_by_marker(r0, "m0-001:m0-003r-R-S-20260925")
rm = line_by_marker(r0, "m0-001:m0-003r-R-M-20260925")
rp = line_by_marker(r0, "M0-003R-R-20260925-plain-small")
assert (rt["quantity"], rm["quantity"], rp["quantity"]) == (3, 2, 1)
assert (money(rt["originalUnitPriceSet"]), money(rm["originalUnitPriceSet"]), money(rp["originalUnitPriceSet"])) == (Decimal("30"), Decimal("30"), Decimal("20"))
assert rt["lineItemGroup"] and rm["lineItemGroup"] and rp["lineItemGroup"] is None
assert rt["lineItemGroup"]["quantity"] == 3 and rm["lineItemGroup"]["quantity"] == 2
assert read("candidate-R-guard.json")["allowed"] is True
assert [(x["lineItemId"], x["effectiveQuantity"]) for x in read("candidate-R-guard.json")["resolved"]] == [(rp["id"], 0), (rt["id"], 1), (rm["id"], 0)]
immediate = read("candidate-R-immediate-pre-submit.json")
fresh_r = order("order-R-immediate-pre-submit.json")
assert fresh_r == r0 and immediate["apiContext"] == "order-R-immediate-pre-submit.json"
assert immediate["orderNumericId"] == r0["id"].rsplit("/", 1)[-1] and immediate["store"] == "insignia-staging"
assert immediate["selectionSummary"] == "1 item selected" and immediate["notificationChecked"] is False
assert immediate["location"] == "Shop location"
assert [(x["marker"], x["checked"], x["effectiveQuantity"]) for x in immediate["rows"]] == [
    ("M0-003R-R-20260925-plain-small", False, 0),
    ("m0-001:m0-003r-R-S-20260925", True, 1),
    ("m0-001:m0-003r-R-M-20260925", False, 0),
]
fresh_fo = fresh_r["fulfillmentOrders"]["nodes"][0]
assert fresh_r["lineItems"]["pageInfo"]["hasNextPage"] is False
assert fresh_r["fulfillmentOrders"]["pageInfo"]["hasNextPage"] is False
assert fresh_fo["lineItems"]["pageInfo"]["hasNextPage"] is False
fresh_fol_by_line = {x["lineItem"]["id"]: x for x in fresh_fo["lineItems"]["nodes"]}
guarded = {x["marker"]: x for x in read("candidate-R-guard.json")["resolved"]}
assert len(fresh_fol_by_line) == len(immediate["rows"]) == len(guarded)
for row in immediate["rows"]:
    line = line_by_marker(fresh_r, row["marker"])
    fol = fresh_fol_by_line[line["id"]]
    assert guarded[row["marker"]]["lineItemId"] == line["id"]
    assert guarded[row["marker"]]["fulfillmentOrderLineItemId"] == fol["id"]
    assert guarded[row["marker"]]["effectiveQuantity"] == row["effectiveQuantity"]
    assert 0 <= row["effectiveQuantity"] <= fol["remainingQuantity"] == line["unfulfilledQuantity"]
assert datetime.fromisoformat(immediate["observedAtUtc"].replace("Z", "+00:00")) < datetime.fromisoformat(order("fulfillment-R-after-partial.json")["fulfillments"][0]["createdAt"].replace("Z", "+00:00"))
assert fulfillment_multiset("fulfillment-R-after-partial.json") == [("gid://shopify/Fulfillment/6512343908510", [(rt["id"], 1)])]
assert [(line_by_marker(r1, marker)["unfulfilledQuantity"]) for marker in ("M0-003R-R-20260925-plain-small", "m0-001:m0-003r-R-S-20260925", "m0-001:m0-003r-R-M-20260925")] == [1, 2, 2]
assert sorted(fulfillment_multiset("fulfillment-R-after-remainder.json")) == sorted([
    ("gid://shopify/Fulfillment/6512343908510", [(rt["id"], 1)]),
    ("gid://shopify/Fulfillment/6512345579678", sorted([(rp["id"], 1), (rt["id"], 2), (rm["id"], 2)])),
])
assert all(x["unfulfilledQuantity"] == 0 for x in r2["lineItems"]["nodes"])
assert money(r3["totalRefundedSet"]) == Decimal("30") and line_by_marker(r3, "m0-001:m0-003r-R-S-20260925")["refundableQuantity"] == 2
assert {x["id"]: x["refundableQuantity"] for x in r3["lineItems"]["nodes"]} == {
    rp["id"]: 1, rt["id"]: 2, rm["id"]: 2,
}
assert all(x["unfulfilledQuantity"] == 0 for x in r3["lineItems"]["nodes"])
refunds = read("order-R-refunds.json")["order"]
assert refunds["id"] == r0["id"] and refunds["name"] == "#1003" and len(refunds["refunds"]) == 2
one_refund, final_refund = sorted(refunds["refunds"], key=lambda x: x["createdAt"])
assert money(one_refund["totalRefundedSet"]) == Decimal("30")
assert one_refund["refundLineItems"]["pageInfo"]["hasNextPage"] is False
assert [(x["lineItem"]["id"], x["quantity"], x["restockType"], money(x["subtotalSet"])) for x in one_refund["refundLineItems"]["nodes"]] == [
    (rt["id"], 1, "RETURN", Decimal("30")),
]
assert money(final_refund["totalRefundedSet"]) == Decimal("140")
assert final_refund["refundLineItems"]["pageInfo"]["hasNextPage"] is False
assert sorted((x["lineItem"]["id"], x["quantity"], x["restockType"], money(x["subtotalSet"])) for x in final_refund["refundLineItems"]["nodes"]) == sorted([
    (rp["id"], 1, "NO_RESTOCK", Decimal("20")),
    (rt["id"], 2, "NO_RESTOCK", Decimal("60")),
    (rm["id"], 2, "NO_RESTOCK", Decimal("60")),
])
before_one, after_one = stock("stock-R-after-remainder.json"), stock("stock-R-after-one-refund.json")
assert after_one[SMALL]["available"] == before_one[SMALL]["available"] + 1
assert after_one[SMALL]["on_hand"] == before_one[SMALL]["on_hand"] + 1
assert after_one[SMALL]["committed"] == before_one[SMALL]["committed"]
assert after_one[MEDIUM] == before_one[MEDIUM]
assert money(r4["totalRefundedSet"]) == Decimal("170") and r4["displayFinancialStatus"] == "REFUNDED"
assert all(x["refundableQuantity"] == 0 for x in r4["lineItems"]["nodes"])
assert stock("stock-R-after-final-refund.json") == after_one

b0 = order("order-B-accepted.json")
b1 = order("order-B-after-cancel.json")
assert_test_order(b0, "#1004", "90", 3)
assert b0["displayFulfillmentStatus"] == "UNFULFILLED"
assert len(b0["lineItems"]["nodes"]) == 1 and b0["lineItems"]["nodes"][0]["lineItemGroup"]
assert money(b1["totalRefundedSet"]) == Decimal("90") and b1["displayFinancialStatus"] == "REFUNDED"
assert b1["lineItems"]["nodes"][0]["unfulfilledQuantity"] == 0
assert b1["fulfillmentOrders"]["nodes"][0]["status"] == "CLOSED"
assert b1["fulfillmentOrders"]["nodes"][0]["lineItems"]["nodes"][0]["remainingQuantity"] == 0
cancel = order("order-B-cancellation-readback.json")
assert cancel["id"] == b0["id"] and cancel["cancelReason"] == "OTHER" and cancel["cancelledAt"]
assert cancel["displayFinancialStatus"] == "REFUNDED" and money(cancel["totalRefundedSet"]) == Decimal("90")
bs0, bs1 = stock("stock-B-accepted.json"), stock("stock-B-after-cancel.json")
assert bs1[SMALL]["available"] == bs0[SMALL]["available"] + 3
assert bs1[SMALL]["committed"] == bs0[SMALL]["committed"] - 3
assert bs1[SMALL]["on_hand"] == bs0[SMALL]["on_hand"]
assert bs1[MEDIUM] == bs0[MEDIUM]

inventory = read("after-order-B-inventory.json")["orders"]
assert inventory["pageInfo"]["hasNextPage"] is False
assert {x["id"] for x in inventory["nodes"]} == {PROTECTED, c0["id"], r0["id"], b0["id"]}
assert sum(x["quantity"] for o in (c0, r0, b0) for x in o["lineItems"]["nodes"]) == 13
assert read("protected-order-after.json") == read("protected-order.json")
assert read("protected-fulfillment-after.json") == read("protected-fulfillment.json")
post = read("post-cleanup.json")
assert post["shop"]["myshopifyDomain"] == "insignia-staging.myshopify.com"
assert post["cartTransforms"]["nodes"] == [] and post["productByHandle"]["status"] == "ARCHIVED"
assert post["currentAppInstallation"]["id"] == read("baseline.json")["currentAppInstallation"]["id"]
assert sorted(x["handle"] for x in post["currentAppInstallation"]["accessScopes"]) == sorted(x["handle"] for x in read("baseline.json")["currentAppInstallation"]["accessScopes"])
assert stock("post-cleanup.json") == bs1
assert read("transform-delete-response.json")["cartTransformDelete"] == {"deletedId": "gid://shopify/CartTransform/143294622", "userErrors": []}
assert read("versions-before.json")["versions"] == read("versions-after.json")["versions"]
assert (ROOT / "control-C-pre-submit-crop.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
assert (ROOT / "candidate-R-pre-submit-crop.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
ui = read("fixture-post-cleanup-ui.json")
assert ui["store"] == "insignia-staging" and ui["productNumericId"] == "10294344482974"
assert ui["archived"] is True and ui["publishingText"] == "This product is not published anywhere" and ui["unsavedChanges"] is False
assert (ROOT / "fixture-post-cleanup-crop.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
outcome = read("outcome.json")
assert outcome["nativeWorkflowOutcome"] == "PASS_OBSERVED_PROCEDURE"
assert outcome["requestCapture"] == "UNAVAILABLE_NOT_REQUIRED_FOR_THIS_TEST"
assert outcome["historicalRootCause"] == "UNDETERMINED"
assert outcome["publicAppQualification"] == "UNVERIFIED"
assert outcome["gateStatus"] == "G1_IN_PROGRESS"
print("PASS: C/R/B exact native lifecycle, refunds, stock, protected history, cleanup and budget")
