# Development Setup

## Prerequisites

- **Node.js 20+** and **npm**
- **VS Code**
- **Python 3** (optional — needed only for `docs_*` targets)
- **CMake 3.20+** (optional — provides a unified build interface, see below)

## Setup

=== "CMake (recommended)"
    ```bash
    cmake -B build          # configure once
    cmake --build build --target setup
    ```
    `setup` runs `npm install` → `generate-types` → `compile` in sequence.

=== "npm"
    ```bash
    npm install
    npm run generate-types   # regenerate TypeScript types from JSON schemas
    npm run compile
    ```

Launch the Extension Development Host with **F5**.

## Architecture at a Glance

IPCraft runs in two JavaScript environments that communicate through `postMessage`:

- The **extension host** runs in Node.js and owns VS Code APIs, files, commands, importers,
  generation, and vendor tools.
- The **webviews** run in embedded browsers and render the Memory Map, IP Core, and Data
  Inspector React applications.

The main entry points are `src/extension.ts`, `src/webview/index.tsx`,
`src/webview/ipcore/IpCoreApp.tsx`, and `src/webview/dataInspector/index.tsx`. Start with
[Architecture Overview](../architecture/overview.md) before changing the message boundary.

## Repository Layout

```text
src/
  extension.ts              # entry point
  commands/                 # VS Code command implementations
  providers/                # custom editor providers
  services/                 # extension host services
  parser/                   # VHDL parser
  generator/                # VHDL scaffolding + Nunjucks templates
  utils/                    # logging, error handling, helpers
  webview/                  # React apps (Memory Map & IP Core)
  test/suite/               # Jest unit tests
config/                     # Tool configurations (Jest, Webpack, Playwright, etc.)
resources/                  # Icons and static assets
docs/                       # this documentation
ipcraft-spec/               # specification schemas + examples (local package)
```

## Build, Lint, Type Check

=== "CMake"

    | Target | Purpose |
    |--------|---------|
    | `compile` | Dev build (webpack, source maps on) |
    | `build` | Production build (minified) |
    | `watch` | Webpack watch mode |
    | `lint` | ESLint (zero warnings) |
    | `lint_fix` | ESLint auto-fix |
    | `type_check` | TypeScript check without emit |
    | `format` | Prettier write |
    | `format_check` | Prettier read-only check |
    | `generate_types` | Regenerate types from JSON schemas |

    ```bash
    cmake --build build --target <target>
    cmake --build build --target usage   # list all available targets
    ```

=== "npm"

    | Command | Purpose |
    |---------|---------|
    | `npm run compile` | Dev build (webpack) |
    | `npm run watch` | Webpack watch mode |
    | `npm run package` | Production build |
    | `npm run lint` | Run ESLint (zero warnings) |
    | `npm run lint:fix` | Auto-fix lint issues |
    | `npm run type-check` | TypeScript check without emit |
    | `npm run format` | Prettier format |
    | `npm run generate-types` | Regenerate types from JSON schemas |

## YAML Editing Rule

IPCraft deliberately uses two YAML libraries:

| Library | Use |
|---------|-----|
| `js-yaml` v4 | Read-only parsing or simple output where formatting preservation is irrelevant |
| `yaml` v2 | Any modify-and-write-back path that must preserve comments and numeric spellings |

Format-preserving writes go through `src/yamledit/` (`applyPathEdits`,
`applyPathDeletes`). Do not introduce a `js-yaml` dump into an editor write-back path.

## Testing

=== "CMake"

    | Target | Purpose |
    |--------|---------|
    | `test` | Jest unit tests |
    | `test_coverage` | Jest unit tests + HTML/LCOV coverage → `coverage/` |
    | `test_watch` | Jest watch mode (TDD) |
    | `test_e2e` | VS Code E2E tests (requires display / xvfb) |
    | `test_browser` | Playwright browser tests (Chromium headless) |
    | `test_all` | All suites: unit + e2e + browser |

    ```bash
    cmake --build build --target test
    cmake --build build --target test_coverage
    ```

=== "npm"

    | Command | Purpose |
    |---------|---------|
    | `npm run test:unit` | Jest unit tests (`src/test/suite/**`) |
    | `npm run test:unit -- --testPathPatterns <file>` | Run a single test file |
    | `npm run test:unit:coverage` | Tests with coverage report |
    | `npm run test:browser` | Playwright browser tests (Chromium headless) |
    | `npm run test:e2e` | VS Code E2E tests (requires display / xvfb) |

!!! note
    `npm run pretest` runs compile + lint before tests. For fast iteration, run `test:unit` directly.

## Packaging a VSIX

```bash
cmake --build build --target vsix
# or
npx vsce package
```

See [Building a VSIX Package](../how-to/build-vsix.md) for the full workflow including version bumps and installation.

## Debugging

### Extension Host

- Set breakpoints in `src/**/*.ts`
- View logs in the Extension Host debug console
- Logging: `src/utils/Logger.ts` and `src/utils/ErrorHandler.ts`

### Webview

- Open **Developer: Toggle Developer Tools** in the Extension Development Host
- Inspect console for React webview errors
- Trace message flow: provider `onDidReceiveMessage` → `WebviewRouter` → `DocumentManager`; on the webview side, `useYamlSync` (Memory Map) / `useIpCoreSync` (IP Core)

## Common Development Tasks

Good first contributions include focused unit-test improvements, validation messages,
small component fixes, and documentation corrections. Keep changes narrow and add a regression
test when fixing behavior.

### Add a new command

1. Implement in `src/commands/*`
2. Register in `src/extension.ts`
3. Add command contribution in `package.json`

### Add a memory map feature

1. UI behavior in the relevant component or hook
2. Algorithm in `src/webview/algorithms/` or service in `src/webview/services/`
3. Tests in `src/test/suite/`
4. Update docs

### Add generator behavior

1. Update `src/generator/*` and templates in `src/generator/templates/*`
2. VHDL templates use `*.vhdl.j2` suffix; SystemVerilog templates use `*.sv.j2`; vendor templates follow `altera_*.j2` and `amd_*.j2` naming
3. Register new templates in `TemplateLoader` if needed
4. Validate with sample specs in `ipcraft-spec/examples/*`
5. Update the [Generator Reference](../reference/generator.md)

### Add an IP Core canvas feature

The IP Core editor has no sidebar/section-tabs mode — editing happens on the block-diagram canvas
plus its Inspector panel. See [IP Core Editor Reference](../reference/ip-core-editor.md).

1. Add a draggable entry to `src/webview/ipcore/components/canvas/LibraryPalette.tsx` if the feature
   introduces a new droppable primitive
2. Handle the drop/update in `useCanvasDrop.ts` (or the relevant `use*` hook under
   `ipcore/hooks/`)
3. Render the element on `IpBlockCanvas.tsx` and add its property editor to `CanvasInspector.tsx`
4. Update the [IP Core Editor Reference](../reference/ip-core-editor.md)

## Validation Flow

Run these before submitting a PR:

=== "CMake"
    ```bash
    cmake --build build --target validate
    ```
    Runs lint → type-check → unit tests → compile in sequence. Fails fast on the first error.

=== "npm"
    ```bash
    npm run lint
    npm run type-check
    npm run test:unit
    npm run compile
    ```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Custom editor does not appear | Verify file extension and `package.json` custom editor selector. Check provider registration in `src/extension.ts`. |
| Webview opens but no data | Ensure webview posts `{ type: 'ready' }`. Verify provider sends `type: 'update'`. Check `useMemoryMapState`. |
| YAML updates not persisted | Verify `sendUpdate` call path. Check `WebviewRouter.useStandardDocumentHandlers`'s `update` handler and `DocumentManager.updateDocument`. |
| Editor not updating | Check webview console + extension host logs. |
| Generator produces empty files | Verify IP Core has a bus interface with `memoryMapRef`. Check template context in `IpCoreScaffolder.buildTemplateContext`. |
| CMake configure fails (`Node.js < 20`) | Install Node.js 20+ from [nodejs.org](https://nodejs.org/). |
| Docs targets unavailable | Install Python 3, then re-run `cmake -B build`. Run `cmake --build build --target docs_install` first. |
