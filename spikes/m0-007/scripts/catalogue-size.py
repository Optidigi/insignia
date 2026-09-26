#!/usr/bin/env python3
"""Quantify the rejected single-shop-registry alternative at catalogue scale."""

import json

GENERATION = "0123456789abcdef0123456789abcdef"
LIMIT = 10_000  # Shopify Function metafield value availability threshold, bytes.

for count in (1, 200, 1_000, 10_000):
    value = json.dumps({
        "generationHex": GENERATION,
        "managedProductIds": [f"gid://shopify/Product/{10_000_000_000 + i}" for i in range(count)],
    }, separators=(",", ":")).encode()
    print(json.dumps({"products": count, "serializedBytes": len(value),
                      "exceedsFunctionMetafieldThreshold": len(value) > LIMIT}, sort_keys=True))
