#!/usr/bin/env python3
"""Check the retained, sanitized live receipts without contacting Shopify."""

from decimal import Decimal
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / "evidence"


def read(name):
    return json.loads((E / name).read_text())


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def money(node):
    value = node["shopMoney"]
    require(value["currencyCode"] == "USD", "non-USD money")
    return Decimal(value["amount"])


def stock(name):
    product = read(name)["productByHandle"]
    result = {}
    for variant in product["variants"]["nodes"]:
        level = next(
            level for level in variant["inventoryItem"]["inventoryLevels"]["nodes"]
            if level["location"]["id"] == "gid://shopify/Location/89465290910"
        )
        result[variant["title"]] = {
            item["name"]: item["quantity"] for item in level["quantities"]
        }
    return result


def result_is_rejection(name):
    receipt = read(name)
    require(receipt["target"] == "cart.validations.generate.run", name)
    require(receipt["input"]["buyerJourney"]["step"] != "CART_INTERACTION", name)
    require(bool(receipt["output"]["operations"]), name)


quotes = read("issued-public-quotes.json")
order_a = quotes["orderA"]
require(len(order_a["envelope"]) == 208, "shared envelope size")
require([len(x) for x in order_a["carriers"]] == [30, 30], "member size")
require(order_a["header"]["totalMinor"] == "9100", "accepted quote total")

active = read("functions-active.json")
require(active["shop"]["myshopifyDomain"] == "insignia-staging.myshopify.com", "shop identity")
require(len(active["cartTransforms"]["nodes"]) == 1, "owned Transform not active")
require(len(active["validations"]["nodes"]) == 1, "owned Validation not active")
require(active["validations"]["nodes"][0]["enabled"] is True, "Validation not enabled")
require(active["validations"]["nodes"][0]["blockOnFailure"] is True, "Validation runtime failure mode")
require(active["cartTransforms"]["nodes"][0]["blockOnFailure"] is True, "Transform runtime failure mode")

transform = read("function-A-transform-checkout.json")
validation = read("function-A-validation-checkout.json")
for receipt in (transform, validation):
    require(receipt["shopId"] == 78935261342, "Function log shop")
    require(receipt["apiClientId"] == 427859050497, "Function log app")
    require(receipt["status"] == "success", "Function execution")
    require(receipt["input"]["cart"]["quote"]["value"] == order_a["envelope"], "Function envelope")
require(transform["target"] == "cart.transform.run", "Transform target")
ops = [op["lineExpand"] for op in transform["output"]["operations"]]
require(len(ops) == 2, "Transform operation count")
require(sorted(x["expandedCartItems"][0]["price"]["adjustment"]["fixedPricePerUnit"]["amount"] for x in ops) == ["30.33", "30.34"], "Transform exact prices")
require(validation["input"]["buyerJourney"]["step"] == "CHECKOUT_INTERACTION", "checkout step")
require(validation["output"]["operations"] == [], "complete quote rejected")
lines = validation["input"]["cart"]["lines"]
require(sum(x["quantity"] for x in lines) == 4 and len(lines) == 3, "physical line count")
require(sorted(Decimal(x["cost"]["subtotalAmount"]["amount"]) for x in lines) == [Decimal("20"), Decimal("30.34"), Decimal("60.66")], "checkout price inputs")

for name in (
    "negative-corrupt-header-validation.json",
    "negative-missing-header-validation.json",
    "negative-missing-member-validation.json",
    "negative-duplicate-member-validation.json",
    "negative-changed-member-validation.json",
    "negative-quantity-validation.json",
    "negative-required-unsigned-validation.json",
    "buy-now-required-validation.json",
    "negative-revoked-validation.json",
    "negative-transform-off-economic-validation.json",
    "repair-header-first-validation.json",
    "repair-one-member-validation.json",
):
    result_is_rejection(name)
require(read("optional-plain-validation.json")["output"]["operations"] == [], "optional plain path")
require(read("negative-revoked-transform.json")["output"]["operations"] == [], "revoked Transform")
require(json.loads(read("negative-revoked-validation.json")["input"]["shop"]["publicConfig"]["value"])["keys"][0]["revoked"] is True, "revoked registry not in Function input")
off = read("transform-off-fresh-readback.json")
require(off["cartTransforms"]["nodes"] == [], "Transform-off readback")
require(off["validations"]["nodes"][0]["enabled"] is True, "Validation stayed active")
costs = sorted(Decimal(x["cost"]["subtotalAmount"]["amount"]) for x in read("negative-transform-off-economic-validation.json")["input"]["cart"]["lines"])
require(costs == [Decimal("20"), Decimal("20"), Decimal("40")], "Transform-off $80 cost")
require(len(read("repair-complete-transform.json")["output"]["operations"]) == 2, "repair Transform")
require(read("repair-complete-validation.json")["output"]["operations"] == [], "complete repair rejected")

order = read("order-A-before-cancel.json")["order"]
require(order["name"] == "#1005" and order["test"] is True, "Order A identity/test")
require(order["paymentGatewayNames"] == ["bogus"], "test-only gateway")
require(money(order["subtotalPriceSet"]) == money(order["totalPriceSet"]) == Decimal("111"), "Order A total")
require(money(order["totalTaxSet"]) == money(order["totalShippingPriceSet"]) == 0, "tax/shipping")
order_lines = order["lineItems"]["nodes"]
require(len(order_lines) == 3 and sum(x["quantity"] for x in order_lines) == 4, "order physical count")
require(sorted((x["variant"]["id"], x["quantity"], money(x["originalUnitPriceSet"])) for x in order_lines) == sorted([
    ("gid://shopify/ProductVariant/50529053343902", 2, Decimal("30.33")),
    ("gid://shopify/ProductVariant/50529053343902", 1, Decimal("30.34")),
    ("gid://shopify/ProductVariant/50529054163102", 1, Decimal("20")),
]), "order variant/quantity/price")
require(read("order-A-attributes.json")["order"]["customAttributes"] == [{"key": "_insignia_quote_v2", "value": order_a["envelope"]}], "order shared carrier")
for line in order_lines:
    if line["variant"]["id"].endswith("50529053343902"):
        require(line["lineItemGroup"] is not None, "missing expanded group")
        require(line["lineItemGroup"]["quantity"] == line["quantity"], "group quantity")
        require(line["customAttributes"][0]["value"] in order_a["carriers"], "order member")

refunds = read("order-A-refunds.json")["order"]["refunds"]
require(len(refunds) == 1 and money(refunds[0]["totalRefundedSet"]) == Decimal("111"), "native refund")
refund_lines = refunds[0]["refundLineItems"]["nodes"]
require(sorted((x["lineItem"]["id"], x["quantity"], money(x["subtotalSet"])) for x in refund_lines) == sorted((x["id"], x["quantity"], money(x["discountedTotalSet"])) for x in order_lines), "direct refund identities")
require(all(x["restockType"] == "CANCEL" for x in refund_lines), "native restock type")
require(read("order-A-after-cancel.json")["order"]["displayFinancialStatus"] == "REFUNDED", "refund status")
require(stock("order-A-stock-after-cancel.json") == stock("baseline.json"), "stock restoration")

discount = read("discount-observation.json")
require(discount["observedLineDiscountMinor"] == [606, 303], "recorded discount lines")
require(discount["observedDiscountMinor"] == sum(discount["observedLineDiscountMinor"]) == 909, "discount sum")
require(discount["signedPreDiscountMinor"] - discount["observedDiscountMinor"] == discount["observedNetMerchandiseMinor"] == 8191, "discount net")
require(discount["packageExpectedNetMerchandiseMinor"] == 8190 and discount["observedNetMerchandiseMinor"] != discount["packageExpectedNetMerchandiseMinor"], "mismatch must remain visible")
require(discount["orderBPaymentSubmitted"] is False, "Order B stop")
discount_input = read("discount-checkout-validation.json")
require(discount_input["output"]["operations"] == [], "discount Validation result")
require(sorted(Decimal(x["cost"]["subtotalAmount"]["amount"]) for x in discount_input["input"]["cart"]["lines"]) == [Decimal("30.34"), Decimal("60.66")], "discount Function pre-discount input")
for name in ("discount-checkout-81-91.png", "discount-cart-81-91.png"):
    require((E / name).is_file(), f"missing native screenshot: {name}")
discount_final = read("discount-final-observation.json")
require(discount_final["visibleDiscountCount"] == 5 and discount_final["ownedCodePresent"] is False, "owned discount cleanup observation")
require(len(discount_final["originalScreenshotSha256"]) == 64, "original cleanup observation hash")

final = read("final-baseline.json")
require(final["cartTransforms"]["nodes"] == final["validations"]["nodes"] == [], "owned Functions residue")
require(final["productByHandle"]["status"] == "ARCHIVED" and final["productByHandle"]["onlineStoreUrl"] is None, "fixture publication residue")
metadata = read("final-metadata.json")
require(metadata["shop"]["publicConfig"] is metadata["product"]["policy"] is None, "owned metadata residue")
require(stock("final-baseline.json") == stock("baseline.json"), "final stock")
orders = read("final-orders.json")["orders"]["nodes"]
require({x["name"] for x in orders} == {"#1001", "#1002", "#1003", "#1004", "#1005"}, "unexpected new order")
require(next(x for x in orders if x["name"] == "#1005")["displayFinancialStatus"] == "REFUNDED", "Order A final financial status")
for number in (1001, 1002, 1003, 1004):
    require(read(f"order-{number}-before.json") == read(f"order-{number}-after.json"), f"protected order {number} changed")
clear = read("cart-attribute-clear.json")
require(clear["afterClear"]["itemCount"] == 0 and bool(clear["afterClear"]["attributes"]), "cart clear lost stale-attribute observation")
require(clear["final"] == {"attributes": {}, "itemCount": 0}, "guest cart residue")
print("M0-006 retained evidence checks passed; Order B $0.01 mismatch remains an explicit stop.")
