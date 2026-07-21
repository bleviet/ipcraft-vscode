# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

IPCraft is a VS Code extension providing visual editors for FPGA IP Core (`.ip.yml`) and Memory Map (`.mm.yml`) YAML specs, plus HDL code generation (VHDL/SystemVerilog), vendor project scaffolding (Vivado/Quartus), headless builds, and importers (VHDL, Platform Designer `_hw.tcl`, Vivado `component.xml`).

## Commands

```bash
npm run compile        # Build extension + webview bundles (webpack, config/webpack.config.js)
npm run watch          # Webpack watch mode (F5 in VS Code launches an Extension Development Host)
npm run lint           # ESLint — zero warnings allowed (eslint src --max-warnings 0)
npm run lint:fix       # Auto-fix
npm run format         # Prettier over src/**/*.{ts,tsx}
npm run type-check     # tsc --noEmit
npm run generate-types # Regenerate src/domain/*.types.ts from ipcraft-spec JSON schemas

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

### Table editors — shared patterns

The Memory Map editor contains **three parallel table editors** that share the same architecture. Any change to the insert/delete/navigation pattern must be applied to all three:

| Editor | File | Rows | Table row component |
|---|---|---|---|
| `BlockEditor` | `src/webview/components/memorymap/BlockEditor.tsx` | registers in an address block | `RegisterTableRow` |
| `MemoryMapEditor` | `src/webview/components/memorymap/MemoryMapEditor.tsx` | address blocks | `BlockTableRow` |
| `useFieldEditor` | `src/webview/hooks/useFieldEditor.ts` | bit fields in a register | `FieldTableRow` (via `FieldsTable`) |

`RegisterArrayEditor` (`src/webview/components/memorymap/RegisterArrayEditor.tsx`) also uses `RegisterTableRow` for nested registers inside a register array and follows the same conventions.

Every keyboard-navigable table is built on **`useTableEditorState`** (`src/webview/hooks/useTableEditorState.ts`), which composes three lower-level hooks:

- `useTableNavigation` — arrow/Vim navigation, Alt+Arrow move, `o`/`O` insert, `e`/F2 edit
- `useCellEditGuard` — snapshot/revert and cancel-edit ref
- `useHoverInsertBar` — hover-based gap insert bar

All three receive `rows: TableRowWrapper<T>[]` (reconciled wrapped rows with stable `rowId`) rather than raw model arrays.

**Post-insert focus — keyboard vs. mouse** — after `onUpdate([...], newItems)` the new row does not yet exist in `wrappedRows`. The pattern depends on what triggered the insert:

- **Keyboard-triggered inserts** (`o`, `O`, `Shift+A`, `Shift+I` via `useTableNavigation` or a `window.addEventListener('keydown')` handler): set `pendingSelectRef.current = { name, key }` before the update. In a `useEffect` watching `wrappedRows`, find the new row by name and call **only** `editor.selectRow(index, key)`. Do NOT call `editor.focusCellEditor` — that moves DOM focus into the input and makes `isTypingTarget` true, which blocks `useTableNavigation` from seeing the next `o` keypress.

- **Mouse-triggered inserts** (hover-bar insert button, context menu): set `pendingInsertFocusRef.current = { name, key }` before the update. In the same `useEffect`, call `editor.selectRow(index, key)` **and** `editor.focusCellEditor(rowId, key)` so the user can type the new name immediately.

Both refs are checked in the same `useEffect([wrappedRows, editor])`. Never use `window.setTimeout(() => editor.selectRow(newIdx))` for post-insert focus — the row may not be rendered yet.

**Move (`onMove`) selection rule** — `useTableNavigation` calls `onMove(rowId, delta)` and immediately sets `activeCell` to the moved row's stable `rowId`. The `onMove` callback must only perform the array swap and `onUpdate`; it must **not** call `editor.selectRow` in a `setTimeout`. Selection follows the moved item via its `rowId` after `reconcileRowIds` re-matches it in the new position.


### Drag-to-reorder — separate UIs, one ordering invariant

Reordering by dragging exists in four independent surfaces, each with its own drag-state hook and commit, but they all agree on the same destination math:

| Surface | Drag state | Commit |
|---|---|---|
| Bit-field table (`FieldsTable`/`FieldTableRow`) | `useFieldEditor` | `['__op', 'field-move']` step ops |
| Outline tree (`src/webview/components/outline/`) | `useOutlineDragReorder` → `OutlineReorder` (`block` \| `register` \| `arrayRegister`) | `handleReorder` in `src/webview/index.tsx` |
| Memory Map block/register tables | `useTableEditorState` `onMove` | `onUpdate` array swap |
| Register map visualizer (`RegisterMapVisualizer.tsx`) | Ctrl/handle drag of register cards | `onReorderRegisters` |

`src/webview/utils/reorderPreview.ts` `computeReorderPreview(length, fromIdx, toIdx, after)` is the **single source of truth for where a dragged item lands** (insert-after, then decrement when moving downward). Its index math must stay identical to every commit path above. The **live-reorder preview** reflows the rendered list through this helper *during* the drag while keeping each row's real index; two conventions go with it — the dragged row gets `pointer-events: none` (so the reflowed list can't slide it under the cursor and flip the drop target) and an `inset 0 0 0 2px var(--vscode-focusBorder)` ring (theme-aware, defined for dark and light) marks the item being moved.

### The Memory Map webview commit hub

`src/webview/index.tsx` is where Memory Map structural gestures become document writes. `handleReorder` and `handleUpdateWithRepack` turn one gesture into **exactly one document update**: structural splice → `recomputeRegisterLayout` (offset repack) → `serializeValue` (schema sanitize) → `YamlService.applyPathEdits`. Never split a structural edit into multiple `sendUpdate` calls — a second update can race the first in the extension host and corrupt the file (this is why the repack and the edit are fused into a single pass).

### Layout computation

`src/webview/algorithms/LayoutEngine.ts` is the canonical pure-function module for bit-field layout:

- `recomputeBitfieldLayout(fields, regWidth)` — contiguous pack from bit 0 (no gaps); used for structural operations (insert/delete).
- `reorderBitfieldLayout(fields, movedIdx, direction, regWidth)` — gap-preserving swap; used for field-move from the table editor.

When adding register- or block-level layout operations, extend `LayoutEngine.ts`. Do not add layout math inside components or hooks.

### Code generation

`src/generator/` uses **Nunjucks** (`.j2`) templates in `src/generator/templates/`, copied to `dist/templates/` at build time by `CopyWebpackPlugin`. Edit templates there, never in `dist/`. With `trimBlocks: true`, the newline after any closing `%}` is consumed — use `{% set var = value %}` for inline conditionals to avoid stray newlines in rendered HDL.

### Schema source of truth

`ipcraft-spec/schemas/*.schema.json` define `.ip.yml` / `.mm.yml` structure. `npm run generate-types` regenerates `src/domain/*.types.ts` and `src/generator/contract/templateContext.types.ts` from them — do not hand-edit those. `src/webview/types/ipCore.d.ts` / `memoryMap.d.ts` are an older, still widely-imported pair of type files from an earlier architecture that the generator script no longer touches; when a schema field changes, update these by hand alongside `src/domain/*.types.ts`. Bus definitions and schemas are copied into `dist/resources/` at build time.

## Key conventions

- **Two YAML libraries, used deliberately:** `js-yaml` (v4) for read-only parse / simple dump; `yaml` (v2) for any modify-and-write-back path (preserves comments + hex literals). Never use `js-yaml` to write back.
- **Strict camelCase, no dual-state fallbacks.** TypeScript/React/JSON-Schema properties are camelCase only (`allowedValues`, `uiGroup`, `dataType`). Never read or define snake_case in these domains, and never write fallback logic like `param.uiGroup ?? param.ui_group`. snake_case is reserved exclusively for variables inside Nunjucks/Jinja2 template contexts.
- **`__op` special operations:** `useYamlUpdateHandler` recognises paths starting with `['__op', ...]` as structured operations that bypass normal path-edit logic. `['__op', 'field-move']` is the only current case; it routes through `FieldOperationService.applyFieldOperation` then `reorderBitfieldLayout`. Add new `__op` variants in `useYamlUpdateHandler.ts` when an edit cannot be expressed as a single path/value write (e.g. a multi-field atomic update).
- **Logging:** extension side uses `new Logger('ComponentName')` (`src/utils/Logger.ts`), never `console.log`. Webview may use `console.warn`/`console.error` for error paths.
- **Styling:** Tailwind v3 utility classes in JSX; theme-aware colors via `var(--vscode-*)` (helpers in `src/webview/shared/colors.ts`).
- **`vscode` is mocked** via `__mocks__/vscode.ts` (jest maps `^vscode$` to it); use the mock's stubs, don't re-mock per file.
- **Docs screenshots: light theme only.** `docs/` markdown embeds only the `-light.png` variant of each generated screenshot (see `docs/concepts/docs-screenshots.md`), unsuffixed — no `#only-dark`/`#only-light` pair. Docs get printed, and dark screenshots read poorly on paper. `scripts/docs-screenshots/` still captures both themes; just don't reference the `-dark.png` files from markdown.

### Tests

- Unit: `src/test/suite/**/*.test.ts(x)` (Jest, jsdom). E2E: `src/test/e2e/` (real VS Code). Browser: `src/test/browser/` (Playwright; inject YAML via `window.__RENDER__`). HDL/vendor integration: `src/test/integration/` (own config). Fixtures in `src/test/fixtures/`.

## Project rules (from `.agents/rules/`)

- **No emojis in documentation.** UI code may use an emoji when it conveys
  meaningful information. Do not use emojis decoratively in documentation.
- **Never auto add/commit/push** — let the developer review first. Do not commit temporary debug-generated files.
- All planning/working docs go in `docs/`; never create planning files at the repo root.
- Before fixing a bug, prove the root cause with evidence, then fix the root cause (not the symptom) and prove it is fixed.
- Keep it simple — no over-engineering, no unnecessary defensive programming.
- Code must pass `npm run lint` (zero warnings) before any commit; the pre-commit hook (`lint-staged`/husky) enforces this.
