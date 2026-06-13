# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

IPCraft is a VS Code extension providing visual editors for FPGA IP Core (`.ip.yml`) and Memory Map (`.mm.yml`) YAML specs, plus HDL code generation (VHDL/SystemVerilog), vendor project scaffolding (Vivado/Quartus), headless builds, and importers (VHDL, Platform Designer `_hw.tcl`, Vivado `component.xml`).

A more exhaustive, service-by-service map lives in `.github/copilot-instructions.md` — consult it for details not covered here.

## Commands

```bash
npm run compile        # Build extension + webview bundles (webpack, config/webpack.config.js)
npm run watch          # Webpack watch mode (F5 in VS Code launches an Extension Development Host)
npm run lint           # ESLint — zero warnings allowed (eslint src --max-warnings 0)
npm run lint:fix       # Auto-fix
npm run format         # Prettier over src/**/*.{ts,tsx}
npm run type-check     # tsc --noEmit
npm run generate-types # Regenerate src/webview/types/*.d.ts from ipcraft-spec JSON schemas

npm run test           # Unit tests (Jest, jsdom)  — alias of test:unit
npm run test:e2e       # VS Code integration tests (@vscode/test-electron); needs compile first
npm run test:browser   # Playwright browser tests
npm run test:integration:hdl  # HDL generation + GHDL/iverilog compile gate (config/jest.integration.js)
```

Run a single unit test (configs live in `config/`, so the `--config` flag is required):
```bash
npx jest --config config/jest.config.js src/test/suite/services/YamlValidator.test.ts
npx jest --config config/jest.config.js -t "should parse valid YAML"
```

`ipcraft-spec` is a **git submodule**. After cloning, run `git submodule update --init --recursive`. `npm run pretest` runs `scripts/check-submodule.js` and fails if it is missing.

## Architecture

Two webpack bundles run in **completely separate JS environments** and communicate only via VS Code's `postMessage`:

| Bundle | Entry | Target |
|---|---|---|
| `extension` | `src/extension.ts` | Node.js (VS Code extension host) |
| `webview` | `src/webview/index.tsx` (Memory Map), `src/webview/ipcore/IpCoreApp.tsx` (IP Core) | Browser (React UI) |

`src/providers/` register `vscode.CustomTextEditorProvider`s for `.ip.yml` and `.mm.yml`; the React webview is the editor UI. Source uses **relative imports** — the `@/`, `@webview/` etc. aliases exist only in jest's `moduleNameMapper` and are not used by source or webpack.

### The data round-trip (the part that requires reading multiple files)

1. **`src/domain/`** is the canonical normalized type layer shared across the process boundary. `parse.ts` converts raw YAML objects into `Normalized*` domain types (adding `rowId`); `serialize.ts` converts them back to schema-valid YAML objects, stripping computed properties.
2. **`rowId` is UI-only identity, never schema data.** `generateRowId()` assigns it; `serialize.ts` strips it (and `__kind`); `src/webview/utils/rowIdentity.ts` `reconcileRowIds` re-matches old row IDs to freshly parsed data so React table rows stay stable across reloads. Never persist `rowId` to disk or emit it in generated YAML.
3. **Format-preserving writes go through `src/yamledit/`** (`applyPathEdits`, `applyPathDeletes`), built on `yaml` v2 `parseDocument` to keep comments and hex spellings intact.

### Revisioned sync protocol (V-3/V-4)

`src/services/WebviewRouter.ts` (extension) and `src/webview/sync/revisionFilter.ts` (webview, pure functions) implement a paired FIFO protocol that prevents echo loops and stale renders:
- Extension stamps each `update` with `docVersion`; webview stamps each edit with a monotonic `editId` + `baseDocVersion`.
- Extension rejects edits whose `baseDocVersion` is stale and replies with `forceResync: true`.
- Webview drops echoes of its own edits (`sourceEditId <= lastSentEditId`) and stale updates (`docVersion <= seenDocVersion`).
- **Only change `revisionFilter.ts` together with `WebviewRouter`**; both are unit-tested in `src/test/suite/`. Test `revisionFilter` directly rather than through integration harnesses.

### Code generation

`src/generator/` uses **Nunjucks** (`.j2`) templates in `src/generator/templates/`, copied to `dist/templates/` at build time by `CopyWebpackPlugin`. Edit templates there, never in `dist/`. With `trimBlocks: true`, the newline after any closing `%}` is consumed — use `{% set var = value %}` for inline conditionals to avoid stray newlines in rendered HDL.

### Schema source of truth

`ipcraft-spec/schemas/*.schema.json` define `.ip.yml` / `.mm.yml` structure. `src/webview/types/*.d.ts` are **auto-generated** from them (`npm run generate-types`) — do not hand-edit. Bus definitions and schemas are copied into `dist/resources/` at build time.

## Key conventions

- **Two YAML libraries, used deliberately:** `js-yaml` (v4) for read-only parse / simple dump; `yaml` (v2) for any modify-and-write-back path (preserves comments + hex literals). Never use `js-yaml` to write back.
- **Strict camelCase, no dual-state fallbacks.** TypeScript/React/JSON-Schema properties are camelCase only (`allowedValues`, `uiGroup`, `dataType`). Never read or define snake_case in these domains, and never write fallback logic like `param.uiGroup ?? param.ui_group`. snake_case is reserved exclusively for variables inside Nunjucks/Jinja2 template contexts.
- **Logging:** extension side uses `new Logger('ComponentName')` (`src/utils/Logger.ts`), never `console.log`. Webview may use `console.warn`/`console.error` for error paths.
- **Styling:** Tailwind v3 utility classes in JSX; theme-aware colors via `var(--vscode-*)` (helpers in `src/webview/shared/colors.ts`).
- **`vscode` is mocked** via `__mocks__/vscode.ts` (jest maps `^vscode$` to it); use the mock's stubs, don't re-mock per file.

### Tests

- Unit: `src/test/suite/**/*.test.ts(x)` (Jest, jsdom). E2E: `src/test/e2e/` (real VS Code). Browser: `src/test/browser/` (Playwright; inject YAML via `window.__RENDER__`). HDL/vendor integration: `src/test/integration/` (own config). Fixtures in `src/test/fixtures/`.

## Project rules (from `.agents/rules/`)

- **No emojis anywhere**, in code, comments, or docs.
- **Never auto add/commit/push** — let the developer review first. Do not commit temporary debug-generated files.
- All planning/working docs go in `docs/`; never create planning files at the repo root.
- Before fixing a bug, prove the root cause with evidence, then fix the root cause (not the symptom) and prove it is fixed.
- Keep it simple — no over-engineering, no unnecessary defensive programming.
- Code must pass `npm run lint` (zero warnings) before any commit; the pre-commit hook (`lint-staged`/husky) enforces this.
