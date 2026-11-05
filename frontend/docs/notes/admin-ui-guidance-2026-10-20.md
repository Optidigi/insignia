# Admin UI guidance

Owner direction, 20 October 2026. Insignia's merchant admin uses Astro, Preact and Shopify Polaris web components, with Polaris 2.0 as the intended UI target. This note owns source priority and workflow. The [Orders implementation note](orders-overview-implementation-2026-10-20.md) records the local runtime migration and verification; deployment remains separate.

## Source priority and workflow

1. Read Shopify's official `shopify` skill and its `references/polaris-app-home.md` before admin UI work. This is the hosted iframe App Home model, not the Shopify-hosted `admin.app.home.render` extension. Search the exact component and version before using it, and validate generated UI with the same version.
2. Inspect the supplied live Shopify reference before choosing the composition. Compare its title/actions, toolbar, table framing, row density, icon glyphs and state hierarchy with the rendered implementation at comparable widths. Use official [App Home page patterns](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns) and supported components to reproduce that composition; a generic pattern example alone does not establish native fidelity. Record differences required by Insignia's actual data and actions. Astro owns routes and SSR; Preact islands own local interaction; direct App Bridge APIs handle Shopify host integration. Preserve the existing authentication, buyer and renderer boundaries.
3. Apply Shopify's [content](https://shopify.dev/docs/apps/design/content), [voice and tone](https://shopify.dev/docs/apps/design/content/voice-and-tone), [layout](https://shopify.dev/docs/apps/design/layout) and [visual design](https://shopify.dev/docs/apps/design/visual-design) guidance. These sources govern merchant-facing choices.
4. Use the project-local [Vercel review skill](../../../.agents/skills/web-design-guidelines/SKILL.md) for supplementary accessibility, focus, forms, responsive layout and interaction checks. Resolve its generic HTML examples through the supported Polaris API. Shopify governs component choice and copy, including sentence case. Vercel's title-case, loading-copy and app-router examples do not override Shopify or the existing silent skeleton requirement.
5. Use the existing Matt Pocock TDD, diagnosis, review and writing skills when applicable. Their [project adaptations](../../../.agents/skills/PROJECT-ADAPTATIONS.md) remain in force. React/Next.js performance recommendations apply only where compatible with this Astro/Preact implementation; they are not a framework migration instruction.

## Polaris 2.0 preparation

As checked on 20 October, Shopify identifies 1.1 as stable and 2.0 as a release candidate. Local UI development now selects `polaris-2.0-rc.js` with matching `@shopify/polaris-types` prerelease types. Read exact pins from the layout and manifest. [Versioning](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning)

Follow [Shopify's Polaris 2 migration guide](https://shopify.dev/docs/apps/build/app-home/polaris2). Keep the single CDN script, matching type package, lockfile, source enforcement and browser fixtures aligned. Use toolkit `--version 2.0-rc` for this target. Load App Bridge before Polaris. Check both Shopify admin appearances, canvas framing, overlays, focus and narrow layouts. Polaris selects the host appearance itself. Local synthetic checks do not establish either native admin appearance or owner acceptance.

## Copy and design checks

Use a short task or resource title, then the controls and information needed for that task. Add supporting text only when it explains a consequence, a choice or recovery. Each state must describe actual application behavior. [Shopify content](https://shopify.dev/docs/apps/design/content)

| UI purpose | Insignia copy direction |
| --- | --- |
| Product list | `Products`. Omit a tagline below it. |
| Draft save | `Save draft`. Use a distinct `Publish` action for publication. |
| Empty product list | `No products configured` and an available action that selects a product. |
| Missing decoration price | `Add a price for Back / Screen print / Small.` Use the actual labels. |
| Save conflict | `This draft changed in another session. Reload it before saving.` Preserve recovery options that exist. |

These are proposed labels, not evidence that a feature or recovery action exists. Keep garment size and decoration size distinct. Keep save, publication requested and publication active distinct. Explain merchant-only artwork-later accurately. Preserve necessary pricing, privacy and error information while cutting repeated headings, slogans, inflated claims and implementation notes.

Use Polaris defaults and semantic color roles. Group related content in useful sections and tables. A card is appropriate when the Shopify pattern calls for it; decorative card grids, large promotional heroes, gradients, oversized headings, arbitrary accent colors and invented metrics have no default role in this admin. This is project direction, not a claim that every model produces those mistakes.

For each changed workflow, inspect desktop and narrow rendered states and exercise pointer, keyboard, focus, scrolling, unsaved changes, validation, saving, errors and recovery as relevant. Preserve silent, accessible skeletons for route transitions. A screenshot alone does not qualify interaction behavior. The [public-feedback note](admin-design-feedback-2026-10-20.md) records the model-specific anecdotes and their limits.

Use the smallest relevant test set covering the changed behavior. Broaden checks only for a concrete dependency, failure or unresolved risk; the owner explicitly prefers minimal test runs.

Component validation establishes supported contracts. Visual comparison establishes observed composition; owner acceptance remains separate. When Chrome browser integration is unavailable, recheck native app controls before reporting Chrome inaccessible. A token-only App Bridge double suppresses Polaris Page's local heading without supplying the host title bar. Use the preview's explicit outer host for local inspection and qualify the actual embedded app separately. The [Orders diagnosis](orders-reference-diagnosis-2026-10-20.md) records this failure and correction.

For resource tables, verify the primary row action outside its text using supported `clickDelegate` and retain a real keyboard-accessible link. Check rendered icon shapes, loaded fonts and weight, pointer/keyboard hover and loading behavior. Use the admin locale and authenticated store time zone for display dates, with an explicit fallback when context is absent. Sorting and filtering controls must match the query capabilities and scope of the endpoint.

Before implementing a reference interaction, identify its public component contract and Insignia's supporting query/action. Implement a complete supported interaction or record its omission. Use one consistent sorting control when the endpoint supports only date sorting; a lone custom arrow in one header is not a substitute for Shopify's complete sortable table. Public Polaris owns glyph sizing, hover, typography and elevation. Compare both the closed control and its opened, loading and failure states with the live reference. The [Orders overview and detail refinement](orders-detail-refinement-2026-10-20.md) records the current intentional differences.

## Installed tools and provenance

- Shopify's consolidated `shopify` skill, metadata version `1.18.0`, is installed at `~/.codex/skills/shopify`, from [Shopify/shopify-ai-toolkit at a788f6a](https://github.com/Shopify/shopify-ai-toolkit/tree/a788f6a87cad4be5dfac814605a7288dc9e8f3db/skills/shopify). Its MIT license is retained. It includes the App Home reference, documentation search and validation scripts. Superseded per-surface skills are unnecessary. [Official installation guidance](https://shopify.dev/docs/apps/build/ai-toolkit)
- The project-local Vercel `web-design-guidelines` skill is copied unchanged from [vercel-labs/agent-skills at 063bee9](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines). Upstream identifies the collection as MIT licensed in its [README](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/README.md). It fetches current Vercel rules when reviewing.
- Existing project-local Matt Pocock skills retain their pinned provenance and license. They are engineering guidance, not a replacement visual design system.
- Shopify Dev MCP `1.17.0` is registered in the local Codex user configuration and recorded in `.codex/config.toml` for this project. The [official MCP setup](https://shopify.dev/docs/api/polaris/using-mcp) uses `@shopify/dev-mcp`; the pin makes upgrades deliberate. It needs no Shopify store authentication for public developer documentation. Reload Codex to load the new server into its tool list. A fresh machine can register the same server with `codex mcp add --env OPT_OUT_INSTRUMENTATION=true shopify-dev-mcp -- npx -y @shopify/dev-mcp@1.17.0`.

The Shopify skill lives outside the repository because its upstream JavaScript helpers are external developer tools. Insignia's maintained-source policy requires typed application and operations code. Do not weaken that policy or convert upstream helpers just to vendor the toolkit.

To reproduce the skill installation with Codex's bundled installer:

```sh
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo Shopify/shopify-ai-toolkit --ref a788f6a87cad4be5dfac814605a7288dc9e8f3db --path skills/shopify
npm install --prefix ~/.codex/skills/shopify --ignore-scripts --no-audit --no-fund --save-exact typescript@5.9.3
```

Keep `OPT_OUT_INSTRUMENTATION=true` on toolkit helper invocations; the MCP config already sets it. Helpers search public documentation and may download versioned type catalogs. Run their `--help` before choosing flags. Validation checks supported component contracts; local build and browser tests still verify Insignia's behavior. New skills become discoverable on the next turn.

Preparation checks passed: authenticated GitHub repo lookup as `Optidigi-AK` returned `ADMIN`; MCP initialization reported `shopify-dev-mcp` version `1.17.0` and returned its tool list; skill documentation search succeeded for both 1.1 and 2.0-rc; the component validator accepted a sample `s-page`/`s-section`/`s-text` composition for `2.0-rc`, resolving the catalog to `v2.0`, and rejected an invented component in a negative control. TOML parsing and local guidance links passed. These checks qualify developer tooling, not a migrated application.
