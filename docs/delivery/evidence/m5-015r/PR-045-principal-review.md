# PR #45 — external principal review

**Verdict: APPROVED for normal merge as STOPPED incident evidence and corrected offline harness.**

Exact binding:
- base/effective merge base `245be82fd3dd3a0dbe808cb65340ce16e1caa503`
- head `ee86996a55b6c7f4cccfbb4b326522b6f9d0cb4c`
- tree `c68d782d6c0f985ad724c277435cf792e0a40bbe`
- 10/10 final-head workflows SUCCESS, all attempt 1
- native GitHub reviews none

PR #44 normal merge `245be82fd3dd3a0dbe808cb65340ce16e1caa503` has approved ordered parents:
1. `55060c5a48617a27858d10fb0db639c7e9efe148`
2. `02e45926529fed9659e1c3dca81dec5f5ebe3174`
and tree `8c906e854b9cadcb8e9eda2740a0098067a71ad0`.

## Incident adjudication

M5-015 is permanently `STOPPED_PRE_CREDENTIAL_GATE_BREACH`.

The initial synthetic harness used `fetch` instead of the production factory option `fetchImpl`. The adapter therefore fell back to global fetch.

Accepted facts:
- six pre-gate Shopify read attempts are reconstructed from three synthetic execution paths;
- requests used only a synthetic token and synthetic product GID `gid://shopify/Product/202`;
- adapter-level unauthorized failures were observed;
- individual raw transport receipts were not captured;
- protected credential access = 0;
- OAuth/client-credential exchanges = 0;
- provider mutations = 0;
- real fixture creation = 0;
- historical fixture targeted = false;
- canonical M5-015 live register never initialized;
- no provider request followed containment.

The six attempts are historical M5-015 incident accounting only. They are not six independently evidenced HTTP receipts and they do not carry into a fresh successor budget.

There is no cleanup obligation from this incident because no provider mutation/create occurred.

## Corrected harness

Accepted:
- `fetchImpl: op.fetch` is injected;
- synthetic runs require non-global injected transport;
- child-process lifecycle uses loopback only;
- persisted hold bytes/hash are checked before resume credentials;
- fresh-process resume is tested;
- the M5-015 live entry point is hard-stopped before credential loading;
- production packages/migrations remain unchanged;
- prior canonical evidence remains unchanged.

Synthetic PASS is not live qualification.

## Validation

- M5-015 focused operator/binding: 28 pass;
- Shopify v1/v2 adapter: 170 pass;
- application recovery: 20 pass;
- root checks pass;
- publication stress 100/100;
- renderer negative control passes;
- PostgreSQL 18.6 CI: 161 DB tests plus runtime/integration coverage;
- two fresh GPT-6.1-sol/high reviews: zero additional material findings;
- final-head CI: 10/10 success, attempt 1.

Local PostgreSQL unavailability is correctly disclosed.

## Disposition

PR #45 may be normally merged at the exact approved refs.

The old M5-015 experiment may never be resumed. Any new live qualification requires a fresh authority/register/budget. That successor is M5-015R.
