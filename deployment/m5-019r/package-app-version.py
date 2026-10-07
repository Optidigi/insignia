"""Materialize only the two frozen Function modules and the reviewed app config."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tomllib

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
assert not destination.exists(), "destination_must_be_new"
configuration = source / "deployment/m5-019r"
bindings = json.loads((configuration / "extension-bindings.json").read_text())
app = tomllib.loads((configuration / "shopify.app.m5-019r.toml").read_text())
assert app["client_id"] == "1443cf6d03d39edae7c101a943c5c684"
assert app["application_url"] == "https://insignia.optidigi.com/admin/products" and app["embedded"] is True
assert app["access_scopes"] == {
    "scopes": "",
    "optional_scopes": ["write_products", "read_publications", "read_product_listings"],
    "use_legacy_install_flow": False,
}
assert app["auth"] == {"redirect_urls": []} and app["webhooks"]["api_version"] == "2026-07"
assert app["extension_directories"] == ["extensions/insignia-cart-transform", "extensions/insignia-cart-validation"]
assert app["web_directories"] == []
destination.mkdir(mode=0o700)
shutil.copy2(configuration / "shopify.app.m5-019r.toml", destination)
for binding, name in zip(bindings, ["insignia-cart-transform", "insignia-cart-validation"], strict=True):
    original = source / "extensions" / name
    target = destination / "extensions" / name
    target.mkdir(parents=True)
    shutil.copy2(configuration / "extensions" / name / "shopify.extension.toml", target)
    module = tomllib.loads((target / "shopify.extension.toml").read_text())["extensions"][0]
    assert module["uid"] == binding["proposedLocalUid"] and module["handle"] == binding["handle"]
    assert module["build"]["command"] == "exit 1" and module["build"]["wasm_opt"] is False
    original_config = tomllib.loads((original / "shopify.extension.toml").read_text())
    packaged_config = tomllib.loads((target / "shopify.extension.toml").read_text())
    del packaged_config["extensions"][0]["uid"]
    packaged_config["extensions"][0]["build"]["command"] = original_config["extensions"][0]["build"]["command"]
    assert packaged_config == original_config, "unexpected_function_configuration_delta"
    shutil.copytree(original / "src", target / "src")
    (target / "target").mkdir()
    wasm = original / module["build"]["path"]
    assert hashlib.sha256(wasm.read_bytes()).hexdigest() == binding["wasmSha256"]
    shutil.copy2(wasm, target / module["build"]["path"])
    for name, digest in binding["sourceQuerySha256"].items():
        assert hashlib.sha256((target / "src" / name).read_bytes()).hexdigest() == digest
print(json.dumps({"modules": len(bindings), "themeIncluded": False, "rebuildAllowed": False, "providerRequests": 0}))
