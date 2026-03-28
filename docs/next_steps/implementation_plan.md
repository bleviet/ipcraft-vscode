# Automated Testing Plan for ipcraft-vscode (Revised)

---

## What I Am Keeping

These parts of the original plan remain valid after re-evaluation:

- **Repository findings and coverage heat map.** All measurements were taken from the actual codebase. The architecture (two-process, postMessage, two webpack targets), existing test patterns (renderHook, RTL render, jest.mock), and coverage numbers are verified facts.
- **Phase 0: CI foundation.** Adding a test/lint/type-check workflow is prerequisite to everything else. No change.
- **Standalone Playwright harness over full VS Code E2E.** For a single-developer extension, the maintenance cost of Electron + iframe Playwright automation is not justified. The standalone harness covers the same React surface at a fraction of the cost. Keeping this.
- **Exclusion of full VS Code webview DOM automation.** Still excluded for the same reasons.
- **Generator pipeline as a high-value test target.** It produces user-facing VHDL. It has 0% coverage. Still a strong candidate, but moved to its own phase.

---

## What I Am Changing

| Original | Revised | Reason |
|----------|---------|--------|
| Phase 1 was a monolithic "close the gaps" phase with 8 new test suites mixing pure logic, providers, generators, and complex hooks | Split into 3 separate phases (1, 2, 3) ordered by effort/risk | Fast wins first; complex items later |
| Tiers were blurry -- "Integration Tests (Jest)" mixed provider, generator, and host behavior | 5 explicit tiers with clear boundaries | Each tier validates a distinct concern |
| `useBusInterfaceEditing` (467 LOC) was listed as a Phase 1 target alongside 15-line pure functions | Moved to deferred/conditional | It is a complex state machine; testing it in jsdom is expensive and brittle |
| `useMemoryMapState` and `useIpCoreState` were Phase 1 targets | Moved to conditional, attempted after shared components | They have medium complexity and depend on postMessage mocking that is better validated first in simpler contexts |
| Coverage thresholds were estimated target numbers | Thresholds are now set to measured baselines after each major phase | Prevents optimistic guessing |
| No extension-host smoke tests | Added Phase 4: lightweight `@vscode/test-electron` smoke tests (2-3 tests) | Catches activation, registration, and packaging failures that no Jest test can reach |
| Provider unit tests were planned | Removed from active plan | The mocking cost is high and the smoke tests cover the critical path (does it activate, does the file open). Provider internals are already tested through their constituent services. |
| Standalone harness boundaries were vague | Explicit "what it tests / what it does not test" section | Prevents false confidence |
| No failure artifact strategy for Playwright | Added explicit screenshot, trace, and report artifact plan | Required for debugging CI failures |

---

## Revised Testing Tiers

```
Tier 1  Pure Logic Tests (Jest)
        What it validates: functions with no React, no vscode API, no side effects
        Examples: FieldOperationService, fieldValidation, formatters, registerProcessor
        Environment: Jest, ts-jest, no jsdom features needed
        Mock surface: zero to minimal

Tier 2  React Unit Tests (Jest/jsdom + RTL)
        What it validates: React components and hooks in isolation
        Examples: FormField, SelectField, EditableTable, useFieldEditor
        Environment: Jest, jsdom, @testing-library/react
        Mock surface: child components via jest.mock, acquireVsCodeApi via setup.ts

Tier 3  Node-Side Logic Tests (Jest + expanded vscode mock)
        What it validates: generator pipeline, template loading, and other Node.js
        logic that runs in the extension host process but can be exercised outside
        VS Code with a mocked vscode namespace
        Examples: IpCoreScaffolder, TemplateLoader, registerProcessor
        Environment: Jest, Node target, expanded __mocks__/vscode.ts
        Mock surface: vscode namespace, filesystem for templates

Tier 4  Extension Smoke Tests (@vscode/test-electron)
        What it validates: extension activates, custom editors register,
        supported files open without crashing
        What it does NOT validate: webview DOM content, React rendering,
        user interactions inside webview
        Examples: activate extension, open .mm.yml, open .ip.yml
        Environment: real VS Code instance via @vscode/test-electron
        CI requirement: xvfb-run on Linux, VS Code binary download (~200MB, cacheable)

Tier 5  Webview Integration Tests (Playwright)
        What it validates: full React application behavior in a real browser --
        component rendering, navigation, pointer interactions, keyboard shortcuts
        What it does NOT validate:
          - VS Code CSP enforcement (the harness has no CSP)
          - webview.asWebviewUri() resource URI translation
          - retainContextWhenHidden behavior
          - extension activation lifecycle
          - multi-panel / multi-document scenarios
          - custom editor registration
        Examples: outline renders blocks, clicking block shows details, keyboard nav
        Environment: Playwright + Chromium, loading production webpack bundles
```

---

## Revised Phased Plan

### Phase 0: CI Foundation

**Goal**: Gate every PR on tests, lint, and type-check.

**Changes**:
- [NEW] `.github/workflows/ci.yml`
  - Triggers: push to `main`, pull requests
  - Steps: checkout (with submodules), Node 20 setup, `npm ci`, `npm run lint`, `npm run type-check`, `npm run test:unit -- --coverage`
  - Uploads `coverage/` as artifact

**Effort**: ~1 hour.
**Risk**: None.
**Verification**: Open a PR, confirm the workflow runs and reports status.

---

### Phase 1: Pure Logic Wins

**Goal**: Cover untested pure-logic modules with fast, zero-mock, high-confidence tests. This is the highest ROI work in the entire plan.

**Confirmed good candidates** (verified: no React, no vscode API, pure input/output):

| Module | LOC | Coverage | Why Fast |
|--------|-----|----------|----------|
| `FieldOperationService.ts` | 139 | 0% | Pure functions: insert, delete, move, resize field operations |
| `fieldValidation.ts` | 121 | 0% | Pure validation: name uniqueness, bit range overlap, reset value bounds |
| `formatters.ts` | 15 | 0% | Pure formatting: number/hex display |

**New test files**:
- `src/test/suite/services/FieldOperationService.test.ts`
- `src/test/suite/shared/fieldValidation.test.ts`
- `src/test/suite/shared/formatters.test.ts`

**Verification**:
- All new tests pass locally and in CI
- Run `jest --coverage` and record actual coverage delta
- Expect ~+20-30 tests

**After Phase 1**: Measure coverage. Record the new baseline. Raise `jest.config.js` thresholds to measured values minus 2% margin.

**Effort**: ~1 day.
**Risk**: Negligible. These are the safest tests to write in the entire codebase.

---

### Phase 2: Shared Form Components

**Goal**: Cover the 6 reusable form/table components that both editors depend on. These are small, leaf-level React components with clear props APIs and no complex internal state.

**Confirmed good candidates** (verified: simple render + event tests):

| Component | LOC | Notes |
|-----------|-----|-------|
| `FormField.tsx` | 89 | Conditional rendering based on `type` prop |
| `SelectField.tsx` | 75 | Dropdown change events |
| `NumberField.tsx` | 76 | Numeric input with validation callback |
| `CheckboxField.tsx` | 32 | Toggle behavior |
| `TextAreaField.tsx` | 67 | Multi-line input |
| `KeyboardShortcutsButton.tsx` | 290 | Dialog open/close, shortcut table rendering |

**New test files**:
- `src/test/suite/shared/FormField.test.tsx`
- `src/test/suite/shared/SelectField.test.tsx`
- `src/test/suite/shared/NumberField.test.tsx`
- `src/test/suite/shared/CheckboxField.test.tsx`
- `src/test/suite/shared/TextAreaField.test.tsx`
- `src/test/suite/shared/KeyboardShortcutsButton.test.tsx`

**Verification**:
- All render without crashing
- Event handlers fire correctly (onChange, onClick, onBlur)
- Expect ~+25-35 tests

**After Phase 2**: Measure coverage. Update thresholds to new measured baseline.

**Effort**: ~1.5 days.
**Risk**: Low. The existing `EditableTable.test.tsx` (71% coverage) proves the pattern works for this component family.

---

### Phase 3: Generator Pipeline

**Goal**: Cover the VHDL generation pipeline end-to-end within Jest. This is high-value because the generator produces user-facing output files.

**Targets**:

| Module | LOC | Notes |
|--------|-----|-------|
| `IpCoreScaffolder.ts` | ~300 | Orchestrates generation, reads YAML, invokes templates |
| `registerProcessor.ts` | ~200 | Transforms register data for templates |
| `TemplateLoader.ts` | ~80 | Loads Nunjucks templates from filesystem |

**New test files**:
- `src/test/suite/generator/IpCoreScaffolder.test.ts`
- `src/test/suite/generator/registerProcessor.test.ts`
- `src/test/suite/generator/TemplateLoader.test.ts`

**Supporting changes**:
- [NEW] `src/test/fixtures/sample-ipcore.yml` -- valid IP Core YAML with bus interface + memory map ref
- Scaffolder tests will use `path.resolve(__dirname, '..', '..', '..', 'generator', 'templates')` to locate real templates -- no mocking the filesystem for template content

**Known risk**: `IpCoreScaffolder` depends on `vscode.ExtensionContext` for template path resolution. Mitigation: the scaffolder already accepts a logger and template loader via constructor -- tests can construct a `TemplateLoader` with an explicit template directory, bypassing the context dependency.

**Verification**:
- Templates load and render without error
- Generated VHDL output matches expected patterns (substring assertions, not exact snapshot)
- Expect ~+15-25 tests

**After Phase 3**: Measure coverage. Update thresholds to new measured baseline. At this point, the three measurement windows (Phase 1, 2, 3) establish a reliable baseline for the final threshold lock-down.

**Effort**: ~2 days.
**Risk**: Medium. Filesystem dependency on templates requires careful path setup. If template path resolution proves fragile, fall back to integration-style tests that compile the full webpack extension bundle first.

---

### Phase 4: Extension Smoke Tests

**Goal**: Verify the extension activates, registers its custom editor providers, and opens supported files without crashing. This is a lightweight version of `@vscode/test-electron` -- not full E2E.

**Why include this**: No amount of Jest unit tests can verify that:
- The webpack-bundled `dist/extension.js` activates cleanly
- `customEditors` contribution points register correctly
- Opening a `.mm.yml` file triggers `MemoryMapEditorProvider.resolveCustomTextEditor`
- Opening a `.ip.yml` file triggers `IpCoreEditorProvider.resolveCustomTextEditor`
- The webview HTML loads without a blank panel

These are real failure modes (bad imports, missing templates in dist, wrong activation events) that have no other test path.

**New files**:
- [NEW] `src/test/e2e/runTests.ts` -- test launcher using `@vscode/test-electron`
- [NEW] `src/test/e2e/suite/index.ts` -- Mocha test runner bootstrap
- [NEW] `src/test/e2e/suite/activation.test.ts` -- 2-3 smoke tests
- [NEW] `src/test/e2e/fixtures/test.mm.yml` -- minimal memory map YAML
- [NEW] `src/test/e2e/fixtures/test.ip.yml` -- minimal IP core YAML

**Test cases** (exhaustive list -- this is deliberately small):
1. Extension activates without error (`vscode.extensions.getExtension('bleviet.ipcraft-vscode').activate()` resolves)
2. Opening a `.mm.yml` file uses the custom editor provider (assert the active editor's `viewType` is `fpgaMemoryMap.editor`, not the default text editor)
3. Opening a `.ip.yml` file uses the custom editor provider (assert `viewType` is `fpgaIpCore.editor`)

**Success criteria**: Each test verifies the provider resolution path is exercised. No webview DOM inspection. No assertion on rendered content inside the webview.

**Package changes**:
- [MODIFY] `package.json` -- add `"test:e2e": "node out/test/e2e/runTests.js"` script
- [MODIFY] `.github/workflows/ci.yml` -- add e2e step with `xvfb-run` wrapper

**Verification**: All 3 tests pass locally via `npm run test:e2e` and in CI.

**Effort**: ~1 day.
**Risk**: Medium. `@vscode/test-electron` requires downloading a VS Code binary. CI needs `xvfb-run` (Linux) or a display server. This is well-documented by the official VS Code testing docs and the dependency is already installed. The main risk is flakiness from VS Code startup timing -- mitigate with adequate timeouts and retry in CI.

---

### Phase 5: Standalone Webview Browser Tests

**Goal**: Test the full Memory Map and IP Core React applications in a real browser, exercising component rendering, interactions, keyboard navigation, and drag behaviors that jsdom cannot handle.

#### Harness Design

The harness loads the **exact same production webpack bundles** that VS Code loads. There is no separate build, no test-only entry point, no parallel app. The difference is only what sits on the other end of `postMessage`.

**Bundle path verification**: The webpack config uses `filename: "[name].js"` and `filename: "[name].css"` with fixed entry names `webview` and `ipcore`. The emitted files are: `dist/webview.js`, `dist/webview.css`, `dist/ipcore.js`, `dist/ipcore.css`. These filenames are stable and determined by the webpack entry config, not by content hashing. Implementation must verify these paths exist after `npm run compile` before the harness can load them. If the webpack config ever adds content hashing (`[name].[contenthash].js`), the harness HTML must be generated dynamically or switched to a glob pattern.

**How the real app works in VS Code:**
1. `HtmlGenerator.ts` produces `<div id="root">` + `<script src="dist/webview.js">`
2. VS Code provides `window.acquireVsCodeApi` natively
3. Extension host sends `{ type: 'update', text: yamlContent }` via `webview.postMessage()`
4. `useYamlSync` hook receives the message via `window.addEventListener('message', ...)`
5. React app parses the YAML and renders

**How the harness works:**
1. Harness HTML provides `<div id="root">` + injects a mock `acquireVsCodeApi` before loading `dist/webview.js`
2. The mock `acquireVsCodeApi` returns `{ postMessage: capturedFn, getState: () => null, setState: noop }`
3. Test injects data via `page.evaluate(() => window.postMessage({ type: 'update', text: yamlContent }, '*'))` -- the exact same message shape the extension host sends
4. `useYamlSync` receives it identically. The React app renders normally.
5. `capturedFn` captures outgoing messages for assertion (e.g., verify the app sends `{ type: 'update', text: modifiedYaml }` after an edit)

**What this does NOT create:**
- No test-only React entry point
- No test-only webpack config
- No mock services injected into React component tree
- No deviation from the production bootstrap path

The only test-specific code is the harness HTML and mock host script (~50 lines total).

#### Failure Artifact Strategy

- [CONFIGURE] `playwright.config.ts`:
  - `use.screenshot: 'only-on-failure'` -- automatic screenshot on test failure
  - `use.trace: 'retain-on-failure'` -- full trace archive (DOM snapshots, network, console) on failure
  - `reporter: [['html', { open: 'never' }], ['list']]` -- CI-friendly HTML report
- [MODIFY] `.github/workflows/ci.yml`:
  - Upload `e2e/test-results/` and `e2e/playwright-report/` as artifacts on failure
  - Use `if: failure()` condition on the upload step

#### New Files

- [NEW] `e2e/playwright.config.ts`
- [NEW] `e2e/harness/memory-map.html` -- `<div id="root">` + mock script + `<script src="../dist/webview.js">`
- [NEW] `e2e/harness/ip-core.html` -- `<div id="ipcore-root">` + mock script + `<script src="../dist/ipcore.js">`
- [NEW] `e2e/harness/mock-host.js` -- defines `window.acquireVsCodeApi`, provides `window.__mockHost.inject(yaml)` and `window.__mockHost.messages` for test assertions
- [NEW] `e2e/fixtures/sample-memmap.yml` -- reuse from `src/test/fixtures/`
- [NEW] `e2e/fixtures/sample-ipcore.yml` -- reuse from Phase 3 fixture
- [NEW] `e2e/tests/memory-map.spec.ts`
- [NEW] `e2e/tests/ip-core.spec.ts`

#### Initial Test Cases

**memory-map.spec.ts:**
1. Inject sample YAML -> outline renders with block and register nodes
2. Click a register node -> details panel shows register name and fields
3. Keyboard: arrow keys navigate the outline
4. Sidebar toggle button opens/closes the sidebar

**ip-core.spec.ts:**
1. Inject sample IP Core YAML -> navigation sidebar renders section list
2. Click "Metadata" -> VLNV fields render with correct values
3. Click "Bus Interfaces" -> bus interface card renders

**Package changes**:
- [MODIFY] `package.json` -- add `@playwright/test` to devDependencies, add `"test:browser": "npx playwright test"`, `"test:browser:ui": "npx playwright test --ui"`
- [MODIFY] `.gitignore` -- add `e2e/test-results/`, `e2e/playwright-report/`

**Verification**: `npm run compile && npm run test:browser` passes locally and in CI.

**Effort**: ~2-3 days (harness infrastructure + initial specs).
**Risk**: Medium. The harness approach is proven in other VS Code extensions (e.g., vscode-webview-ui-toolkit uses similar standalone testing). The main risk is CSS/font loading differences between the harness and real VS Code (codicons may not load without the extension host serving them). Mitigation: load codicons from the local project path (`node_modules/@vscode/codicons/dist/codicon.css` -- verified to exist) via Playwright's static file serving or a relative `<link>` in the harness HTML. This keeps the harness closer to production behavior than a CDN would. CDN fallback is acceptable only if local serving proves impractical.

---

## Deferred or Conditional Items

### Deferred: Attempt Only After Earlier Phases Succeed

| Item | Reason for Deferral | Likely Phase |
|------|---------------------|-------------|
| `useBusInterfaceEditing.ts` (467 LOC) | Complex state machine with many interaction modes. Unit testing it in jsdom will require heavy mocking and produce brittle tests. Better covered by Phase 5 browser tests clicking through the UI. If a unit test is still desired, attempt only after Phase 5 demonstrates coverage gaps. | Post-Phase 5 |
| `useMemoryMapState.ts` (~200 LOC) | Depends on YAML parsing + postMessage + state hydration. The interaction between these concerns is better validated by Phase 5 (inject YAML, observe render) than by renderHook with mocked everything. | Post-Phase 2 |
| `useIpCoreState.ts` (200 LOC) | Same reasoning as useMemoryMapState. | Post-Phase 2 |
| `IpCoreGenerateHandler.ts` (142 LOC) | Message routing between webview and scaffolder. Depends on Phase 3 generator tests being stable. Attempt after Phase 3. | Post-Phase 3 |
| Provider unit tests (`MemoryMapEditorProvider`, `IpCoreEditorProvider`) | High mocking cost (webviewPanel, webview, document, all VS Code event APIs). The critical behaviors (activates, opens file, shows webview) are validated by Phase 4 smoke tests. The internal wiring (message routing, document change subscription) is tested through their constituent services (MessageHandler, DocumentManager -- both at 100% coverage). Adding provider unit tests would largely re-test already-covered code through a more expensive mock setup. | Indefinitely deferred |

### Conditional: Depends on Feasibility

| Item | Condition |
|------|-----------|
| Drag interaction tests in Playwright (Shift+drag to resize, Ctrl+drag to reorder) | Attempt after basic Phase 5 specs are stable. Pointer event simulation in Playwright is reliable, but the interaction depends on precise coordinate math in `useShiftDrag` / `useCtrlDrag`. |
| Additional Playwright specs for IP Core editor sections (ClocksTable, ResetsTable, PortsTable) | Attempt if Phase 5 ip-core.spec.ts establishes the pattern cleanly. |
| Visual regression testing (screenshot comparison) | Not recommended for a single-developer project. The CSS is token-based and changes intentionally. False positives would dominate. |

---

## Final Recommendation

### Execution Order

```
Phase 0  CI Foundation             ~1 hour    prerequisite
Phase 1  Pure Logic Wins           ~1 day     highest ROI, lowest risk
Phase 2  Shared Form Components    ~1.5 days  low risk, builds on RTL patterns
Phase 3  Generator Pipeline        ~2 days    medium risk, high value
Phase 4  Extension Smoke Tests     ~1 day     medium risk, unique coverage
Phase 5  Standalone Browser Tests  ~2-3 days  medium risk, broad coverage
         Coverage threshold lock   per phase  measured baselines, not estimates
```

Total estimated effort: ~8-10 days of implementation spread over Phases 0-5.

### Extension Smoke Tests: Include

After re-evaluation, I recommend **including** the lightweight `@vscode/test-electron` smoke layer (Phase 4). The reasoning:

1. **`@vscode/test-electron` is already installed.** There is zero new dependency cost.
2. **It catches a unique class of bugs.** Activation failures, bad contribution points, missing bundled resources, webpack externals misconfiguration -- none of these are reachable from Jest.
3. **It is deliberately small.** 2-3 tests, not a full E2E suite. The scope is: does it activate, does a file open in a custom editor. Nothing more.
4. **The maintenance cost is near zero.** These tests will only break when the activation path or contribution points change, which happens rarely.
5. **CI cost is acceptable.** `xvfb-run`, VS Code binary download (cacheable), ~30s execution. Well within budget for a CI pipeline that already runs 209 Jest tests.

The alternative -- skipping it entirely -- would leave a gap where a broken webpack bundle or a misconfigured `package.json` contribution point could ship without any automated detection.

### What Success Looks Like After All Phases

| Metric | Before | After |
|--------|--------|-------|
| Test suites | 27 | ~45-50 |
| Test count | 209 | ~310-360 |
| Coverage (lines) | ~45% | ~58-65% (measured, not estimated) |
| CI pipeline | none | lint + typecheck + unit + e2e + browser |
| Untested tiers | extension activation, webview rendering, generator output | all covered at appropriate depth |
| Failure diagnostics | none | screenshots + traces for browser tests, coverage reports for unit tests |
