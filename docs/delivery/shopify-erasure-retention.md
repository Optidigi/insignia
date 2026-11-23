# Shopify shop erasure and accounting retention

The owner decision on 23 November 2026 is to keep minimal proof that Insignia
completed a verified shop deletion request and any records Optidigi is legally
required to keep for its own accounting.

## Records Optidigi keeps

The accounting system keeps Optidigi's Insignia subscription invoices, credit
notes and refunds, Shopify Partner payout and fee statements, payment records,
and the ledger and tax entries they support. Standard Dutch retention for these
core records is seven years from when the record ceases to have current value.
The ten-year rule applies to supplies and services declared through the relevant
VAT One Stop Shop scheme, if Optidigi uses it for those transactions.
[Netherlands Tax Administration retention guidance](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/administratie_bewaren/administratie_bewaren)

These records belong in Optidigi's accounting system. Insignia has no documented
accounting reason to keep merchants' retail orders, order IDs, customer or staff
identifiers, artwork, production files, signed quotes, stored credentials or
product configuration after a verified shop deletion request. Discovery and
reconciliation data follow the same erasure rule. If a particular record later
needs a legal hold, document the record, rule, expiry, custodian and access
restriction before adding an exception.

## Proof and restore

Keep the smallest receipt needed to assert completion and prevent replay or
backup restores from resurrecting erased shop data. It may include a keyed
identifier, exact generation, result and completion time. Keep raw webhook
bodies, shop domains, merchant customer and order details, tokens and signing
keys out of the proof. Match the lifetime of replay guards to the actual
delivery retry and backup retention windows.

Qualify with a genuine Shopify callback, verified deletion of database data and
private objects, and an isolated restore of a pre-erasure backup. Preserve any
new installation's data and show a repeated cleanup is safe. The staged
November 19 receipt proves the callback and fence. Completion requires the
erasure and restore checks. For the disposable shop uninstalled November 17,
the 30-day Shopify uninstall deadline falls on December 17, earlier than the
webhook receipt deadline of December 19. Compare any shorter commitment in the
published privacy policy.
[Shopify API terms](https://www.shopify.com/legal/api-terms) ·
[Shopify compliance webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)

## Implementation and remaining decisions

After the queue confirms cleanup, the finalizer replaces verified Shopify
delivery routing with keyed digests. An exact retry receives the original
processed receipt without creating a job. A conflicting retry is rejected.
The digests expire at the original seven-day receipt deadline and are pruned by
reconciliation. Erasure does not extend that deadline. Keep fresh restore
exclusions for every still-restorable backup, which currently expires within
seven days of capture. [Encrypted backup retention](../../deployment/backup/README.md#prerequisites-and-exact-snapshot-contract)

When the exact inactive current installation and its predecessors have drained,
the tenant row keeps its internal ID and generation counter and drops its
provider name and ID. The historical installation ID is replaced by a keyed
digest. A confirmed reinstall can recover the tenant and advance the counter.
A previously seen installation ID is rejected. A signed shop-redact body
identifies the shop only. A new unqualified request after reinstall stays on
hold, even if the successor has since deactivated. Existing exact recovery
decisions remain valid. Shared generationless rows, unresolved routing or
customer obligations, and unsettled storage keep the deletion open.

The seven-day window bounds transport replay and backup recovery. Retiring the
long-lived keyed tenant and installation fence, and the minimal provenance
rows that back it, still needs an owner decision about how to prevent older
installations from reacquiring authority after retirement. Pending customer
requests or independently staged customer fences also need disposition where
their installation scope cannot be proved. Successor erasure needs
independently qualified evidence that binds the privacy request to that exact
installation.

The draft migration generates the digest key inside the schema-owner boundary.
Rehearse a same-schema encrypted backup and isolated restore with that key
before enabling compaction, and retain the existing key for the lifetime of
its fences. Apply the reviewed lifecycle grants and deploy the compatible
webhook ingress before enabling finalization. Pre-migration backups need a
separately qualified offline path to the same schema and key or must age out
before compaction. No new runtime environment secret is needed.
