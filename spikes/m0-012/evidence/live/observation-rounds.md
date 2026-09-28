# M0-012 native observation rounds (operator held)

Run `m0-012-real-contract-20260928`; source `ef9d50c6e77fe87913c3fd6242c6c4f2782875ae`.
Maximum twelve scheduled post-send observation rounds across this package.
Each numbered row pairs one fixed Partner contract read and one native Dev
Dashboard App Billing Event log inspection. This file contains no credentials.

| Round | UTC read | Partner meter quantity/cost | Native billing log | Decision |
| --- | --- | --- | --- | --- |
| 1 | 2026-09-28T18:04:32.393Z | 1 / USD 0.0, exact unchanged contract | Initially unfiltered Logs showed only 12 older GraphQL requests. Applying **Type is App billing event** revealed one row at `2026-09-28T18:04:21Z`, handle `customized_order_paid`, exact shop. Detail `highid=117349984705016875`, `lowid=13436888381465704697`: **OK**, key `6d2be512e4f3ddb18f6d4980a0b4ba76`, value 1, billing result `SUCCESS`, exact Shop GID. | E1 BILLING_PROCESSED; exact replay may proceed after fresh attestation read |
| 2 | 2026-09-28T18:06:29.855Z | 1 / USD 0.0, exact unchanged contract | Filtered App Billing Event log still showed only the original E1 SUCCESS row after exact-key replay; no second processed row was visible. | Immediate replay adds no observed unit; record replay attestation |
| 3 | 2026-09-28T18:07:04.699Z | 2 / USD 0.0, exact unchanged contract | Filtered App Billing Event log showed E2 at `2026-09-28T18:06:55Z`, detail `highid=117349994797036541`, `lowid=11734444553274286991`: **OK**, key `5df5ab2456f020705f9d2cf87dfd602f`, value 1, billing result `SUCCESS`, exact Shop GID. Original E1 row remains. | E2 BILLING_PROCESSED; E3 may proceed after fresh attestation read |
| 4 | 2026-09-28T18:07:45.205Z | 3 / USD 0.0, exact unchanged contract | Filtered App Billing Event log still showed only E1 and E2 immediately after E3; E3 log not yet visible. | Wait; quantity alone cannot attest E3 processing |
| 5 | 2026-09-28T18:08:33.463Z | 3 / USD 0.0, exact unchanged contract | Filtered App Billing Event log showed E3 at `2026-09-28T18:07:39Z`, detail `highid=117349997693663656`, `lowid=12836214746424942647`: **OK**, key `b69dc64a35db4ac8bd5357973e928b94`, value 1, billing result `SUCCESS`, exact Shop GID. E1 and E2 rows remain. | E3 BILLING_PROCESSED; final aggregate is three distinct units, zero cost |
| 6 | 2026-09-28T18:10:01.787Z | 3 / USD 0.0, exact unchanged contract; sanitized fixed-target final readback retained in PR | Reloaded filtered App Billing Event log: exactly three rows for `customized_order_paid` and the designated shop; E1/E2/E3 detail results were checked in earlier rounds. | Final confirmation; no further event send |
