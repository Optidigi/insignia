#!/usr/bin/env python3
"""Bind M1 build outputs to source and replay evidence; fail on missing output."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
required = [
    'Cargo.lock', 'pnpm-lock.yaml',
    'crates/cart-authorization/src/lib.rs',
    'crates/cart-authorization/src/whole.rs',
    'crates/cart-authorization/tests/production_vectors.rs',
    'crates/cart-authorization/tests/currency_matrix.rs',
    'packages/cart-authorization/src/whole-quote.ts',
    'packages/cart-authorization/src/admission.ts',
    'packages/cart-authorization/src/currency.ts',
    'packages/application/src/quote/accept-quote.ts',
    'packages/database/migrations/20260929000300_authorization_generation.sql',
    'packages/database/migrations/20260929000400_accepted_quote.sql',
    'packages/shopify/src/open-exchange-rates.ts',
    'packages/shopify/src/shop-context.ts',
    'apps/web/src/server/quote-composition.ts',
    'scripts/m4-002/replay-production-vectors.py',
    'crates/cart-transform/src/main.rs',
    'crates/cart-validation/src/main.rs',
    'extensions/insignia-cart-transform/schema.graphql',
    'extensions/insignia-cart-validation/schema.graphql',
    'extensions/insignia-cart-transform/src/cart_transform_run.graphql',
    'extensions/insignia-cart-validation/src/cart_validations_generate_run.graphql',
    'extensions/insignia-cart-transform/target/cart-transform.raw.wasm',
    'extensions/insignia-cart-transform/target/cart-transform.wasm',
    'extensions/insignia-cart-validation/target/cart-validation.raw.wasm',
    'extensions/insignia-cart-validation/target/cart-validation.wasm',
    'extensions/insignia-theme/assets/insignia-storefront.js',
    'apps/storefront/dist/insignia-storefront.js',
    'apps/web/dist/server/entry.mjs',
    'apps/worker/dist/main.js',
    '.m1-artifacts/replay.json',
    '.m4-002-artifacts/production-vectors-replay.json',
    'packages/cart-authorization/fixtures/currency-matrix-v1.json',
    'packages/cart-authorization/fixtures/whole-quote-v2.json',
]
for pattern in ['apps/web/dist/client/**/*.js']:
    matches = sorted(root.glob(pattern))
    if not matches:
        raise SystemExit(f'missing required artifact pattern: {pattern}')
    required.extend(str(path.relative_to(root)) for path in matches)

records = {}
for relative in sorted(set(required)):
    path = root / relative
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f'missing/empty required artifact: {relative}')
    records[relative] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

if records['extensions/insignia-theme/assets/insignia-storefront.js']['sha256'] != records['apps/storefront/dist/insignia-storefront.js']['sha256']:
    raise SystemExit('theme asset differs from current storefront build')

replay = json.loads((root / '.m1-artifacts/replay.json').read_text())
for target in ('transform', 'validation'):
    key = f'extensions/insignia-cart-{target}/target/cart-{target}.wasm'
    if replay[target]['finalWasmSha256'] != records[key]['sha256']:
        raise SystemExit(f'{target} replay is not bound to final Wasm')

destination = root / '.m1-artifacts/manifest.json'
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps({'version': 1, 'artifacts': records}, indent=2) + '\n')
print(f'{len(records)} required files hashed: {destination.relative_to(root)}')
