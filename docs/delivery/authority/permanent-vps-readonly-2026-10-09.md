# Owner allocation — permanent read-only VPS access

On 9 October 2026 the owner stated: “okay, you are permanently permitted to check, read, access vps”. [Exact attestation/provenance](../evidence/m5-uninstall-authority-quarantine/owner-permanent-vps-readonly.json) binds the established VPS `65.109.22.104`, `serveradmin`, port22.

This prospectively supersedes earlier owner VPS read-count and authorization-window limits. Use the existing verified identity and pinned host key; no new key setup or recurring permission renewal is needed for necessary read-only VPS inspection. Technical calls still use bounded deadlines/output, private durable accounting and least privilege. Their expiry is an execution limit, not expiry of owner permission. Closed historical runs remain immutable and never resume; account for failed/ambiguous attempts honestly.

This grant covers VPS access/inspection, not production changes, deployment/provisioning, SQL writes, credential export, app launch/Search/bootstrap, independent Shopify calls, installation/subscription experiments, versions/releases/scopes, merchant fixtures or rollout. A needed out-of-envelope action requires a concrete reviewable allocation under [operating model §7](../operating-model.md). The current read runs perform no SQL. Private captures remain restricted and expire within seven days or earlier; no automatic cleanup daemon is claimed. Keep secret values and unrelated service details out of public evidence.

Read only the facts required for the active milestone; stop collecting when they are established. Permanent permission is not an instruction to poll indefinitely or claim M5 readiness from metadata.
