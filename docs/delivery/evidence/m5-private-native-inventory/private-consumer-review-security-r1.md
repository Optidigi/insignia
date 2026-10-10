**CHANGES_REQUIRED — Standards/security**

**P1: the acquisition flow can persist its client secret.** [prototype.mjs:35](/home/serveradmin/insignia-milestone-autonomy-handoff/native-private-consumer-prototype/prototype.mjs:35) passes only the issued token into the collector. [collector.mjs:379](/home/serveradmin/insignia-milestone-autonomy-handoff/native-private-consumer-prototype/collector.mjs:379) checks responses for that token, then writes raw bodies before validating errors.

Concrete counterexample: the loopback OAuth fixture returns a valid, distinct token; the first Admin response returns `{"errors":[{"message":"<input client secret>"}]}`. The token reflection check misses it, and `response-1.body` durably contains the secret before collection stops. This violates the required no-secret-persistence contract in the new acquisition composition.

Smallest fix: add a private response guard covering both sensitive values before the unchanged collector can persist a body. Add a local control asserting secret reflection stops collection, creates no secret-bearing capture, and leaves the OAuth reservation consumed. Preserve the frozen historical bytes.

Verified [manifest](/home/serveradmin/insignia-milestone-autonomy-handoff/private-consumer-prototype-freeze.json) SHA256:
`f6b727917f5f4d25bb78734268a0643079306abb0c46cfb71ca2eeca9e666a88`.
All **41** listed hashes match; no unlisted artifact files were found. Inspected complete final JavaScript, interacting copied collector/CLI, public records, conditional operation, source note and relevant historical source/logs.

Static inspection only: no tests executed, network/provider access, edits or delegation. This verdict grants no credential authority, native readiness, PR64 renewal or principal acceptance. Future source/SSH/TLS/shared-ledger qualification, independent reviews and applicable integrated CI remain required; M5/G7, genuine uninstall and privacy gates remain blocked.