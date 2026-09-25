"""Manual, independent fixture authoring tool. Tests never regenerate vectors.

Uses RFC 8032 published TEST seed 1, never a merchant signing key. The Python
struct/cryptography path intentionally shares no code with the TS/Rust codecs.
"""
import base64
import json
import struct
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
KEY = Ed25519PrivateKey.from_private_bytes(SEED)
PREFIX = b"Insignia\0CartAuthorization\0v1\0"
FORMAT = ">4sBBH16sI16s16sHHQIQ3sB2sQIIQ"
assert struct.calcsize(FORMAT) == 114


def payload(c):
    return struct.pack(
        FORMAT, b"ISG1", 1, 0, c["keyId"],
        bytes.fromhex(c["generationHex"]), c["epoch"],
        bytes.fromhex(c["quoteHex"]), bytes.fromhex(c["setHex"]),
        c["lineIndex"], c["lineCount"], int(c["variantId"]),
        c["quantity"], int(c["unitMinor"]), c["currency"].encode("ascii"),
        c["exponent"], c["country"].encode("ascii"), int(c["marketId"]),
        c["validThroughDay"], c["totalQuantity"], int(c["totalMinor"]),
    )


def b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def signed(data):
    sig = KEY.sign(PREFIX + data)
    return sig, b64(data + sig)


base = dict(
    keyId=7, generationHex="11" * 16, epoch=4, quoteHex="22" * 16,
    setHex="33" * 16, lineIndex=0, lineCount=2,
    variantId="9007199254740993", quantity=2, unitMinor="3033",
    currency="EUR", exponent=2, country="DE", marketId="42",
    validThroughDay=20802, totalQuantity=3, totalMinor="9100",
)
claims = [
    ("eur91_first", base),
    ("eur91_remainder", {**base, "lineIndex": 1, "quantity": 1, "unitMinor": "3034"}),
    ("wide_u64", {**base, "quoteHex": "44" * 16, "setHex": "55" * 16,
        "lineCount": 1, "variantId": "18446744073709551614", "quantity": 1,
        "unitMinor": "9007199254740993", "totalQuantity": 1,
        "totalMinor": "9007199254740993"}),
]
valid = []
for name, claim in claims:
    raw = payload(claim)
    signature, token = signed(raw)
    valid.append(dict(name=name, claims=claim, payloadHex=raw.hex(),
                      signatureHex=signature.hex(), token=token, expectedAccept=True))

raw0 = payload(base)
sig0, token0 = signed(raw0)
invalid = []


def bad(name, raw, reason, resign=False):
    signature = KEY.sign(PREFIX + raw) if resign else sig0
    invalid.append(dict(name=name, token=b64(raw + signature),
                        expectedAccept=False, reason=reason))


def flip(name, offset, value, reason, resign=False):
    changed = bytearray(raw0)
    changed[offset] = value
    bad(name, bytes(changed), reason, resign)


flip("wrong_magic", 0, ord("X"), "magic", True)
flip("wrong_version", 4, 2, "version", True)
flip("reserved_flag", 5, 1, "flags", True)
flip("unknown_key", 7, 8, "key", True)
flip("tampered_generation", 8, 9, "signature")
flip("tampered_epoch", 27, 5, "signature")
flip("tampered_variant", 71, 2, "signature")
flip("tampered_quantity", 75, 3, "signature")
flip("tampered_price", 83, 8, "signature")
flip("tampered_currency", 84, ord("U"), "signature")
flip("tampered_exponent", 87, 3, "currency/exponent", True)
flip("tampered_country", 88, ord("F"), "signature")
flip("tampered_market", 97, 43, "signature")
flip("nonascii_currency", 84, 0xC5, "raw ASCII", True)
flip("nonascii_country", 88, 0xC4, "raw ASCII", True)
zero_variant = bytearray(raw0)
zero_variant[64:72] = b"\x00" * 8
bad("zero_variant", bytes(zero_variant), "positive GID suffix", True)
changed_sig = bytearray(sig0)
changed_sig[0] ^= 1
invalid.append(dict(name="invalid_signature", token=b64(raw0 + changed_sig),
                    expectedAccept=False, reason="signature"))
invalid.append(dict(name="truncated", token=token0[:-2], expectedAccept=False, reason="length"))
invalid.append(dict(name="padding", token=token0 + "=", expectedAccept=False, reason="padding"))
invalid.append(dict(name="invalid_alphabet", token="+" + token0[1:], expectedAccept=False, reason="alphabet"))
# 178 bytes end in two base64url characters; the final character's low four
# bits are unused. Alter them while preserving the decoded bytes.
alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
tail = alphabet.index(token0[-1])
invalid.append(dict(name="noncanonical_tail", token=token0[:-1] + alphabet[tail ^ 1],
                    expectedAccept=False, reason="canonical"))
invalid.append(dict(name="trailing_byte", token=b64(raw0 + sig0 + b"\x00"),
                    expectedAccept=False, reason="length"))

# Keep the original valid and invalid corpus byte-for-byte, then append all
# M0-004R adversarial cases. Independently sign malformed headers so rejection
# must occur at the parser even when the signature is otherwise valid.
for mask in range(1, 16):
    highbit_magic = bytearray(raw0)
    for offset in range(4):
        if mask & (1 << offset):
            highbit_magic[offset] |= 0x80
    bad(f"highbit_magic_mask_{mask:02x}", bytes(highbit_magic), "raw magic", True)
highbit_unresigned = bytearray(raw0)
highbit_unresigned[0] |= 0x80
bad("highbit_magic_unresigned", bytes(highbit_unresigned), "signature control")
identity = b"\x01" + b"\x00" * 31
identity_r_zero_s = identity + b"\x00" * 32
invalid.append(dict(name="weak_identity_key_r_identity_s_zero",
                    token=b64(raw0 + identity_r_zero_s),
                    publicKeyHex=identity.hex(), expectedAccept=False,
                    reason="strict weak-key profile"))
invalid.append(dict(name="normal_key_rejects_identity_signature",
                    token=b64(raw0 + identity_r_zero_s),
                    expectedAccept=False, reason="normal-key negative control"))
order_l = bytes.fromhex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010")
assert len(order_l) == 32
noncanonical_s = int.from_bytes(sig0[32:], "little") + int.from_bytes(order_l, "little")
assert noncanonical_s < 1 << 256
invalid.append(dict(name="noncanonical_signature_scalar",
                    token=b64(raw0 + sig0[:32] + noncanonical_s.to_bytes(32, "little")),
                    expectedAccept=False, reason="valid R with S+L noncanonical scalar"))

out = dict(provenance="RFC 8032 test seed 1; synthetic Insignia claims; never merchant keys",
           publicKeyHex="d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
           testSeedHex=SEED.hex(), valid=valid, invalid=invalid)
Path(__file__).with_name("vectors.json").write_text(json.dumps(out, indent=2) + "\n")
