---
description: 'Repository Instructions'
# applyTo: 'Describe when these instructions should be loaded' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---
* Always refer to `../../.agents/rules/*.md` for the latest rules and guidelines.
* `../../CLAUDE.md` (repo root) is the canonical architecture map and conventions doc — read it first. This file only adds Copilot-specific notes and must not contradict it.

# IPCraft for VS Code — Copilot Instructions

## Project Overview

A VS Code extension providing a **visual editor** for FPGA IP Core (`.ip.yml`) and Memory Map (`.mm.yml`) YAML specifications, plus HDL code generation (VHDL/SystemVerilog), vendor project scaffolding (Vivado/Quartus), headless builds, and importers (VHDL, Platform Designer `_hw.tcl`, Vivado `component.xml`). The extension renders React-based webview panels as custom editors, with two-way sync between the visual UI and the underlying YAML document.

---

## Build, Test & Lint

```bash
npm run compile               # Build both extension and webview bundles (webpack)
npm run watch                 # Watch mode for development

npm run test                  # Unit tests (Jest, jsdom) — alias of test:unit
npm run test:e2e               # VS Code integration tests (@vscode/test-electron); requires compile first
npm run test:browser           # Playwright browser tests
npm run test:integration:hdl   # HDL generation + GHDL/iverilog compile gate
npm run test:integration:vivado
npm run test:integration:quartus

npm run lint                  # ESLint — zero warnings allowed (--max-warnings 0)
npm run lint:fix              # Auto-fix lint issues
npm run format                # Prettier format all src/**/*.{ts,tsx}
npm run type-check            # tsc --noEmit (no output, type errors only)

npm run generate-types        # Regenerate src/webview/types/*.d.ts from ipcraft-spec JSON schemas
```

**Jest, Playwright, and webpack configs all live under `config/`**, so default discovery will not find them — always pass `--config`:
```bash
npx jest --config config/jest.config.js src/test/suite/services/YamlValidator.test.ts
npx jest --config config/jest.config.js -t "should parse valid YAML"
```

`ipcraft-spec` is a **git submodule**. After cloning, run `git submodule update --init --recursive` — `npm run pretest` fails if it is missing.

---

## Architecture

Two webpack bundles are produced — they run in completely separate JS environments and communicate only via VS Code's `postMessage` API:

| Bundle | Entry | Target | Purpose |
|---|---|---|---|
| `extension` | `src/extension.ts` | Node.js | VS Code extension host |
| `webview` | `src/webview/index.tsx`, `src/webview/ipcore/IpCoreApp.tsx` | Browser | React UI (Memory Map editor, IP Core editor) |

### Extension side (`src/`)

- **`extension.ts`** — Activation entry point; registers custom editor providers and commands.
- **`providers/`** — `MemoryMapEditorProvider` and `IpCoreEditorProvider` implement `vscode.CustomTextEditorProvider`; also the Reports tree, staging panel, scaffold pack panel, and generate/source-preview providers.
- **`domain/`** — Canonical normalized type layer shared across the process boundary. `parse.ts` converts raw YAML into `Normalized*` types (adding UI-only `rowId`); `serialize.ts` converts back to schema-valid YAML, stripping computed properties.
- **`yamledit/`** — Format-preserving YAML writes (`applyPathEdits`, `applyPathDeletes`) built on `yaml` v2 `parseDocument`, preserving comments and hex literals. Never use `js-yaml` for write-back — it is read-only / simple-dump only.
- **`services/`** — Extension-side services: `WebviewRouter` (message dispatch + revisioned sync protocol), `DocumentManager`, `YamlValidator`, `BusLibraryService`, `ImportResolver`, `FileSetUpdater`, `HtmlGenerator`, `BuildRunner`, `ReportParser`, `ToolDetector`, `VivadoCatalogScanner`, `VivadoInterfaceScanner`, `WorkspaceBusDefinitionScanner`, `ResourceRoots`, `SubcoreResolver`; `services/toolchains/` (Vivado/Quartus toolchain adapters); `services/imports/` (memory-map import resolution).
- **`commands/`** — One file per command group: `FileCreationCommands.ts`, `GenerateCommands.ts`, `ScaffoldPackCommands.ts`, `BuildCommands.ts`, plus single-purpose command files (`editInIpPackager.ts`, `editInPlatformDesigner.ts`, `openInVivado.ts`, `openInQuartus.ts`, `scanVivadoCatalog.ts`, `scanVivadoInterfaces.ts`, `scanWorkspaceBusDefinitions.ts`, `copyComponentInstance.ts`, `migrateLegacyIpCore.ts`, `toggleEditorMode.ts`).
- **`generator/`** — Nunjucks (`.j2`) code generation. Templates in `generator/templates/`, bus definitions/wrappers in `generator/buses/`, scaffold-pack overrides in `generator/packs/`, port-width/param resolution in `generator/resolvers/`, cocotb testbench generation in `generator/testbench/`, shared generation contracts in `generator/contract/`. Produces VHDL or SystemVerilog RTL (per `ipcraft.generate.hdlLanguage`), Vivado and Quartus project files, and cocotb testbenches.
- **`parser/`** — `VhdlParser.ts`, `VerilogParser.ts` (VHDL/Verilog entity import), `HwTclParser.ts` (Platform Designer `_hw.tcl` import), `ComponentXmlParser.ts` / `VivadoInterfaceXmlParser.ts` (Vivado IP-XACT import).
- **`sidebar/`** — `IpCoreTreeDataProvider` (Explorer sidebar tree).
- **`shared/`** — Code shared between extension and webview builds: `messages/` (typed message contracts), width-expression AST/eval, bus VLNV/port-name helpers.
- **`utils/`** — `Logger`, `ErrorHandler`, `vscodeHelpers` (safe command registration).

### Webview side (`src/webview/`)

- **`index.tsx`** — Memory Map editor root. Bootstraps the React app, registers `window.__RENDER__` for browser tests.
- **`ipcore/IpCoreApp.tsx`** — IP Core editor root (separate bundle entry).
- **`hooks/`** — Stateful logic in custom hooks, including `useTableEditorState` (composing `useTableNavigation`, `useCellEditGuard`, `useHoverInsertBar`) shared by all table editors, `useFieldEditor`, `useYamlSync`, `useYamlUpdateHandler`, `useSelection*`.
- **`components/`** — UI components: `Outline`, `DetailsPanel`, `RegisterMapVisualizer`, `AddressMapVisualizer`, `BitFieldVisualizer`, and subcomponents under `bitfield/`, `map/`, `memorymap/`, `outline/`, `register/`.
- **`services/`** — `YamlService` (js-yaml wrapper for parsing/reading), `SpatialInsertionService`, `FieldOperationService`, `YamlPathResolver`.
- **`algorithms/`** — Pure layout functions. `LayoutEngine.ts` is the canonical module for bit-field layout (`recomputeBitfieldLayout`, `reorderBitfieldLayout`); `AddressBlockRepacker.ts`, `BitFieldRepacker.ts`, `RegisterRepacker.ts`, `MutationService.ts` handle block/register-level repacking.
- **`sync/`** — `revisionFilter.ts`: pure functions implementing the webview half of the revisioned sync protocol (paired with `WebviewRouter.ts` on the extension side).
- **`utils/`** — `rowIdentity.ts` (`reconcileRowIds` — re-matches `rowId`s across reparses), `reorderPreview.ts` (single source of truth for drag-reorder destination math).
- **`shared/`** — Reusable form components, constants, theme-aware color utilities (`colors.ts`).
- **`types/`** — `memoryMap.d.ts` and `ipCore.d.ts` are **auto-generated** from `ipcraft-spec/schemas/*.schema.json` (`npm run generate-types`); `editor.d.ts`, `registerModel.ts`, `selection.d.ts` are hand-written. Do not hand-edit the generated files.

### Webview ↔ Extension messaging

Extension and webview exchange revisioned `update`/edit messages (see `WebviewRouter.ts` and `revisionFilter.ts`): the extension stamps each `update` with `docVersion`, the webview stamps each edit with a monotonic `editId` + `baseDocVersion`; stale edits get `forceResync: true`, and the webview drops echoes of its own edits. Only change `revisionFilter.ts` together with `WebviewRouter.ts`.

---

## Key Conventions

### TypeScript path aliases — source code does NOT use them
`@/`, `@webview/`, `@services/`, `@utils/` exist **only** in `config/jest.config.js` / `config/jest.integration.js` `moduleNameMapper`. `tsconfig.json` defines no `paths`, and `config/webpack.config.js` defines no `resolve.alias`. All source uses relative imports — never write `from '@/...'` outside test files.

### `ipcraft-spec` submodule
`ipcraft-spec` is a git submodule. Its JSON schemas (`ipcraft-spec/schemas/*.schema.json`) are the source of truth for `.ip.yml` and `.mm.yml` file structures; its bus definitions are copied into `dist/resources/` at build time.

### VHDL / artifact templates
All code generation uses **Nunjucks** (`.j2` extension) templates in `src/generator/templates/`, copied to `dist/templates/` at build time by `CopyWebpackPlugin`. Add or modify templates there, never in `dist/`.

### Mocking `vscode` in tests
The `vscode` module is mocked via `__mocks__/vscode.ts`. Both Jest configs map `^vscode$` to this file. When writing tests for extension-side code, use the mock's exported stubs rather than re-mocking in each test file.

### Test organization
- Unit tests: `src/test/suite/**/*.test.ts(x)` — Jest, `jsdom`.
- E2E tests: `src/test/e2e/` — `@vscode/test-electron` (real VS Code process).
- Browser tests: `src/test/browser/` — Playwright; use `window.__RENDER__` to inject YAML into the webview without VS Code.
- Integration tests (HDL/vendor toolchains): `src/test/integration/` — own Jest config (`config/jest.integration.js`).
- Fixtures: `src/test/fixtures/`.

### Styling
Tailwind CSS (v3) utility classes in JSX. VS Code theme variables (e.g. `var(--vscode-editor-background)`) drive theme-aware colors — see `src/webview/shared/colors.ts` for helpers.

### ESLint / Prettier
Zero-warning ESLint policy enforced in CI and on pre-commit (via `lint-staged`/husky). Run `npm run lint:fix && npm run format` before committing.

### Logger
Use `new Logger('ComponentName')` (from `src/utils/Logger.ts`) for extension-side logging — never `console.log`. In the webview, `console.warn` / `console.error` are acceptable for error paths.

### Naming
Strict camelCase in TypeScript/React/JSON Schema property names — never snake_case, never dual-state fallbacks (`param.uiGroup ?? param.ui_group` is forbidden). snake_case is reserved for variables inside Nunjucks/Jinja2 template contexts.
