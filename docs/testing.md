# Testing Guide

## Purpose

IPCraft VS Code is a complex extension: it runs code on two separate processes simultaneously — the **extension host** (Node.js) and the **webview** (a browser-like environment running React). Ordinary Jest unit tests cannot reach both worlds at once, and no single test runner covers the full stack. This guide explains why the repo uses multiple test layers, what each one does, and how to work with them day-to-day.

---

## Test architecture

The repo has **five testing tiers**. Each tier covers a different process boundary or concern. Using the right tier for the right problem keeps tests fast, reliable, and easy to maintain.

| # | Tier | Runner | What it tests |
|---|------|--------|---------------|
| 1 | Pure logic | Jest | Pure TypeScript functions: no DOM, no VS Code, no React |
| 2 | React unit | Jest + jsdom + React Testing Library | React components and hooks rendered in a simulated browser |
| 3 | Node-side logic | Jest + vscode mock | Extension-host services that call VS Code APIs |
| 4 | VS Code smoke tests | `@vscode/test-electron` (Mocha) | Real VS Code: extension activation, file opening, provider resolution |
| 5 | Browser / webview | Playwright | Real compiled React bundles loaded in a browser, end-to-end UI interactions |

**Why so many tiers?**

- Jest tiers (1–3) are cheap and fast — they run in seconds. They validate logic that does not depend on a real browser or a real VS Code binary.
- The VS Code smoke tests (tier 4) spin up a real VS Code binary to answer questions that cannot be faked: does the custom editor provider actually respond when a `.mm.yml` file is opened?
- The Playwright tests (tier 5) load the real compiled webpack bundles in a real browser to validate that the React UI behaves correctly when the extension host sends YAML data. These tests verify integration across the `postMessage` boundary.

---

## Repository layout

```
src/
  test/
    setup.ts                  # Jest global setup: jest-dom matchers, acquireVsCodeApi mock, VS Code UI toolkit mock
    fixtures/                 # Shared YAML fixtures for Jest tests
      sample-memmap.yml       #   Memory map test data
      sample-ipcore.yml       #   IP Core test data
      invalid-syntax.yml      #   Invalid YAML for error-path tests
    suite/                    # All Jest test files (tiers 1–3)
      algorithms/             #   Repacking algorithm tests
      components/             #   React component tests (Memory Map)
      generator/              #   Generator pipeline tests (IpCoreScaffolder, TemplateLoader, registerProcessor)
      hooks/                  #   React hook tests
      parser/                 #   VHDL parser tests
      services/               #   Extension-host and webview service tests
      shared/                 #   Shared form component tests (FormField, SelectField, etc.)
      utils/                  #   Utility function tests
    e2e/                      # VS Code smoke tests (tier 4) — NOT run by Jest
      runTests.ts             #   Launches @vscode/test-electron; compiled to out/test/e2e/runTests.js
      fixtures/               #   Fixture files opened inside real VS Code
        test.mm.yml           #     Memory map fixture for provider resolution test
        test.ip.yml           #     IP Core fixture for provider resolution test
      suite/
        index.ts              #   Mocha runner entry point (not Jest)
        activation.test.ts    #   5 smoke tests: extension present, activates, registers editors, opens .mm.yml, opens .ip.yml
    browser/                  # Playwright browser tests (tier 5) — NOT run by Jest
      index.html              #   Memory Map webview harness (loads dist/webview.js)
      ipcore.html             #   IP Core webview harness (loads dist/ipcore.js)
      integration.test.ts    #   3 Playwright tests: 1 memory-map + 2 IP Core

__mocks__/
  vscode.ts                   # Sparse VS Code API mock used by Jest (tiers 1–3)
```

---

## Commands

### Jest (tiers 1–3)

| Command | What it does |
|---------|-------------|
| `npm run test:unit` | Run all Jest tests once |
| `npm run test:unit:watch` | Re-run affected tests on file save (development loop) |
| `npm run test:unit:coverage` | Run tests and produce a coverage report in `coverage/` |
| `npm run test:unit -- src/test/suite/services/YamlService.test.ts` | Run a single test file |
| `npm run test:unit -- --testNamePattern="adds a field"` | Run tests whose name matches a pattern |

### VS Code smoke tests (tier 4)

```bash
npm run compile          # Required first: compiles the extension bundle (dist/)
npm run compile-tests    # Required first: compiles TypeScript to out/ (the Mocha runner reads out/)
npm run test:e2e         # Downloads VS Code 1.85.0 (first run only) and runs the smoke tests
```

> **Note:** `test:e2e` requires a display server on Linux. CI wraps it with `xvfb-run -a`. If running locally on a headless machine, prefix with `xvfb-run -a`.

### Playwright browser tests (tier 5)

```bash
npm run compile          # Required first: the harnesses load dist/webview.js and dist/ipcore.js
npx playwright install --with-deps chromium   # Required first: installs the Chromium browser (once)
npm run test:browser     # Run all Playwright tests
npm run test:browser -- --headed             # Run with a visible browser window
npm run test:browser -- integration.test.ts  # Run a single test file
npm run test:browser -- --debug              # Open Playwright Inspector
```

### Run everything

```bash
npm run test:all         # Runs test:unit, then test:e2e, then test:browser
```

### Other useful commands

| Command | What it does |
|---------|-------------|
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run type-check` | TypeScript type check without building |
| `npm run compile` | Dev build (webpack: extension + webview bundles) |
| `npm run compile-tests` | Compile TypeScript test files to `out/` for test:e2e |

---

## Typical workflows

### "I changed a pure function (algorithm, service, utility)"

```bash
npm run test:unit -- --testPathPattern=<path-to-test>
```

Pure functions are tested in tiers 1–3. No build step needed for Jest. Run the relevant test file directly and iterate.

### "I changed a React component"

```bash
npm run test:unit -- --testPathPattern=src/test/suite/components
```

Component tests live in `src/test/suite/components/` and `src/test/suite/shared/`. They use React Testing Library (jsdom). No browser build needed.

### "I changed the extension host (providers, generator, services)"

```bash
npm run type-check       # Catch type errors first
npm run test:unit        # Run Jest tier 3 tests (node-side logic)
npm run compile-tests && npm run test:e2e  # Confirm provider wiring is still correct
```

### "I changed the React webview (Memory Map or IP Core UI)"

```bash
npm run compile          # Rebuild the webpack bundles
npm run test:browser     # Run Playwright tests against the fresh bundles
```

### "I changed generator templates or the scaffolding pipeline"

```bash
npm run test:unit -- --testPathPattern=src/test/suite/generator
```

Template loading and register processing tests live in `src/test/suite/generator/`.

### "Before opening a PR"

Run the full pre-PR checklist — see the [Contributor checklist](#contributor-checklist) at the end of this document.

---

## Writing new tests

### Which tier should I use?

Use the tier that corresponds to the boundary you need to test:

| I want to test... | Use |
|-------------------|-----|
| A pure function (input → output, no I/O) | Jest, tier 1 |
| A React component or hook | Jest + RTL, tier 2 |
| A service that calls VS Code APIs | Jest + vscode mock, tier 3 |
| Whether the extension activates or a file opens the right editor | @vscode/test-electron, tier 4 |
| Whether the React webview UI responds correctly to YAML data | Playwright, tier 5 |

### Adding a Jest test (tiers 1–3)

1. Create a file in the appropriate sub-directory under `src/test/suite/`.
2. Use `describe()` / `it()` or `describe()` / `test()`.
3. For React components, use `@testing-library/react`. The `render`, `screen`, `fireEvent`, and `userEvent` utilities are available without any setup.
4. For tests that call VS Code APIs (e.g., `vscode.workspace.applyEdit`), import from `'vscode'` — Jest will automatically use `__mocks__/vscode.ts` as the mock.
5. If you use a VS Code API that is not yet in `__mocks__/vscode.ts`, add it to that file first.

```typescript
// src/test/suite/services/MyService.test.ts
import { doSomething } from '../../../webview/services/MyService';

describe('MyService', () => {
  it('returns expected result', () => {
    expect(doSomething('input')).toBe('expected output');
  });
});
```

### Adding a VS Code smoke test (tier 4)

1. Add a `test()` block to `src/test/e2e/suite/activation.test.ts` (or a new file in that folder).
2. Use Mocha syntax: `suite()` / `test()` — **not** `describe()` / `it()`.
3. Import from `'vscode'` to access the real VS Code API.
4. For file-opening tests, place fixture files in `src/test/e2e/fixtures/`.
5. Always call `workbench.action.closeAllEditors` before and after file-opening tests to avoid state leaking between tests.
6. Compile before running: `npm run compile-tests && npm run test:e2e`.

```typescript
// Mocha syntax — NOT Jest
test('My smoke test', async () => {
  const ext = vscode.extensions.getExtension('bleviet.ipcraft-vscode');
  await ext?.activate();
  assert.strictEqual(ext?.isActive, true);
});
```

### Adding a Playwright browser test (tier 5)

1. Add a `test()` block to `src/test/browser/integration.test.ts`.
2. Use the appropriate harness: `index.html` for the Memory Map app, `ipcore.html` for the IP Core app.
3. Inject data by sending a `postMessage` with `{ type: 'update', text: yaml }`.
4. Wait for the ready signal (a console log containing `VSCODE_MESSAGE:` and `"ready"`) before injecting data.
5. Compile bundles first: `npm run compile`.

```typescript
test('My webview test', async ({ page }) => {
  const readyPromise = page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
    timeout: 10000,
  });
  await page.goto(`file://${path.resolve(__dirname, 'index.html')}`);
  await readyPromise;

  await page.evaluate((yaml) => {
    window.postMessage({ type: 'update', text: yaml }, '*');
  }, myYaml);

  await expect(page.locator('h2')).toBeVisible();
});
```

---

## Fixtures and test data

### Jest fixtures (`src/test/fixtures/`)

Three YAML files used directly in Jest tests:

| File | Purpose |
|------|---------|
| `sample-memmap.yml` | A valid memory map with registers, fields, and address blocks |
| `sample-ipcore.yml` | A valid IP Core with bus interfaces and memory map reference |
| `invalid-syntax.yml` | Deliberately malformed YAML for testing error paths |

Load them in tests with `fs.readFileSync` or `path.resolve(__dirname, ...)`.

### Smoke test fixtures (`src/test/e2e/fixtures/`)

Two YAML files that VS Code opens during tier 4 smoke tests:

| File | Purpose |
|------|---------|
| `test.mm.yml` | A minimal memory map file; opened to verify the Memory Map custom editor resolves |
| `test.ip.yml` | A minimal IP Core file; opened to verify the IP Core custom editor resolves |

These must be valid enough for the extension to accept them without crashing. Do not delete them; the smoke tests depend on their paths.

### Browser test harnesses (`src/test/browser/`)

Two HTML files that serve as standalone browser hosts for the compiled React bundles:

| File | Bundle loaded | Root element |
|------|---------------|--------------|
| `index.html` | `dist/webview.js` + `dist/webview.css` | `#root` |
| `ipcore.html` | `dist/ipcore.js` + `dist/ipcore.css` | `#ipcore-root` |

Each harness:
- Defines `window.acquireVsCodeApi()` before loading the bundle (the React app calls this during startup).
- Logs all outbound messages from the webview as `VSCODE_MESSAGE: ...` in the browser console so Playwright can intercept them.
- Stores the last outbound message in `window.__last_message` for assertion.

The harnesses load files from `dist/` using relative paths. **If you move or rename these files, update the relative paths in both harnesses.**

---

## Debugging failures

### Jest test failure

1. Run the failing file in isolation:
   ```bash
   npm run test:unit -- src/test/suite/services/MyService.test.ts
   ```
2. Add `--verbose` for per-test output.
3. To debug interactively, add `debugger` to your test and run:
   ```bash
   node --inspect-brk node_modules/.bin/jest --runInBand src/test/suite/services/MyService.test.ts
   ```
   Then attach your debugger (VS Code: use the "Attach to Node" debug config).
4. If a mock is not working, check `__mocks__/vscode.ts`. Only the methods listed there are mocked. If your test calls a VS Code API not in that file, you will get `undefined` or a crash.

### Playwright test failure

1. Run with a visible browser to watch what happens:
   ```bash
   npm run test:browser -- --headed
   ```
2. Open Playwright Inspector for step-by-step debugging:
   ```bash
   npm run test:browser -- --debug
   ```
3. On failure in CI, the HTML report and screenshots are uploaded as the `browser-test-results` artifact. Download it and open `playwright-report/index.html` locally.
4. If the page appears empty or "Loading..." never disappears, check that you ran `npm run compile` first. The harness loads `dist/webview.js` — if that file is missing or stale, the app will not mount.
5. Check the browser console output in your terminal. The test setup logs every console message from the page. Error messages from the React bundle appear there.

### VS Code smoke test failure

1. Smoke tests print output to the terminal. Look for lines starting with `FAIL` or `Error:`.
2. If `test:e2e` fails with "Failed to run tests" immediately, check that you compiled:
   ```bash
   npm run compile && npm run compile-tests
   npm run test:e2e
   ```
3. If a file-opening test fails: ensure the fixture files in `src/test/e2e/fixtures/` exist and are valid YAML. The tests wait 3 seconds for the custom editor to resolve — if VS Code is slow, the timing may need adjustment.
4. On Linux without a display server, prefix with `xvfb-run -a`:
   ```bash
   xvfb-run -a npm run test:e2e
   ```

### TypeScript errors

Run `npm run type-check` first. Jest uses `ts-jest` which can show slightly different error messages than `tsc`. If only `ts-jest` reports an error, check whether the issue is in a test file only.

---

## Common pitfalls

### `resetMocks: true` clears mock implementations between tests

`jest.config.js` sets both `clearMocks: true` and `resetMocks: true`. This means Jest resets mock implementations (not just call history) between every test. If you configure a mock inside a `beforeAll()` or at the top level of a `describe()`, and then reset it in a `beforeEach()` — or if Jest resets it automatically between describe-level setup and test execution — the mock will have no implementation when the test runs.

**Rule:** Set up mock implementations (`.mockReturnValue`, `.mockResolvedValue`, etc.) in `beforeEach()`, not `beforeAll()` or at describe scope.

```typescript
// BAD — implementation is reset before the test runs
beforeAll(() => {
  mockService.loadData.mockResolvedValue(data);
});

// GOOD — re-applied before each test
beforeEach(() => {
  mockService.loadData.mockResolvedValue(data);
});
```

### The `vscode` mock does not cover all VS Code APIs

`__mocks__/vscode.ts` is intentionally sparse. It only mocks what the current code uses. If you add a test for code that calls a VS Code API not in that file (e.g., `vscode.env.openExternal`), Jest will not find it and your test will throw.

**Fix:** Add the missing API to `__mocks__/vscode.ts` before writing the test.

### Browser tests require compiled bundles

The Playwright harnesses load `dist/webview.js` and `dist/ipcore.js` from the local filesystem. If you have not compiled the extension, or if your changes are newer than the last build, the tests will run against stale code.

**Always run `npm run compile` before `npm run test:browser`.**

### Smoke tests require compiled TypeScript in `out/`

`npm run test:e2e` runs `out/test/e2e/runTests.js` — the compiled version of `src/test/e2e/runTests.ts`. If you change test files and run `test:e2e` without recompiling, it will run the old compiled version.

**Always run `npm run compile-tests` before `npm run test:e2e`.**

### Smoke tests use Mocha syntax, not Jest syntax

All files under `src/test/e2e/` use Mocha's `suite()` and `test()` functions — **not** Jest's `describe()` and `it()`. Do not mix them. Jest does not run these files (they are excluded in `testPathIgnorePatterns`), but Mocha inside the VS Code test host does.

### Playwright browser tests are also excluded from Jest

`src/test/browser/` is also excluded from Jest's `testPathIgnorePatterns`. These files use Playwright's `test` and `expect` imports, which are incompatible with Jest. Do not attempt to run them with `npm run test:unit`.

### The IP Core harness uses `#ipcore-root`, not `#root`

The Memory Map app mounts at `#root`. The IP Core app mounts at `#ipcore-root`. When writing Playwright tests for the IP Core webview, wait for `#ipcore-root` to appear, not `#root`.

### CSS modules are proxied in Jest

`jest.config.js` maps `*.css` imports to `identity-obj-proxy`. This means `styles.myClass` returns `"myClass"` as a string rather than failing. You cannot assert on CSS class names in Jest component tests — this is intentional.

---

## CI overview

CI runs on every push to `main` and every pull request targeting `main`. The workflow is in `.github/workflows/ci.yml`.

Steps in order:

| Step | Command | What it does |
|------|---------|-------------|
| Install | `npm ci` | Install exact versions from `package-lock.json` |
| Lint | `npm run lint` | ESLint (zero warnings) |
| Type check | `npm run type-check` | TypeScript check |
| Build | `npm run compile && npm run compile-tests` | Webpack bundles + compiled test runner |
| Unit tests | `npm run test:unit -- --coverage` | Jest tests + coverage report |
| Smoke tests | `xvfb-run -a npm run test:e2e` | VS Code smoke tests on virtual display |
| Install browsers | `npx playwright install --with-deps chromium` | Download Chromium for Playwright |
| Browser tests | `npm run test:browser` | Playwright tests |
| Upload coverage | `actions/upload-artifact` (always) | `coverage/` retained 14 days |
| Upload browser failures | `actions/upload-artifact` (on failure only) | `test-results/` + `playwright-report/` retained 7 days |

**Coverage thresholds** are enforced by Jest. The CI unit-test step will fail if any threshold is breached:

| Metric | Threshold |
|--------|-----------|
| Statements | 25% |
| Branches | 18% |
| Functions | 19% |
| Lines | 25% |

These are intentionally modest — most of the React webview code is not reachable by Jest tests (it runs in a browser, not Node.js). The Playwright tests cover that code instead.

**Browser failure artifacts:** If the Playwright step fails in CI, screenshots and traces are automatically uploaded as the `browser-test-results` artifact. Download it and open `playwright-report/index.html` to see which test failed and why.

---

## Contributor checklist

Run these before opening a pull request:

```bash
# Static checks
npm run lint
npm run type-check

# Unit + node-side tests (fast, run first)
npm run test:unit

# Build everything
npm run compile
npm run compile-tests

# VS Code smoke tests (slower, needs virtual display on Linux)
xvfb-run -a npm run test:e2e   # Linux
npm run test:e2e               # macOS/Windows

# Browser tests
npm run test:browser
```

If your change only touches pure TypeScript logic or React components, `npm run lint && npm run type-check && npm run test:unit` is the minimum viable check. If you touched extension-host code (providers, generators, services), also run the smoke tests. If you touched the webview React code, also run the browser tests.

Also check:

- [ ] New logic has a test in the appropriate `src/test/suite/` sub-directory
- [ ] No new `any` types introduced without a justifying comment
- [ ] Fixtures in `src/test/fixtures/` or `src/test/e2e/fixtures/` are updated if the YAML schema changed
- [ ] `__mocks__/vscode.ts` is updated if new VS Code APIs are called from tested code
- [ ] `docs/` is updated if you changed a user-visible behavior or workflow
