#!/usr/bin/env python3
"""Check the read-only M0-003 baseline and protected-order invariants."""

import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "evidence" / "m0-003"
read = lambda name: json.loads((root / name).read_text())
checks = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


baseline = read("baseline.json")
shop = baseline["shop"]
check("named USD shop", shop["id"] == "gid://shopify/Shop/78935261342" and shop["myshopifyDomain"] == "insignia-staging.myshopify.com" and shop["currencyCode"] == "USD")
install = baseline["currentAppInstallation"]
check("protected installation", install["id"] == "gid://shopify/AppInstallation/781307904158")
check("nine expected scopes", {x["handle"] for x in install["accessScopes"]} == {
    "read_cart_transforms", "read_inventory", "read_locations", "read_merchant_managed_fulfillment_orders", "read_orders", "read_products", "write_cart_transforms", "write_inventory", "write_products",
})
check("no conflicting transform", baseline["cartTransforms"]["nodes"] == [] and baseline["cartTransforms"]["pageInfo"]["hasNextPage"] is False)
product = baseline["productByHandle"]
check("owned archived fixture", product["id"] == "gid://shopify/Product/10294344482974" and product["status"] == "ARCHIVED" and product["onlineStoreUrl"] is None)
check("exact fixture variants", product["variants"]["pageInfo"]["hasNextPage"] is False and {x["id"] for x in product["variants"]["nodes"]} == {
    "gid://shopify/ProductVariant/50529053343902", "gid://shopify/ProductVariant/50529054163102",
})
stock = {}
for variant in product["variants"]["nodes"]:
    levels = variant["inventoryItem"]["inventoryLevels"]
    check("single designated location " + variant["sku"], len(levels["nodes"]) == 1 and levels["nodes"][0]["location"]["id"] == "gid://shopify/Location/89465290910" and levels["pageInfo"]["hasNextPage"] is False)
    check("catalog controls " + variant["sku"], variant["price"] == "20.00" and variant["inventoryPolicy"] == "DENY" and variant["inventoryItem"]["tracked"] is True and variant["inventoryItem"]["requiresShipping"] is True)
    stock[variant["sku"]] = {x["name"]: x["quantity"] for x in levels["nodes"][0]["quantities"]}
check("protected small commitments", (stock["INS-M0-001-BLK-S"]["available"], stock["INS-M0-001-BLK-S"]["committed"], stock["INS-M0-001-BLK-S"]["on_hand"]) == (8, 2, 10))
check("protected medium commitments", (stock["INS-M0-001-BLK-M"]["available"], stock["INS-M0-001-BLK-M"]["committed"], stock["INS-M0-001-BLK-M"]["on_hand"]) == (10, 2, 12))
order = read("protected-order.json")["order"]
check("protected test order unchanged", order["id"] == "gid://shopify/Order/7184619962526" and order["name"] == "#1001" and order["test"] is True and order["displayFinancialStatus"] == "PAID" and order["displayFulfillmentStatus"] == "PARTIALLY_FULFILLED")
fo = order["fulfillmentOrders"]["nodes"]
check("protected fulfillment order location", len(fo) == 1 and fo[0]["id"] == "gid://shopify/FulfillmentOrder/8330797252766" and fo[0]["assignedLocation"]["location"]["id"] == "gid://shopify/Location/89465290910")
check("protected remaining lines", sorted((x["id"], x["remainingQuantity"]) for x in fo[0]["lineItems"]["nodes"]) == sorted([
    ("gid://shopify/FulfillmentOrderLineItem/17215047270558", 0),
    ("gid://shopify/FulfillmentOrderLineItem/17215047303326", 2),
    ("gid://shopify/FulfillmentOrderLineItem/17215047336094", 2),
]))
fulfillments = read("protected-fulfillment.json")["order"]["fulfillments"]
check("historical fulfillment unchanged", len(fulfillments) == 1 and fulfillments[0]["id"] == "gid://shopify/Fulfillment/6511606562974" and fulfillments[0]["totalQuantity"] == 2 and sorted((x["lineItem"]["id"], x["quantity"]) for x in fulfillments[0]["fulfillmentLineItems"]["nodes"]) == sorted([
    ("gid://shopify/LineItem/16953568723102", 1),
    ("gid://shopify/LineItem/16953568788638", 1),
]))
check("post-check shop and fixture unchanged", read("post-check.json") == baseline)
check("post-check protected order unchanged", read("protected-order-post.json") == read("protected-order.json"))
check("post-check historical fulfillment unchanged", read("protected-fulfillment-post.json") == read("protected-fulfillment.json"))
print(json.dumps({"result": "PASS_READ_ONLY_BASELINE_PRESERVED", "checkCount": len(checks), "checks": checks}, indent=2))
