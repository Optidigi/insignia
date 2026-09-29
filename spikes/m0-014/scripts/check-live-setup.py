#!/usr/bin/env python3
"""Check the exact saved M0-014 setup receipts without merchant access."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "evidence"


def read(name):
    return json.loads((root / name).read_text())


hashes = read("setup-receipt-sha256.json")
for name, digest in hashes.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name

ledger = read("resource-manifest.json")
target = ledger["target"]
assert target["appGid"] == "gid://shopify/App/429028933633"
assert target["shopGid"] == "gid://shopify/Shop/105501393179"
assert target["storeDomain"] == "insignia-rewrite-dev.myshopify.com"

initial = read("identity-before-preview.json")
assert initial["shop"]["id"] == target["shopGid"]
assert initial["currentAppInstallation"]["id"] == target["installationGid"]
assert initial["currentAppInstallation"]["app"]["id"] == target["appGid"]
assert {x["handle"] for x in initial["currentAppInstallation"]["accessScopes"]} == {
    "read_products", "write_products"
}
assert not initial["products"]["nodes"]

handles = read("fixture-handle-preflight.json")
assert handles["a"] is None and handles["b"] is None
assert handles["products"]["nodes"] == []
assert handles["products"]["pageInfo"]["hasNextPage"] is False

preview = read("preview-readback-before-activation.json")
assert preview["shop"]["id"] == target["shopGid"]
assert preview["currentAppInstallation"]["app"]["id"] == target["appGid"]
assert preview["cartTransforms"]["nodes"] == []
assert preview["validations"]["nodes"] == []
assert not preview["cartTransforms"]["pageInfo"]["hasNextPage"]
assert not preview["validations"]["pageInfo"]["hasNextPage"]
grants = {x["handle"] for x in preview["currentAppInstallation"]["accessScopes"]}
assert grants == {"read_products", "write_products", "read_inventory", "write_inventory",
                  "read_locations", "read_cart_transforms", "write_cart_transforms",
                  "read_validations", "write_validations"}
locations = preview["locations"]
assert not locations["pageInfo"]["hasNextPage"]
assert locations["nodes"] == [{"id": ledger["newResources"]["locationGid"],
                                "name": "Shop location", "isActive": True}]

bundle = read("preview-bundle-identity.json")
assert bundle["appGid"] == target["appGid"] and bundle["shopGid"] == target["shopGid"]
assert len(bundle["functions"]) == 2
for function in bundle["functions"]:
    kind = "transform" if function["target"] == "cart.transform.run" else "validation"
    assert function["handle"] == f"m0-014-public-{kind}"
    assert function["matchesPinnedCandidate"] is True
    assert function["appKey"] == target["clientId"]
    assert function["apiVersion"] == "2026-07"
    assert function["decodedWasmSha256"] == hashlib.sha256(
        (root.parent / "artifacts" / f"{kind}.wasm").read_bytes()).hexdigest()
    assert function["functionId"] == ledger["newResources"]["functions"][kind]["functionGid"]

products = [read("product-a-create.json")["productSet"],
            read("product-b-create.json")["productSet"]]
assert all(not result["userErrors"] for result in products)
assert [len(result["product"]["variants"]["nodes"]) for result in products] == [2, 1]
assert all(result["product"]["status"] == "DRAFT" for result in products)
stock = read("stock-before-cart.json")
assert stock["shop"]["id"] == target["shopGid"]
assert [x["id"] for x in stock["nodes"]] == [x["id"] for x in ledger["newResources"]["products"]]
amounts = []
for product in stock["nodes"]:
    assert product["status"] == "DRAFT" and product["onlineStoreUrl"] is None
    assert not product["variants"]["pageInfo"]["hasNextPage"]
    for variant in product["variants"]["nodes"]:
        assert variant["price"] == "20.00" and variant["inventoryPolicy"] == "DENY"
        item = variant["inventoryItem"]
        assert item["tracked"] and item["requiresShipping"]
        assert not item["inventoryLevels"]["pageInfo"]["hasNextPage"]
        levels = item["inventoryLevels"]["nodes"]
        assert len(levels) == 1 and levels[0]["location"]["id"] == ledger["newResources"]["locationGid"]
        q = {v["name"]: v["quantity"] for v in levels[0]["quantities"]}
        assert q["committed"] == 0 and q["available"] == q["on_hand"]
        amounts.append(q["available"])
assert amounts == [64, 200, 8] and sum(amounts) == 272

before = read("fixture-before-metadata.json")
assert before["shop"]["publicConfig"] is None
assert all(p["registration"] is None and p["policy"] is None for p in before["nodes"])
metadata = read("metadata-create.json")["metafieldsSet"]
assert metadata["userErrors"] == [] and len(metadata["metafields"]) == 5
after = read("fixture-after-metadata.json")
config = json.loads(after["shop"]["publicConfig"]["value"])
assert config["generationHex"] == ledger["newResources"]["keyGenerationHex"]
assert config["maxBuckets"] == 32 and config["maxPhysicalQuantity"] == 10_000
assert config["keys"] == [{"id": 60014, "publicHex": ledger["newResources"]["publicKeyHex"],
                           "revoked": False, "firstDay": 20724, "lastDay": 20726}]
assert [p["registration"]["value"] for p in after["nodes"]] == [
    f"{config['generationHex']}:1:ready"] * 2
assert [p["policy"]["value"] for p in after["nodes"]] == [
    f"{config['generationHex']}:1:optional", f"{config['generationHex']}:1:required"]

transform = read("transform-create.json")["cartTransformCreate"]
validation = read("validation-create.json")["validationCreate"]
assert transform["userErrors"] == [] and validation["userErrors"] == []
assert transform["cartTransform"]["blockOnFailure"] is True
assert validation["validation"]["enabled"] is True
assert validation["validation"]["blockOnFailure"] is True
activated = read("functions-after-activation.json")
assert activated["cartTransforms"]["nodes"] == [transform["cartTransform"]]
assert activated["validations"]["nodes"] == [validation["validation"]]
assert not activated["cartTransforms"]["pageInfo"]["hasNextPage"]
assert not activated["validations"]["pageInfo"]["hasNextPage"]

print(json.dumps({"status": "PASS", "hashedSetupReceipts": len(hashes),
                  "draftProducts": 2, "variants": 3, "initialUnits": sum(amounts),
                  "ownedFunctions": 2}, sort_keys=True))
