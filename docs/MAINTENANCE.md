 # Docs maintenance
 
 This file explains how to keep docs organized, link-safe, and tiered consistently.
 
 ## Link checker
 
 From the repo root:
 
 - `python scripts/check_internal_md_links.py`
 
 The script scans `docs/**/*.md` for broken internal links and exits non-zero if any are found.
 
 ## Adding or updating docs
 
 1. Choose the right home:
    - `docs/core/` for Tier 1 canonical contracts and invariants.
    - `docs/admin/`, `docs/storefront/`, `docs/backend/` for Tier 2 implementation specs.
    - `docs/notes/` for Tier 3 notes, design intent, audits, and research.
 2. Update `docs/DOC_CATALOG.md` with the doc’s path, tier, tags, and rationale.
 3. Update `docs/AGENT_ENTRY.md` so agents can find the new doc quickly.
 4. Use relative links and rerun the link checker.
 
 ## Tier rubric (summary)
 
 - **Tier 1 (canonical)**: defines system behavior/contracts/invariants; comprehensive and authoritative.
 - **Tier 2 (working)**: useful specs/how-tos, but incomplete or narrow.
 - **Tier 3 (notes)**: brainstorming, drafts, or uncertain/outdated notes.
 - **Archive**: deprecated or obsolete; keep only for history.
