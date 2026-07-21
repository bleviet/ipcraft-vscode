# AGENTS.md

Compact orientation for OpenCode sessions. The canonical instruction file is
`CLAUDE.md` at the repo root — read it first; this file only adds what an
agent would otherwise miss or get wrong.

## Instruction sources, in order of authority

1. `.agents/rules/*.md` — project rules, treat as binding (no emojis in
   documentation, no auto add/commit/push, planning docs go in `docs/`, prove
   root cause with evidence before fixing, must pass `npm run lint` before
   commit). Meaningful emoji usage in UI code is allowed.
2. `CLAUDE.md` — architecture map and key conventions. Already loaded into the
   session via system prompt.
3. `docs/architecture/*.md` — deeper design notes; `bit-field-handling.md` is
   the reference for any change to bitfield reorder/repack logic.

## Commands you will get wrong by guessing

Jest, Playwright, webpack configs all live under `config/`, so default
discovery does not find them. Always pass `--config`:

```bash
# single unit test file or pattern (do NOT omit --config)
npx jest --config config/jest.config.js src/test/suite/services/YamlValidator.test.ts
npx jest --config config/jest.config.js -t "should parse valid YAML"

# integration suite (HDL / Vivado / Quartus) has its own config
npm run test:integration:hdl       # = jest --config config/jest.integration.js --testPathPatterns=hdl
npm run test:integration:vivado
npm run test:integration:quartus
```

Three separate Jest setups exist: unit (`config/jest.config.js`, jsdom),
integration (`config/jest.integration.js`, node, 180 s timeout, real `fs`
via `src/test/integration/setup.ts`), and there is no Jest for browser tests
— those are Playwright (`config/playwright.config.ts`, `npm run test:browser`).

`npm run pretest` runs `scripts/check-submodule.js` and will fail if the
`ipcraft-spec` submodule is missing. After a fresh clone:
`git submodule update --init --recursive`.

`npm run test:unit:coverage` enforces explicit coverage thresholds in
`config/jest.config.js` (statements/lines ~25%, branches ~18%, functions
~19%). Removing covered code can break CI even when all tests pass.

## Stale claims to ignore

- **Path aliases (`@/`, `@webview/`, `@services/`, `@utils/`) do NOT work in
  source code.** They exist only in `config/jest.config.js` and
  `config/jest.integration.js` `moduleNameMapper`. `tsconfig.json` defines no
  `paths`; `config/webpack.config.js` defines no `resolve.alias`. Source uses
  relative imports only. Parts of the
  README imply aliases are global — they are not. Do not add `from '@/...'`
  to non-test source.

## Repo wiring an agent should not relearn

- **Two webpack bundles, separate JS environments**: `extension` (Node, entry
  `src/extension.ts`) and `webview` (browser, two entries — `src/webview/index.tsx`
  for memory map, `src/webview/ipcore/IpCoreApp.tsx` for IP core). They
  communicate only via VS Code `postMessage` through `src/services/WebviewRouter.ts`
  and `src/webview/sync/revisionFilter.ts`. Change one only with the other.
- **Domain layer** (`src/domain/`) is the canonical normalized type layer
  crossing the process boundary. `parse.ts` adds UI-only `rowId`;
  `serialize.ts` strips `rowId` and `__kind` before write-back.
  `src/webview/utils/rowIdentity.ts` `reconcileRowIds` preserves rowIds across
  reparses so React rows stay stable.
- **Format-preserving writes** go through `src/yamledit/` (`yaml` v2
  `parseDocument`), never through `js-yaml`. `js-yaml` is read-only / simple
  dump only. Using `js-yaml` to write back will strip comments and corrupt
  hex spellings.
- **Generator templates** are Nunjucks `.j2` files in
  `src/generator/templates/`, copied to `dist/templates/` by
  `CopyWebpackPlugin` at build time. Editing `dist/templates/*` is wasted
  work. Same for `src/generator/packs/` -> `dist/packs/` and
  `ipcraft-spec/bus_definitions` and `ipcraft-spec/schemas/` ->
  `dist/resources/`.
- **`src/webview/types/ipCore.d.ts` and `memoryMap.d.ts` are auto-generated**
  from `ipcraft-spec/schemas/*.schema.json` by `npm run generate-types`. Do
  not hand-edit; `editor.d.ts`, `registerModel.ts`, `selection.d.ts` are
  hand-written.

## Test/mock conventions worth knowing

- `vscode` module is mocked via `__mocks__/vscode.ts`; both Jest configs map
  `^vscode$` to it. Do not re-mock per file — extend the existing mock if
  needed (see `src/test/integration/setup.ts` for how integration tests bolt
  a real-fs `workspace.fs` onto it).
- Browser tests inject YAML via `window.__RENDER__` registered by
  `src/webview/index.tsx`. There is no VS Code process running.
- Pre-commit hook (`.husky/pre-commit`) runs `lint-staged` which runs
  `eslint --fix` + `prettier --write` on `*.{ts,tsx}`. ESLint policy is
  `--max-warnings 0` (see `eslint.config.js`); a single warning fails CI.

## Table editors — three parallel editors, one architecture

The Memory Map webview has **three parallel table editors** that must be kept in sync whenever insert/delete/navigation logic changes:

| Editor component | Hook | Rows edited |
|---|---|---|
| `BlockEditor` | `useTableEditorState` | registers in a block |
| `MemoryMapEditor` | `useTableEditorState` | address blocks |
| `useFieldEditor` | `useTableEditorState` (via internal `editorState`) | bit fields in a register |

`RegisterArrayEditor` follows the same conventions for its nested registers table.

**Critical: keyboard insert vs. mouse insert use different refs.**

- Keyboard (`o`/`O`/`Shift+A`/`Shift+I`): use `pendingSelectRef` — `useEffect` calls only `editor.selectRow`. Never call `editor.focusCellEditor` here; it moves DOM focus into the input, sets `isTypingTarget = true`, and silently swallows all subsequent `o` keypresses.
- Mouse (hover-bar, context menu): use `pendingInsertFocusRef` — `useEffect` calls `editor.selectRow` AND `editor.focusCellEditor` so the user can type the new name immediately.

Both refs are resolved in the same `useEffect([wrappedRows, editor])`.

## Style / convention hard rules (project-specific)

- camelCase only in TS/React/JSON Schema property names. No snake_case fields
  and no dual-state fallbacks (`param.uiGroup ?? param.ui_group` is
  forbidden). snake_case is reserved for variables inside Nunjucks templates.
- Extension-side logging uses `new Logger('ComponentName')` from
  `src/utils/Logger.ts`. `console.log` triggers the `no-console` ESLint rule
  (only `warn`/`error` are allowed, and only in webview error paths).
- Do not use emojis in documentation. Meaningful emoji usage in UI code is
  allowed; avoid decorative UI usage that adds no information.
- Never auto-commit. Run lint/type-check/test and let the developer review.
- Run compile after code generation to ensure the generated code is correct. Fix errors and regenerate if needed.
