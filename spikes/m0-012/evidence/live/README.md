# M0-012 operator-owned live evidence export

The files here are copied or captured after the one authorized run. The source
commit used for **every** live POST was
`ef9d50c6e77fe87913c3fd6242c6c4f2782875ae`. Later evidence/documentation
commits do not change or re-label that execution source.

| File | Provenance | SHA-256 |
| --- | --- | --- |
| `run-register.json` | Byte-for-byte export of `/home/serveradmin/.local/share/insignia-public-app/m0-012-run/register.json` after E3 processing attestation; original remains operator-owned, mode 0600. | `856b93bf4d6e8aaccba1d4412828c43890d590ebb5f7df1b9616977a3b43fa82` |
| `run-receipt.json` | Byte-for-byte export of independent `/home/serveradmin/insignia-pr16-review-handoff/M0-012-RUN-RECEIPT.json`; original remains operator-owned, mode 0600. | `153985092620158de647bbdbbaecd89b2335d2d6d84c235304` |
| `observation-rounds.md` | Byte-for-byte copy of the operator's six-round, read-only Partner/native-log observations in the same handoff directory. | `14a79417c196cac269531bc04b8a36503543a6e4796f2e584d765afceca302a7` |
| `final-contract.json` | Direct sanitized output from `node spikes/m0-012/src/operator.ts read` at `2026-09-28T18:10:01.787Z`; the helper used the protected Partner credential in memory and returned no token or raw response. | `eef89e5093d34ee33d1b14344366518fe536fd71c2c7e8391dd9ae2a5abe5bf3` |

The register contains the exact synthetic event body/key/time, SHA-256,
attempt status, sanitized HTTP status/request ID and metadata presence, and
human-attested billing observations. A local secret-presence scan found neither
the protected Partner token nor app client secret in it and found no bearer
header. No session or credential is tracked here. The native log URLs and row
IDs in `observation-rounds.md` identify the actual Dashboard entries; the
register's clean app Logs URL is a human attestation pointer, not an API-signed
proof of the log content.

The native App Billing Event details showed `SUCCESS` for E1, E2 and E3 with
their exact keys, handle, shop and value 1. The immediate E1 replay produced no
second processed billing row and Partner quantity remained 1. Six observation
rounds were used, below the twelve-round ceiling. HTTP 202 alone was never
treated as a billing result.
