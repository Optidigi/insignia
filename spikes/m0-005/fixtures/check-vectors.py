"""Independently check the synthetic M0-005 golden bytes and signature.

Requires cryptography 46.0.5; fixture values are reviewed literals, not rewritten.
"""

import base64
import json
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization


def u(value: int, width: int) -> bytes:
    return value.to_bytes(width, "big")


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


v = json.loads(Path(__file__).with_name("vectors.json").read_text())
c = v["expected"]
domain = b"Insignia\0WholeQuoteAuthorization\0v2\0"
header = b"".join(
    [
        b"ISG2", u(2, 1), u(0, 1), u(c["keyId"], 2),
        bytes.fromhex(c["generationHex"]), u(c["epoch"], 4),
        bytes.fromhex(c["quoteHex"]), bytes.fromhex(c["setHex"]),
        u(c["count"], 2), c["currency"].encode(), u(c["exponent"], 1),
        c["country"].encode(), u(int(c["marketId"]), 8),
        u(c["validThroughDay"], 4), u(c["totalQuantity"], 4),
        u(int(c["totalMinor"]), 8),
    ]
)
members = [
    b"".join(
        [
            u(m["index"], 2), u(int(m["variantId"]), 8),
            u(m["quantity"], 4), u(int(m["unitMinor"]), 8),
        ]
    )
    for m in c["members"]
]
key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(v["seedHex"]))
public = key.public_key().public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
)
signature = key.sign(domain + header + b"".join(members))
assert len(header) == 92 and all(len(m) == 22 for m in members)
assert domain.hex() == v["domainUtf8Hex"]
assert header.hex() == v["headerHex"]
assert [m.hex() for m in members] == v["memberHex"]
assert public.hex() == v["publicHex"]
assert signature.hex() == v["signatureHex"]
assert b64(header + signature) == v["envelope"]
assert [b64(m) for m in members] == v["memberTokens"]
key.public_key().verify(signature, domain + header + b"".join(members))
print("M0-005 Python golden vector: PASS")
