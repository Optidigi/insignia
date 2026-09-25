"""Generate deterministic local-only v2 target inputs from public synthetic key material."""
import base64
import copy
import json
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def carrier(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


seed = bytes([1] * 32)
signer = Ed25519PrivateKey.from_private_bytes(seed)
public = signer.public_key().public_bytes(
    encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
)
variant = 9007199254740993
records = [
    i.to_bytes(2, "big") + variant.to_bytes(8, "big") + q.to_bytes(4, "big") + unit.to_bytes(8, "big")
    for i, q, unit in ((0, 2, 3033), (1, 1, 3034))
]
header = (
    b"ISG2" + bytes([2, 0]) + (7).to_bytes(2, "big") + bytes([0x11] * 16)
    + (4).to_bytes(4, "big") + bytes([0x22] * 16) + bytes([0x33] * 16)
    + (2).to_bytes(2, "big") + b"EUR" + bytes([2]) + b"DE"
    + (42).to_bytes(8, "big") + (20804).to_bytes(4, "big")
    + (3).to_bytes(4, "big") + (9100).to_bytes(8, "big")
)
assert len(header) == 92 and all(len(r) == 22 for r in records)
signature = signer.sign(b"Insignia\0WholeQuoteAuthorization\0v2\0" + header + b"".join(records))
envelope = carrier(header + signature)
assert len(envelope) == 208
members = [carrier(r) for r in records]
assert all(len(m) == 30 for m in members)
config = json.dumps({
    "generationHex": "11" * 16, "epoch": 4, "maxBuckets": 64,
    "maxPhysicalQuantity": 10000, "allowNoMarket": False,
    "keys": [{"id": 7, "publicHex": public.hex(),
              "revoked": False, "firstDay": 20800, "lastDay": 20804}],
}, separators=(",", ":"))
base = {
    "cart": {"quote": {"value": envelope}, "lines": []},
    "localization": {"country": {"isoCode": "DE"}, "market": {"id": "gid://shopify/Market/42"}},
    "shop": {"localTime": {"date": "2026-12-15"}, "publicConfig": {"value": config}},
}
for i, (q, price) in enumerate(((2, "60.66"), (1, "30.34"))):
    base["cart"]["lines"].append({
        "id": f"gid://shopify/CartLine/{9007199254740991 + i}", "quantity": q,
        "member": {"value": members[i]},
        "cost": {"amountPerQuantity": {"currencyCode": "EUR"},
                 "subtotalAmount": {"amount": price, "currencyCode": "EUR"}},
        "sellingPlanAllocation": None,
        "merchandise": {"__typename": "ProductVariant",
                        "id": f"gid://shopify/ProductVariant/{variant}",
                        "product": {"policy": {"value": "required"}}},
    })
here = Path(__file__).parent
(here / "transform-valid.json").write_text(json.dumps(base, separators=(",", ":")) + "\n")
base["buyerJourney"] = {"step": "CHECKOUT_COMPLETION"}
(here / "validation-valid.json").write_text(json.dumps(base, separators=(",", ":")) + "\n")

for count, ordinary_count in ((10, 190), (32, 0), (64, 0)):
    stress = copy.deepcopy(base)
    ordered = [
        i.to_bytes(2, "big") + variant.to_bytes(8, "big")
        + (1).to_bytes(4, "big") + (3000).to_bytes(8, "big")
        for i in range(count)
    ]
    stress_header = header[:60] + count.to_bytes(2, "big") + header[62:80] + count.to_bytes(4, "big") + (count * 3000).to_bytes(8, "big")
    stress_sig = signer.sign(b"Insignia\0WholeQuoteAuthorization\0v2\0" + stress_header + b"".join(ordered))
    stress["cart"]["quote"]["value"] = carrier(stress_header + stress_sig)
    stress["cart"]["lines"] = []
    for i, record in enumerate(ordered):
        line = copy.deepcopy(base["cart"]["lines"][0])
        line["id"] = f"gid://shopify/CartLine/{9007199254740991 + i}"
        line["quantity"] = 1
        line["member"]["value"] = carrier(record)
        line["cost"]["subtotalAmount"]["amount"] = "30.00"
        stress["cart"]["lines"].append(line)
    for i in range(ordinary_count):
        line = copy.deepcopy(base["cart"]["lines"][0])
        line["id"] = f"gid://shopify/CartLine/{9007199254740991 + count + i}"
        line["member"] = None
        line["merchandise"]["id"] = f"gid://shopify/ProductVariant/{9007199254740993 + count + i}"
        line["merchandise"]["product"]["policy"]["value"] = "optional"
        stress["cart"]["lines"].append(line)
    transform_stress = copy.deepcopy(stress)
    del transform_stress["buyerJourney"]
    name = f"{count}-signed-{ordinary_count}-ordinary"
    (here / f"transform-{name}.json").write_text(json.dumps(transform_stress, separators=(",", ":")) + "\n")
    (here / f"validation-{name}.json").write_text(json.dumps(stress, separators=(",", ":")) + "\n")
