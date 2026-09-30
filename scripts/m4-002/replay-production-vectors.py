#!/usr/bin/env python3
"""Replay production TypeScript v2 carriers through both complete local Functions.

Uses only committed synthetic fixtures and the pinned local Function runner.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
VECTORS = ROOT / 'packages/cart-authorization/fixtures/whole-quote-v2.json'
ACCEPTED_EXAMPLE = ROOT / 'docs/delivery/evidence/m4-002/synthetic-accepted-quote.json'
RUNNER = Path(os.environ['M1_FUNCTION_RUNNER'])
OUT = ROOT / '.m4-002-artifacts'
OUT.mkdir(exist_ok=True)


def compact(value):
    return json.dumps(value, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def money(minor):
    amount = int(minor)
    return f'{amount // 100}.{amount % 100:02d}'


def make_input(target, case, vectors):
    template = json.loads((ROOT / f'crates/cart-{target}/fixtures/valid.json').read_text())
    header = case['header']
    config = json.loads(template['shop']['publicConfig']['value'])
    config['generationHex'] = header['generationHex']
    config['epoch'] = header['epoch']
    config['maxBuckets'] = 32
    config['maxPhysicalQuantity'] = 10000
    config['keys'] = [{
        'id': header['keyId'], 'publicHex': case.get('publicHex', vectors['publicHex']),
        'revoked': False, 'firstDay': case.get('firstValidDay', 20800),
        'lastDay': case.get('lastValidDay', 20802),
    }]
    template['shop']['publicConfig']['value'] = json.dumps(config, separators=(',', ':'))
    template['shop']['localTime']['date'] = case.get('acceptedDate', '2026-12-13')
    template['localization']['country']['isoCode'] = header['country']
    template['localization']['market']['id'] = f"gid://shopify/Market/{header['marketId']}"
    template['cart']['quote'] = {'value': case['envelope']}
    model = template['cart']['lines'][0]
    template['cart']['lines'] = []
    for index, (member, carrier) in enumerate(zip(case['members'], case['memberCarriers'], strict=True)):
        line = copy.deepcopy(model)
        line['id'] = f'gid://shopify/CartLine/{index + 1}'
        line['member'] = {'value': carrier}
        line['quantity'] = member['quantity']
        line['merchandise']['id'] = f"gid://shopify/ProductVariant/{member['variantId']}"
        line['merchandise']['product']['id'] = f'gid://shopify/Product/{42 + index % 3}'
        line['merchandise']['product']['policy']['value'] = f"{header['generationHex']}:1:required"
        line['merchandise']['product']['registration']['value'] = f"{header['generationHex']}:1:ready"
        line['cost'].setdefault('subtotalAmount', {})
        line['cost'].setdefault('amountPerQuantity', {})['currencyCode'] = header['currency']
        if target == 'validation':
            line['cost']['subtotalAmount']['amount'] = money(int(member['quantity']) * int(member['unitMinor']))
            line['cost']['subtotalAmount']['currencyCode'] = header['currency']
        else:
            line['cost']['subtotalAmount']['currencyCode'] = header['currency']
        template['cart']['lines'].append(line)
    for index in range(case['ordinaryLines']):
        line = copy.deepcopy(model)
        line['id'] = f'gid://shopify/CartLine/{len(case["members"]) + index + 1}'
        line['member'] = None
        line['quantity'] = 1
        line['merchandise']['id'] = f'gid://shopify/ProductVariant/{100000 + index}'
        line['merchandise']['product']['policy'] = None
        line['merchandise']['product']['registration'] = None
        line['cost'].setdefault('subtotalAmount', {})
        line['cost'].setdefault('amountPerQuantity', {})['currencyCode'] = header['currency']
        line['cost']['subtotalAmount']['currencyCode'] = header['currency']
        if target == 'validation':
            line['cost']['subtotalAmount']['amount'] = '10.00'
        template['cart']['lines'].append(line)
    return template


def run(target, name, payload, expected_count):
    extension = ROOT / f'extensions/insignia-cart-{target}'
    wasm = extension / f'target/cart-{target}.wasm'
    query = extension / 'src' / (
        'cart_transform_run.graphql' if target == 'transform' else 'cart_validations_generate_run.graphql'
    )
    export = 'cart_transform_run' if target == 'transform' else 'cart_validations_generate_run'
    raw = compact(payload)
    with tempfile.TemporaryDirectory(dir=OUT) as temporary:
        input_file = Path(temporary) / 'input.json'
        input_file.write_bytes(raw)
        process = subprocess.run(
            [str(RUNNER), '-f', str(wasm), '-i', str(input_file), '-e', export,
             '-q', str(query), '-s', str(extension / 'schema.graphql'), '-j'],
            check=True, capture_output=True, text=True,
        )
    result = json.loads(process.stdout)
    assert result['success'], (target, name, result.get('logs'))
    output = result['output']
    actual_count = len(output['operations'])
    assert actual_count == expected_count, (target, name, actual_count, expected_count)
    output_bytes = len(compact(output))
    # Mirrors the checked Rust and production TypeScript maxima: 36-character UUID CartLine
    # suffix, 20-digit variant suffix, 30-byte member carrier and 21-byte amount.
    transform_upper = 17 + 362 * actual_count + max(0, actual_count - 1)
    if target == 'transform':
        assert output_bytes <= transform_upper <= 16000, (name, output_bytes, transform_upper)
    return {
        'target': target, 'case': name, 'expectedOperations': expected_count,
        'actualOperations': actual_count, 'inputBytes': len(raw),
        'outputBytes': output_bytes, 'transformOutputUpperBytes': transform_upper if target == 'transform' else None,
        'inputSha256': sha(raw),
        'outputSha256': sha(compact(output)), 'instructions': result['instructions'],
        'linearMemoryKiB': result['memory_usage'],
        'wasmSha256': sha(wasm.read_bytes()), 'wasmBytes': wasm.stat().st_size,
        'querySha256': sha(query.read_bytes()), 'queryBytes': query.stat().st_size,
        'calculatedQueryCost': 20 if target == 'transform' else 23,
        'stackBytes': None, 'stackStatus': 'unmeasured: pinned runner exposes linear memory, not stack peak',
    }


vectors = json.loads(VECTORS.read_text())
assert vectors['version'] == 'whole-quote-v2-candidate-v1'
accepted_example = json.loads(ACCEPTED_EXAMPLE.read_text())
assert accepted_example['quote']['economics']['groups'][0]['customizationUnitMinor'] == '-1'
assert [line['unitPriceMinor'] for line in accepted_example['quote']['economics']['lines']] == ['1', '0']
assert accepted_example['quote']['economics']['version'] == 'm4-quote-economics-v1'
assert all('canonicalIdentity' not in item and len(item['canonicalIdentitySha256']) == 64
           for kind in ('groups', 'lines') for item in accepted_example['quote']['economics'][kind])
assert '"art"' not in json.dumps(accepted_example['quote'])
accepted_case = dict(accepted_example['functionVector'], publicHex=accepted_example['publicKeyHex'])
rows = []
for target in ('transform', 'validation'):
    for case in [*vectors['cases'], accepted_case]:
        base = make_input(target, case, vectors)
        count = len(case['members'])
        rows.append(run(target, case['name'], base, count if target == 'transform' else 0))
        reordered = copy.deepcopy(base)
        reordered['cart']['lines'].reverse()
        rows.append(run(target, case['name'] + '-reordered', reordered, count if target == 'transform' else 0))
        alterations = {
            'country': lambda x: x['localization']['country'].__setitem__(
                'isoCode', 'DE' if case['header']['country'] == 'US' else 'US'),
            'market': lambda x: x['localization']['market'].__setitem__('id', 'gid://shopify/Market/43'),
            'currency': lambda x: x['cart']['lines'][0]['cost'].__setitem__(
                'amountPerQuantity' if target == 'transform' else 'subtotalAmount',
                {'currencyCode': 'EUR' if case['header']['currency'] == 'USD' else 'USD'} if target == 'transform' else {
                    **x['cart']['lines'][0]['cost']['subtotalAmount'],
                    'currencyCode': 'EUR' if case['header']['currency'] == 'USD' else 'USD'}),
            'generation': lambda x: x['shop']['publicConfig'].__setitem__('value',
                x['shop']['publicConfig']['value'].replace(case['header']['generationHex'], '00' * 16)),
            'epoch': lambda x: x['shop']['publicConfig'].__setitem__('value',
                x['shop']['publicConfig']['value'].replace('"epoch":4', '"epoch":5')),
            'missing-member': lambda x: x['cart']['lines'][0].__setitem__('member', None),
            'wrong-variant': lambda x: x['cart']['lines'][0]['merchandise'].__setitem__('id', 'gid://shopify/ProductVariant/999999'),
            'wrong-quantity': lambda x: x['cart']['lines'][0].__setitem__('quantity', x['cart']['lines'][0]['quantity'] + 1),
            'selling-plan': lambda x: x['cart']['lines'][0].__setitem__('sellingPlanAllocation',
                {'sellingPlan': {'id': 'gid://shopify/SellingPlan/1'}}),
        }
        if count > 1:
            alterations['duplicate-member'] = lambda x: x['cart']['lines'][1].__setitem__(
                'member', copy.deepcopy(x['cart']['lines'][0]['member']))
        if target == 'validation':
            alterations['wrong-price'] = lambda x: x['cart']['lines'][0]['cost']['subtotalAmount'].__setitem__('amount', '9.99')
        for label, mutate in alterations.items():
            changed = copy.deepcopy(base)
            mutate(changed)
            rows.append(run(target, case['name'] + '-' + label, changed, 0 if target == 'transform' else 1))
        changed = copy.deepcopy(base)
        config = json.loads(changed['shop']['publicConfig']['value'])
        config['keys'][0]['revoked'] = True
        changed['shop']['publicConfig']['value'] = json.dumps(config, separators=(',', ':'))
        rows.append(run(target, case['name'] + '-revoked', changed, 0 if target == 'transform' else 1))
        changed = copy.deepcopy(base)
        config = json.loads(changed['shop']['publicConfig']['value'])
        config['keys'][0]['lastDay'] = case.get('firstValidDay', 20800) - 1
        changed['shop']['publicConfig']['value'] = json.dumps(config, separators=(',', ':'))
        rows.append(run(target, case['name'] + '-key-out-of-window', changed, 0 if target == 'transform' else 1))

manifest = {'version': 1, 'sourceVectorsSha256': sha(VECTORS.read_bytes()),
            'acceptedQuoteExampleSha256': sha(ACCEPTED_EXAMPLE.read_bytes()),
            'runnerSha256': sha(RUNNER.read_bytes()), 'rows': rows}
(OUT / 'production-vectors-replay.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'rows': len(rows), 'positive': sum('-' not in row['case'] for row in rows),
                  'vectorsSha256': manifest['sourceVectorsSha256'],
                  'transformWasmSha256': next(row['wasmSha256'] for row in rows if row['target'] == 'transform'),
                  'validationWasmSha256': next(row['wasmSha256'] for row in rows if row['target'] == 'validation')}, indent=2))
