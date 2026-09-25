#!/usr/bin/env python3
"""Check the M0-002 receipts, including the observed native failure."""

import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "evidence" / "m0-002"
checks = []


def read(name):
    return json.loads((root / name).read_text())


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def stock(name):
    result = {}
    for variant in read(name)["productByHandle"]["variants"]["nodes"]:
        levels = variant["inventoryItem"]["inventoryLevels"]["nodes"]
        check(f"{name}: single Shop location for {variant['sku']}", len(levels) == 1 and levels[0]["location"]["id"] == "gid://shopify/Location/89465290910")
        result[variant["sku"]] = {q["name"]: q["quantity"] for q in levels[0]["quantities"]}
    return result


baseline = read("baseline.json")
check("named shop", baseline["shop"]["id"] == "gid://shopify/Shop/78935261342" and baseline["shop"]["currencyCode"] == "USD")
check("unchanged installation", baseline["currentAppInstallation"]["id"] == "gid://shopify/AppInstallation/781307904158")
check("no preexisting transform", baseline["cartTransforms"]["nodes"] == [])
check("owned fixture", baseline["productByHandle"]["id"] == "gid://shopify/Product/10294344482974")
check("initial inventory", all(all(v[n] == 0 for n in ("available", "committed", "on_hand")) for v in stock("baseline.json").values()))
seed = read("inventory-seed-response.json")["inventoryAdjustQuantities"]
check("seed accepted", seed["userErrors"] == [] and sorted((x["name"], x["delta"]) for x in seed["inventoryAdjustmentGroup"]["changes"]) == [("available", 12), ("available", 12), ("on_hand", 12), ("on_hand", 12)])
check("seed readback", all((v["available"], v["committed"], v["on_hand"]) == (12, 0, 12) for v in stock("after-seed.json").values()))

for name, count, total in [
    ("cart-plain.json", 1, 2000),
    ("cart-marked-qty1.json", 1, 3000),
    ("cart-marked-qty3.json", 3, 9000),
    ("cart-readd.json", 3, 9000),
    ("cart-mixed-A.json", 6, 17000),
]:
    cart = read(name)
    check(name, cart["currency"] == "USD" and cart["item_count"] == count and cart["total_price"] == total)

mixed = read("cart-mixed-A.json")["items"]
check("mixed line identities", sorted((x["sku"], x["quantity"], x["price"], (x["properties"] or {}).get("_insignia_m0_001")) for x in mixed) == sorted([
    ("INS-M0-001-BLK-S", 1, 2000, None),
    ("INS-M0-001-BLK-S", 3, 3000, "m0-001:m0-002-A-S"),
    ("INS-M0-001-BLK-M", 2, 3000, "m0-001:m0-002-A-M"),
]))
created = read("transform-create-response.json")["cartTransformCreate"]
transform_id = "gid://shopify/CartTransform/143130782"
check("owned transform activated", created["userErrors"] == [] and created["cartTransform"]["id"] == transform_id and created["cartTransform"]["blockOnFailure"] is True)

order = read("order-A-accepted.json")["order"]
check("test-only order A", order["id"] == "gid://shopify/Order/7184619962526" and order["name"] == "#1001" and order["test"] is True and order["paymentGatewayNames"] == ["bogus"] and order["displayFinancialStatus"] == "PAID")
check("order merchandise", order["subtotalPriceSet"]["shopMoney"]["amount"] in ("170.0", "170.00") and order["totalTaxSet"]["shopMoney"]["amount"] in ("0.0", "0.00") and order["totalShippingPriceSet"]["shopMoney"]["amount"] in ("0.0", "0.00"))
lines = order["lineItems"]["nodes"]
check("order has three owned real-variant lines", len(lines) == 3 and sorted((x["sku"], x["variant"]["id"], x["quantity"], x["originalUnitPriceSet"]["shopMoney"]["amount"]) for x in lines) == sorted([
    ("INS-M0-001-BLK-S", "gid://shopify/ProductVariant/50529053343902", 1, "20.0"),
    ("INS-M0-001-BLK-S", "gid://shopify/ProductVariant/50529053343902", 3, "30.0"),
    ("INS-M0-001-BLK-M", "gid://shopify/ProductVariant/50529054163102", 2, "30.0"),
]))
check("marked line groups retained", sum(x["lineItemGroup"] is not None for x in lines) == 2 and sum(x["lineItemGroup"] is None for x in lines) == 1)
check("fulfillment assigned to Shop location", all(x["assignedLocation"]["location"]["id"] == "gid://shopify/Location/89465290910" for x in order["fulfillmentOrders"]["nodes"]))
after_order = stock("after-order-A.json")
check("accepted order reserves six once", (after_order["INS-M0-001-BLK-S"]["available"], after_order["INS-M0-001-BLK-S"]["committed"], after_order["INS-M0-001-BLK-S"]["on_hand"]) == (8, 4, 12) and (after_order["INS-M0-001-BLK-M"]["available"], after_order["INS-M0-001-BLK-M"]["committed"], after_order["INS-M0-001-BLK-M"]["on_hand"]) == (10, 2, 12))

selected = read("fulfillment-A-partial-ui-before.json")
check("native UI selected only one marked line", [(x["marker"], x["selected"], x["requestedQuantity"]) for x in selected["lines"]] == [("plain Small", False, "1"), ("marked Small", True, "1"), ("marked Medium", False, None)])
fulfilled = read("fulfillment-A-response.json")["order"]["fulfillments"]
check("native partial failure preserved", len(fulfilled) == 1 and fulfilled[0]["totalQuantity"] == 2 and sorted((x["lineItem"]["originalUnitPriceSet"]["shopMoney"]["amount"], x["quantity"]) for x in fulfilled[0]["fulfillmentLineItems"]["nodes"]) == [("20.0", 1), ("30.0", 1)])
after_partial = stock("after-partial-A.json")
check("unexpected two-unit stock movement", (after_partial["INS-M0-001-BLK-S"]["available"], after_partial["INS-M0-001-BLK-S"]["committed"], after_partial["INS-M0-001-BLK-S"]["on_hand"]) == (8, 2, 10) and (after_partial["INS-M0-001-BLK-M"]["available"], after_partial["INS-M0-001-BLK-M"]["committed"], after_partial["INS-M0-001-BLK-M"]["on_hand"]) == (10, 2, 12))

cleanup = read("post-cleanup.json")
check("owned cleanup", cleanup["cartTransforms"]["nodes"] == [] and cleanup["productByHandle"]["status"] == "ARCHIVED")
check("residual commitments preserved", stock("post-cleanup.json") == after_partial)
check("installation remains", cleanup["currentAppInstallation"]["id"] == baseline["currentAppInstallation"]["id"])

print(json.dumps({"result": "PASS_EVIDENCE_CONSISTENCY_WITH_OBSERVED_NATIVE_FAILURE", "checks": checks, "checkCount": len(checks)}, indent=2))
