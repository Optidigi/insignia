#!/usr/bin/env python3
"""Offline semantic replay of built experimental-v2 Functions.

Set M1_FUNCTION_RUNNER to a local Shopify Function runner binary. No CLI login.
"""

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
RUNNER = os.environ["M1_FUNCTION_RUNNER"]


def replay(target, case, payload, expected, prices=None):
    crate = ROOT / f"crates/cart-{target}"
    extension = ROOT / f"extensions/insignia-cart-{target}"
    wasm = extension / f"target/cart-{target}.wasm"
    query = extension / "src" / (
        "cart_transform_run.graphql" if target == "transform" else "cart_validations_generate_run.graphql"
    )
    export = "cart_transform_run" if target == "transform" else "cart_validations_generate_run"
    with tempfile.TemporaryDirectory(dir=extension / "target") as scratch:
        path = Path(scratch) / "input.json"
        path.write_text(json.dumps(payload, separators=(",", ":")))
        process = subprocess.run(
            [RUNNER, "-f", str(wasm), "-i", str(path), "-e", export,
             "-q", str(query), "-s", str(extension / "schema.graphql"), "-j"],
            check=True, capture_output=True, text=True,
        )
    result = json.loads(process.stdout)
    assert result["success"], (target, case, result.get("logs"))
    operations = result["output"]["operations"]
    assert len(operations) == expected, (target, case, len(operations), expected)
    if prices is not None:
        actual = [x["lineExpand"]["expandedCartItems"][0]["price"]["adjustment"]
                  ["fixedPricePerUnit"]["amount"] for x in operations]
        assert actual == prices, (target, case, actual, prices)
    return {
        "case": case,
        "operations": len(operations),
        "inputBytes": len(json.dumps(payload, separators=(",", ":")).encode()),
        "outputJsonBytes": len(json.dumps(result["output"], separators=(",", ":")).encode()),
        "instructions": result["instructions"],
        "memoryUsage": result["memory_usage"],
    }


def fixture(target, name="valid"):
    return json.loads((ROOT / f"crates/cart-{target}/fixtures/{name}.json").read_text())


report = {}
for target in ("transform", "validation"):
    extension = ROOT / f"extensions/insignia-cart-{target}"
    records = []

    def check(name, payload, expected, prices=None):
        records.append(replay(target, name, payload, expected, prices))

    base = fixture(target)
    steps = ("CHECKOUT_INTERACTION", "CHECKOUT_COMPLETION") if target == "validation" else (None,)
    for step in steps:
        label = step or "cart"
        valid = copy.deepcopy(base)
        if step:
            valid["buyerJourney"]["step"] = step
        check(f"valid-{label}", valid, 2 if target == "transform" else 0,
              ["30.33", "30.34"] if target == "transform" else None)
        zero = copy.deepcopy(valid)
        zero["cart"]["lines"][0]["id"] = "gid://shopify/CartLine/0"
        check(f"canonical-zero-{label}", zero, 2 if target == "transform" else 0,
              ["30.33", "30.34"] if target == "transform" else None)
        missing = copy.deepcopy(valid)
        missing["cart"]["lines"].pop()
        check(f"missing-{label}", missing, 0 if target == "transform" else 1)
        duplicate = copy.deepcopy(valid)
        duplicate["cart"]["lines"][1]["member"] = copy.deepcopy(duplicate["cart"]["lines"][0]["member"])
        check(f"duplicate-{label}", duplicate, 0 if target == "transform" else 1)
        altered = copy.deepcopy(valid)
        altered["cart"]["lines"][1]["member"]["value"] = "bad"
        check(f"altered-{label}", altered, 0 if target == "transform" else 1)
        if target == "validation":
            underpriced = copy.deepcopy(valid)
            underpriced["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "60.64"
            check(f"underpriced-{label}", underpriced, 1)
            unsigned = copy.deepcopy(valid)
            unsigned["cart"]["quote"] = None
            for line in unsigned["cart"]["lines"]:
                line["member"] = None
            check(f"unsigned-required-{label}", unsigned, 1)
    if target == "validation":
        repair = copy.deepcopy(base)
        repair["buyerJourney"]["step"] = "CART_INTERACTION"
        repair["cart"]["lines"][0]["member"]["value"] = "bad"
        check("cart-repair", repair, 0)
    check("32-plus-168", fixture(target, "32-signed-168-ordinary"), 32 if target == "transform" else 0)
    check("33-rejected", fixture(target, "33-signed-0-ordinary"), 0 if target == "transform" else 1)
    check("10000-physical-units", fixture(target, "10k-physical"), 2 if target == "transform" else 0,
          ["30.33", "30.33"] if target == "transform" else None)
    report[target] = {
        "sourceSha256": hashlib.sha256(b"".join(
            p.relative_to(ROOT).as_posix().encode() + b"\0" + p.read_bytes()
            for p in sorted((ROOT / "crates/cart-authorization/src").glob("*.rs"))
            + sorted((ROOT / f"crates/cart-{target}/src").glob("*.rs"))
            + [ROOT / f"crates/cart-{target}/policy.rs", ROOT / f"crates/cart-{target}/capacity.rs"]
        )).hexdigest(),
        "querySha256": hashlib.sha256((extension / "src" / ("cart_transform_run.graphql" if target == "transform" else "cart_validations_generate_run.graphql")).read_bytes()).hexdigest(),
        "schemaSha256": hashlib.sha256((extension / "schema.graphql").read_bytes()).hexdigest(),
        "rawWasmSha256": hashlib.sha256((extension / f"target/cart-{target}.raw.wasm").read_bytes()).hexdigest(),
        "finalWasmSha256": hashlib.sha256((extension / f"target/cart-{target}.wasm").read_bytes()).hexdigest(),
        "rawWasmBytes": (extension / f"target/cart-{target}.raw.wasm").stat().st_size,
        "finalWasmBytes": (extension / f"target/cart-{target}.wasm").stat().st_size,
        "cases": records,
    }

print(json.dumps(report, indent=2))
