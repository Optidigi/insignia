#!/usr/bin/env python3
"""Regenerate local-only experimental-v2 target fixtures from a synthetic seed.

Requires the public Python cryptography package. Never use this seed for runtime keys.
"""

import base64
import copy
import json
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[2]
SEED = bytes([1]) * 32
DOMAIN = b"Insignia\0WholeQuoteAuthorization\0v2\0"


def token(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def fixture(target, count, ordinary, quantity=1):
    base = json.loads((ROOT / f"crates/cart-{target}/fixtures/valid.json").read_text())
    header = bytearray(base64.urlsafe_b64decode(base["cart"]["quote"]["value"] + "==")[:92])
    header[60:62] = count.to_bytes(2, "big")
    header[80:84] = (count * quantity).to_bytes(4, "big")
    header[84:92] = (count * quantity * 3033).to_bytes(8, "big")
    records = []
    lines = []
    for i in range(count):
        record = i.to_bytes(2, "big") + (9007199254740993).to_bytes(8, "big")
        record += quantity.to_bytes(4, "big") + (3033).to_bytes(8, "big")
        records.append(record)
        line = copy.deepcopy(base["cart"]["lines"][0])
        line["id"] = f"gid://shopify/CartLine/{i}"
        line["quantity"] = quantity
        line["member"]["value"] = token(record)
        if target == "validation":
            cents = quantity * 3033
            line["cost"]["subtotalAmount"]["amount"] = f"{cents // 100}.{cents % 100:02d}"
        lines.append(line)
    for i in range(ordinary):
        line = copy.deepcopy(base["cart"]["lines"][0])
        line["id"] = f"gid://shopify/CartLine/{count + i}"
        line["quantity"] = 1
        line["member"] = None
        line["merchandise"]["product"]["registration"] = None
        line["merchandise"]["product"]["policy"] = None
        if target == "validation":
            line["cost"]["subtotalAmount"]["amount"] = "10.00"
        lines.append(line)
    signature = Ed25519PrivateKey.from_private_bytes(SEED).sign(DOMAIN + header + b"".join(records))
    base["cart"]["quote"]["value"] = token(header + signature)
    base["cart"]["lines"] = lines
    config = json.loads(base["shop"]["publicConfig"]["value"])
    config["maxBuckets"] = count
    base["shop"]["publicConfig"]["value"] = json.dumps(config, separators=(",", ":"))
    return base


for target in ("transform", "validation"):
    directory = ROOT / f"crates/cart-{target}/fixtures"
    for name, count, ordinary, quantity in (
        ("32-signed-168-ordinary", 32, 168, 1),
        ("33-signed-0-ordinary", 33, 0, 1),
        ("10k-physical", 2, 0, 5000),
    ):
        (directory / f"{name}.json").write_text(
            json.dumps(fixture(target, count, ordinary, quantity), separators=(",", ":")) + "\n"
        )
