---
description: Repository Instructions
# applyTo: 'Describe when these instructions should be loaded' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---
* Always refer to `../../.agents/rules/*.md` for the latest rules and guidelines.

# IPCraft for VS Code — Copilot Instructions

## Project Overview

A VS Code extension providing a **visual editor** for FPGA IP Core (`.ip.yml`) and Memory Map (`.mm.yml`) YAML specifications. The extension renders a React-based webview panel as a custom editor, with two-way sync between the visual UI and the underlying YAML document.

---

## Build, Test & Lint

```bash
npm run compile          # Build both extension and webview bundles
npm run watch            # Watch mode for development

npm run test             # Run unit tests (Jest)
npm run test:unit        # Same as above
npm run test:e2e         # VS Code integration tests (requires compile first)
npm run test:browser     # Playwright browser tests

npm run lint             # ESLint — zero warnings allowed (--max-warnings 0)
npm run lint:fix         # Auto-fix lint issues
npm run format           # Prettier format all src/**/*.{ts,tsx}
npm run type-check       # tsc --noEmit (no output, type errors only)

npm run generate-types   # Regenerate src/webview/types/*.d.ts from JSON schemas
```

**Run a single Jest test file:**
```bash
npx jest src/test/suite/services/YamlValidator.test.ts
npx jest --testNamePattern "should parse valid YAML"
```

**Run a single Playwright test:**
```bash
npx playwright test src/test/browser/integration.test.ts
```

---

## Architecture

Two webpack bundles are produced — they run in completely separate JS environments and communicate only via VS Code's `postMessage` API:

| Bundle | Entry | Target | Purpose |
|---|---|---|---|
| `extension` | `src/extension.ts` | Node.js | VS Code extension host |
| `webview` | `src/webview/index.tsx`, `src/webview/ipcore/IpCoreApp.tsx` | Browser | React UI in the webview panel |

### Extension side (`src/`)

- **`extension.ts`** — Activation entry point; registers custom editor providers and commands.
- **`providers/`** — `MemoryMapEditorProvider` and `IpCoreEditorProvider` implement `vscode.CustomTextEditorProvider`. Both delegate to shared services created in `providerServices.ts`.
- **`services/`** — Extension-side services:
  - `HtmlGenerator` — Produces the webview's HTML shell with correct CSP and script URIs.
  - `MessageHandler` — Routes `update` / `command` messages from the webview; writes back to the document via `DocumentManager`.
  - `DocumentManager` — Reads and applies workspace edits to `vscode.TextDocument`.
  - `YamlValidator` — Validates YAML text; reports errors to the user.
  - `BusLibraryService` — Loads bus definitions from `dist/resources/bus_definitions.yml`.
  - `ImportResolver` — Resolves `$import` references between YAML files.
  - `FileSetUpdater` — Keeps paired `.ip.yml` / `.mm.yml` files in sync on disk.
- **`commands/`** — `FileCreationCommands.ts` (new IP Core / Memory Map files) and `GenerateCommands.ts` (VHDL generation, VHDL import).
- **`generator/`** — Nunjucks-based code generation. Templates in `generator/templates/*.j2` produce VHDL, AMD/Altera platform files, cocotb scaffolding, and the memmap YAML skeleton.
- **`parser/`** — `VhdlParser.ts` for importing existing VHDL entities.
- **`utils/`** — `Logger`, `ErrorHandler`, `vscodeHelpers` (safe command registration).

### Webview side (`src/webview/`)

- **`index.tsx`** — Memory Map editor root. Bootstraps the React app, registers `window.__RENDER__` for browser tests, and sends `{ type: 'ready' }` to the extension on mount.
- **`ipcore/IpCoreApp.tsx`** — IP Core editor root (separate bundle entry).
- **`hooks/`** — All stateful logic is in custom hooks: `useMemoryMapState`, `useSelection`, `useYamlSync`, `useSelectionLifecycle`, `useSelectionResolver`, `useYamlUpdateHandler`, `useOutlineRename`, `useDetailsNavigation`, etc.
- **`components/`** — Pure UI components: `Outline`, `DetailsPanel`, `RegisterMapVisualizer`, `AddressMapVisualizer`, `BitFieldVisualizer`, and subcomponents in `bitfield/`, `map/`, `memorymap/`, `outline/`, `register/`.
- **`services/`** — Webview-side business logic:
  - `YamlService` — js-yaml wrapper; strips computed properties before serialization.
  - `SpatialInsertionService` — Insert before/after with address repacking.
  - `FieldOperationService` — Insert/delete/move bit fields.
  - `DataNormalizer` — Canonicalizes raw parsed YAML into typed model objects.
  - `YamlPathResolver` — Maps selected object identity back to a YAML path for targeted edits.
- **`algorithms/`** — Pure functions: `BitFieldRepacker`, `RegisterRepacker`, `AddressBlockRepacker`.
- **`shared/`** — Reusable form components, constants, color utilities.
- **`types/`** — TypeScript types. `memoryMap.d.ts` and `ipCore.d.ts` are **auto-generated** from `ipcraft-spec/schemas/`. Do not edit them manually; run `npm run generate-types` instead.
- **`vscode.ts`** — Acquires the VS Code webview API (`acquireVsCodeApi()`); returns a stub when running outside VS Code (browser tests).

### Webview ↔ Extension messaging

| Direction | Message shape | Meaning |
|---|---|---|
| Webview → Extension | `{ type: 'ready' }` | Webview is mounted and ready to receive content |
| Extension → Webview | `{ type: 'update', text, fileName }` | Full YAML text to render |
| Webview → Extension | `{ type: 'update', text }` | User edited something; persist to document |
| Webview → Extension | `{ type: 'command', command: 'save' \| 'validate' \| 'openFile', ... }` | Delegate action to extension host |

---

## Key Conventions

### TypeScript path aliases
Configured in both `tsconfig.json` and `jest.config.js` (must be kept in sync):
```
@/         → src/
@webview/  → src/webview/
@services/ → src/services/
@utils/    → src/utils/
```

### `ipcraft-spec` local package
`ipcraft-spec` is a local git-submodule-style package (`"ipcraft-spec": "file:./ipcraft-spec"`). Its JSON schemas (`ipcraft-spec/schemas/*.schema.json`) are the source of truth for `.ip.yml` and `.mm.yml` file structures. Its `common/bus_definitions.yml` is copied into `dist/resources/` at build time.

### VHDL / artifact templates
All code generation uses **Nunjucks** (`.j2` extension) templates in `src/generator/templates/`. The `TemplateLoader` copies them to `dist/templates/` at build time (via `CopyWebpackPlugin`). Add or modify templates there, not in `dist/`.

### Mocking `vscode` in tests
The `vscode` module is mocked via `__mocks__/vscode.ts`. Jest maps `^vscode$` to this file. When writing tests for extension-side code, use the mock's exported stubs rather than re-mocking in each test file.

### Test organization
- Unit tests: `src/test/suite/**/*.test.ts(x)` — run by Jest, environment is `jsdom`.
- E2E tests: `src/test/e2e/` — run by `@vscode/test-electron` (real VS Code process).
- Browser tests: `src/test/browser/` — run by Playwright; use `window.__RENDER__` to inject YAML into the webview without VS Code.
- Fixtures: `src/test/fixtures/`.

### Styling
Tailwind CSS (v3) + PostCSS. Use Tailwind utility classes in JSX. VS Code theme variables (e.g. `var(--vscode-editor-background)`) are used for theme-aware colors — see `src/webview/shared/colors.ts` for helpers. Custom CSS class names follow the `vscode-*` prefix convention for theme-mapped rules.

### ESLint / Prettier
Zero-warning ESLint policy enforced in CI and on pre-commit (via `lint-staged`). Run `npm run lint:fix && npm run format` before committing. Prettier and ESLint are configured to run together on staged files automatically.

### Logger
Use `new Logger('ComponentName')` (from `src/utils/Logger.ts`) for extension-side logging — never `console.log`. In the webview, `console.warn` / `console.error` are acceptable for error paths.