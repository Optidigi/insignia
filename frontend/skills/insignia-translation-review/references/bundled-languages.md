# Bundled language choices

The current application ships `en`, `nl`, `de`, `fr`, `es` and `it`. The [package README](../../../../packages/localization/README.md) owns runtime coverage and fallback policy. A regional request uses its supported family’s copy while retaining regional formatting; this does not select a Shopify Market or publish a language.

These are the drafting choices used in the current AI-reviewed catalogs, not qualified human linguistic approval. Preserve them when revising nearby messages unless the actual context gives a reason to change them.

| Family | Address | Key distinctions |
| --- | --- | --- |
| Dutch `nl` | Informal `je` | `ontwerp` for artwork/design as context requires; `decoratiemethode`, `decoratieplek`, geometric `ontwerpgebied`; `artikel` for a physical unit. Read the [Dutch brief](dutch.md) for nuance. |
| German `de` | Formal `Sie` in instructions | `Motiv` for artwork, `Gestaltung` for the whole customization, `Veredelungsverfahren`, `Veredelungsposition`; `Artikel` for the charged unit, `Produkt` for the Shopify resource. |
| French `fr` | `vous` | `visuel` for artwork, `personnalisation` for the whole design, `technique`, configured `emplacement` versus geometric `zone`; `article` for a physical unit. |
| Spanish `es` | Informal `tú` | `diseño`/`archivo` for artwork, `personalización` for the whole workflow, method-neutral `técnica`, `posición`, `tamaño del diseño`; `artículo` for a unit. |
| Italian `it` | Informal `tu` | `grafica` for artwork, `personalizzazione` for the whole design being customized (close dialog, workflow), `design` for one saved, countable design (`Design salvati`, `Totali per design`, `un altro design`), `tecnica di decorazione`, `posizione`, `dimensione della decorazione`; `articolo` for a unit. |

Merchant-provided names remain values even when they happen to be English. Do not infer orientation, clothing size, product type, artwork method or grammatical gender from those values. Restructure surrounding copy when agreement cannot be known.

Keep complete, pending and ready-for-production distinct. A recorded refund is not proof that money has settled. Retrying an admitted upload’s status check is not uploading its file again. Method-summary fragments must agree with the surrounding count, or use a count-neutral label.

For the original drafting references and independent findings, see [the implementation record](../../../../docs/delivery/notes/bundled-ui-languages-2026-11-05.md). Reports identify their reviewed snapshots separately from the final manifest. They do not establish native-language certification.
