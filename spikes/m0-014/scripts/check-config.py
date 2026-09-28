#!/usr/bin/env python3
"""Validate the fixed local development config without a merchant session."""
import hashlib
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = tomllib.loads((root / "rust/shopify.app.m0-014-public.toml").read_text())
local = tomllib.loads((root / "rust/shopify.app.toml").read_text())
assert local["client_id"] == "00000000000000000000000000000014"
assert local["application_url"] == "https://example.invalid"
assert local["access_scopes"]["scopes"] == ""
assert config["client_id"] == "1443cf6d03d39edae7c101a943c5c684"
assert config["application_url"] == "https://example.com"
assert config["build"]["automatically_update_urls_on_dev"] is False
assert set(config["access_scopes"]["scopes"].split(",")) == {
    "read_products", "write_products", "read_inventory", "write_inventory",
    "read_locations", "read_cart_transforms", "write_cart_transforms",
    "read_validations", "write_validations"}
assert config["webhooks"]["api_version"] == "2026-07"

for kind, uid, target, digest in (
    ("transform", "a6c13d4d-8a2c-48d3-a948-70da11b8e014", "cart.transform.run",
     "cebca846a17013a42dc590c18069ef5d9f0432452eb702d29bc46bbc1985590b"),
    ("validation", "9a273f32-3c33-4414-b503-98da092be014",
     "cart.validations.generate.run",
     "93148de17900a68732712ce687393ec920f903e55649115f23b9aa3b667a4ebd"),
):
    extension = tomllib.loads((root / f"rust/{kind}/shopify.extension.toml").read_text())
    assert extension["api_version"] == "2026-07"
    assert len(extension["extensions"]) == 1
    entry = extension["extensions"][0]
    assert entry["handle"] == f"m0-014-public-{kind}"
    assert entry["uid"] == uid and entry["type"] == "function"
    assert len(entry["targeting"]) == 1
    assert entry["targeting"][0]["target"] == target
    assert entry["build"]["wasm_opt"] is False
    assert entry["build"]["command"] == f"bash ../../scripts/install-pinned-wasm.sh {kind}"
    assert hashlib.sha256((root / f"artifacts/{kind}.wasm").read_bytes()).hexdigest() == digest
print("M0-014 fixed local config and pinned artifacts: PASS")
