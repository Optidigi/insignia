# Typed tooling research

19 October 2026. Bounded reference evidence for the typed cleanup; not a policy amendment or runtime qualification. Inspected the research skill, local manifests/lockfile and installed first-party package source/types. No builds, tests, browser, deployment, credentials or provider operations were run. Public documentation reads were limited to primary sources.

## Pinned execution and checking

Repository pins: Node24.21.0, TypeScript5.9.3, Astro7.3.5, dependency-cruiser18.4.0 and Playwright1.63.0 (`package.json`, `apps/web/package.json`, `pnpm-lock.yaml`).

Node24.21 executes erasable TypeScript by stripping types; this performs no typechecking and ignores `tsconfig.json`, including path mappings. `.ts` follows package module type, `.mts` is ESM, `.cts` is CommonJS; `.tsx` is unsupported. File extensions are required, and type imports need `type`. Default stripping cannot lower enums, parameter properties or runtime namespaces. Suitable directly executed tools therefore need explicit compiler checking and compatible syntax/imports; emitted/bundled tools can retain their existing compiled module model. A correct `.js` specifier targeting emitted JavaScript is not handwritten JavaScript source. [Exact Node24.21 documentation](https://nodejs.org/download/release/v24.21.0/docs/api/typescript.html).

TypeScript `strict` enables the strict-checking family; `noEmit` separates checking from output generation. Project `include` determines initial file coverage, so a passing application project does not establish that every tool/test was checked. Inspect effective project coverage, include dedicated tool/test projects in CI and prove omitted/ill-typed examples are rejected. Current `apps/web/tsconfig.json` includes `src` and `astro.config.mjs`; `scripts/m1-functions/tsconfig.json` includes only `check-vector.test.ts`. These are source observations, not claims about future migrated coverage. [Strict](https://www.typescriptlang.org/tsconfig/strict.html), [noEmit](https://www.typescriptlang.org/tsconfig/noEmit.html), [include](https://www.typescriptlang.org/tsconfig/include.html).

## Configuration support

Astro supports TypeScript configuration and separate typechecking; its dev server does not itself typecheck. Installed Astro7.3.5 `apps/web/node_modules/astro/dist/core/config/config.js` lists `astro.config.mjs`, `.js`, `.ts` and `.mts`. Existing `astro check && astro build` should retain checking when configuration becomes typed. Keep Astro/Preact TSX compilation separate from Node's direct stripping. [Official Astro TypeScript guide](https://docs.astro.build/en/guides/typescript/).

Installed dependency-cruiser18.4.0 `src/config-utl/extract-depcruise-config/read-config.mjs` dynamically imports `.js/.cjs/.mjs/.mts/.cts/.ts` configurations and otherwise parses JSON5. Its adjacent resolver recognizes `.json` too. A typed ESM configuration is supported by this pinned loader, relying on the executing Node runtime; the loader does not supply compiler checking. Its current `.dependency-cruiser.cjs` can become typed without retaining a handwritten JavaScript wrapper. Confirm the updated checker, style command and explicit compiler project all reference the replacement. [Pinned maintainer source](https://github.com/sverweij/dependency-cruiser/blob/v18.4.0/src/config-utl/extract-depcruise-config/read-config.mjs).

## Browser clock and request deadlines

Playwright's clock installation replaces timeout/interval and animation/idle-frame APIs along with time sources; `fastForward` advances time and invokes due timers at most once. Installed1.63.0 `playwright-core/types/types.d.ts` independently documents these contracts. It is not a selective page-loading timer advance. [Official Clock API](https://playwright.dev/docs/api/class-clock).

Observed fixture: `apps/web/test/admin/editor-browser.test.mjs`, test “late authenticated read replaces the bootstrap timeout notice with the settled page”, installs the clock, holds the privacy HTTP route, advances16000ms and only then releases its response. Production `apps/web/src/shared/admin-request.ts` starts a10000ms timeout that aborts/rejects the request. **Inference:** once that request timer is installed, this fixture crosses the real request budget; releasing its response afterward cannot establish supported late-success behavior. Preserve the deadline. Test expired-request failure explicitly, or construct a distinct delayed-bootstrap scenario whose request remains within its own budget. Synchronize the actual boundary being tested rather than increasing deadlines or assuming animation time excludes fetch timers.

## Qualification still required

Run explicit migrated-project compiler checks, actual configuration loading, relevant built-artifact tests and the corrected browser scenario. Direct Node execution, a filename change and these documentation findings are not passing evidence. Preserve existing security/runtime boundaries and separately qualify changed deployment artifacts under their actual grants.
