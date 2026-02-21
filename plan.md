# IPCraft VS Code Extension -- Action Plan

**Date:** 2026-02-21
**Based on:** [review.md](review.md)

> Items completed in previous passes are summarized in the history section. This document contains only remaining actionable work.

---

## Table of Contents

- [Status Summary](#status-summary)
- [P1 -- Correctness Fixes](#p1----correctness-fixes)
- [P2 -- Dead Code Removal](#p2----dead-code-removal)
- [P3 -- Code Duplication](#p3----code-duplication)
- [P4 -- Large File Decomposition](#p4----large-file-decomposition)
- [P5 -- Code Quality and Conventions](#p5----code-quality-and-conventions)
- [P6 -- Test Coverage](#p6----test-coverage)
- [Completed History](#completed-history)
- [Verification Checklist](#verification-checklist)

---

## Status Summary

**Current health (verified 2026-02-21):**
- `npm run lint` passes with `--max-warnings 0`
- `npm run compile` passes
- `npm test` passes (26 suites, 206 tests)
- `npm run test:unit:coverage` passes
- Coverage: Statements **21.32%**, Branches **12.31%**, Functions **15.78%**, Lines **21.46%**

**Previous items all resolved:** N1, S2, N2, N3, N5, N4, N6, M4 (partial), M8 (partial)

**New progress (2026-02-21):**
- P1 implementation completed (all 7 items)
- P2 implementation completed (items P2-1 through P2-5)
- Verification complete: `npm run lint`, `npm run compile`, and `npm test` pass after P1/P2 changes
- P3 implementation completed for: P3-1, P3-2, P3-3, P3-4, P3-5, P3-6, P3-7, P3-8, P3-9, P3-10
- P4 implementation in progress: P4-1 decomposition slices completed for `InlineEditField`, `BusInterfaceCard`, and `PortMappingTable` extraction/integration
- P5 implementation completed for: P5-1, P5-6, P5-7
- Verification complete: `npm run lint`, `npm run compile`, and `npm test` pass after the current batch

---

## P1 -- Correctness Fixes

Small, targeted fixes. Each is independent and can be done in isolation.

### P1-1: Fix remaining `parseInt` radix 0 (review C5)

**Files:**
- `src/webview/components/memorymap/BlockEditor.tsx` L479
- `src/webview/components/memorymap/MemoryMapEditor.tsx` L360

**Action:** Replace `Number.parseInt(value, 0)` with explicit radix (10 or 16) or use `Number()` for auto-detection.

**Verification:** `npm run lint && npm test`

### P1-2: Fix ImportResolver.clearCache() omission (review C6)

**File:** `src/services/ImportResolver.ts` L221-224

**Action:** Add `this.defaultBusLibraryCache = undefined;` to `clearCache()`.

**Verification:** `npm test`

### P1-3: Remove ImportResolver double-caching (review C7)

**File:** `src/services/ImportResolver.ts` L32

**Action:** Remove `defaultBusLibraryCache` field. Use `BusLibraryService.cachedDefaultLibrary` directly (it already caches).

**Verification:** `npm test`

### P1-4: Escape regex in nextSequentialName (review C8)

**File:** `src/webview/services/SpatialInsertionService.ts` L100

**Action:** Escape `prefix` before constructing the RegExp. Use a simple `escapeRegex(str)` utility or `prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.

**Verification:** `npm test`

### P1-5: Fix duplicate bitWidth access (review C9)

**File:** `src/generator/IpCoreScaffolder.ts` L537

**Action:** `field.bit_width ?? field.bitWidth ?? field.bitWidth` -- remove the redundant third operand.

**Verification:** `npm run compile`

### P1-6: Remove no-op normalization branches (review C10)

**File:** `src/generator/IpCoreScaffolder.ts` L479

**Action:** Remove `else if (key === 'AXIS') { key = 'AXIS'; }` and `else if (key === 'AVALON_ST') { key = 'AVALON_ST'; }`.

**Verification:** `npm run compile && npm test`

### P1-7: Fix VhdlParser prefix stripping (review C11)

**File:** `src/parser/VhdlParser.ts` L238-241

**Action:** Break after first matched prefix in the `forEach` loop, or use a `for...of` with early return. Prevents double-stripping `IO_I_DATA`.

**Verification:** Add a test case for `IO_I_DATA` prefix behavior. `npm test`

---

## P2 -- Dead Code Removal

Remove unused exports and dead functionality. Improves maintainability and reduces cognitive load.

### P2-1: Remove unused utility exports (review D1)

**Action for each file -- delete the unused export and its tests if the test only exists to cover dead code:**

| Export | File | Action |
|--------|------|--------|
| `isBitUsed()` | `BitFieldUtils.ts` | Delete function |
| `findFreeBit()` | `BitFieldUtils.ts` | Delete function |
| `repackFieldsSequentially()` | `BitFieldUtils.ts` | Delete function (also mutates input -- review C12) |
| `repackFieldsFrom()` | `BitFieldRepacker.ts` | Delete function |
| `repackFieldsDownward` alias | `BitFieldRepacker.ts` | Delete alias |
| Re-exports of `parseBitsRange`/`formatBits` | `BitFieldRepacker.ts` | Delete re-exports |
| `validateFrequency()` | `validation.ts` | Delete function |
| `validatePositiveNumber()` | `validation.ts` | Delete function |
| `KNOWN_MAPPINGS` | `yamlKeyMapper.ts` | Delete constant |
| `mapKeysToCamelCase()` | `yamlKeyMapper.ts` | Delete function |
| `mapKeysToSnakeCase()` | `yamlKeyMapper.ts` | Delete function |

**Verification:** `npm run lint && npm run compile && npm test`

### P2-2: Remove unused component and props (review D1, D2)

| Item | File | Action |
|------|------|--------|
| `ReferenceField` | `shared/components/ReferenceField.tsx` | Delete file, remove from `index.ts` |
| `NumberField` min/max/step | `NumberField.tsx` | Remove unused props from interface and destructuring |
| `resizeEdge` in `ShiftDragState` | `bitfield/types.ts` | Remove field from type, remove all `resizeEdge: null` assignments |

**Verification:** `npm run compile && npm test`

### P2-3: Remove dead functionality in live code (review D2)

| Item | File | Action |
|------|------|--------|
| `getFieldPatternOverlay()` | `colors.ts` | Remove function. Replace call sites (FieldCell.tsx, RegisterMapVisualizer.tsx, AddressMapVisualizer.tsx) with `backgroundImage: undefined` or remove the property |
| Dead validation branches | `useIpCoreState.ts` L74-77 | Remove empty `if (!data.apiVersion \|\| !data.vlnv)` block |
| Unused `ValidationError` section types | `useIpCoreState.ts` | Remove unused union members; keep only `'busInterfaces'` |
| "Export Header" / "Documentation" buttons | `index.tsx` L469-482 | Remove buttons or add TODO comments if planned for future |
| Unused `sectionMeta` returns | `useNavigation.ts` | Stop returning `sectionMeta`, `updateSectionMeta`, `getSectionMeta` |
| Empty scroll effect | `BusInterfacesEditor.tsx` L569-576 | Remove the `useEffect` |

**Verification:** `npm run compile && npm run lint && npm test`

### P2-4: Fix DocumentManager.saveDocument bypass (review D1)

**Files:** `MessageHandler.ts`, `DocumentManager.ts`

**Action:** Either:
- (a) Make `MessageHandler.handleSaveCommand` use `this.documentManager.saveDocument(document)` instead of `document.save()` directly, OR
- (b) Remove `DocumentManager.saveDocument()` as dead code

Option (a) is preferred as it centralizes error handling.

**Verification:** `npm test`

### P2-5: Remove ErrorHandler dead exports (review D1)

**File:** `src/utils/ErrorHandler.ts`

**Action:** Remove `createError()`, `isExtensionError()`, `wrapAsync()`, `wrapAsyncWithNotification()` if no production code uses them. Remove corresponding tests.

**Verification:** `npm run compile && npm test`

---

## P3 -- Code Duplication

Each item reduces maintenance burden by consolidating repeated patterns.

### P3-1: Unify HtmlGenerator methods (review H4)

**File:** `src/services/HtmlGenerator.ts`

**Action:** Replace `generateHtml` and `generateIpCoreHtml` with a single private `generateHtmlForEditor(options: { scriptName, styleName, rootId, title })` method. Keep the two public methods as thin wrappers passing their specific config.

**Effort:** ~30 min

### P3-2: Extract shared displayDirection utility (review H7)

**Files:** `ClocksTable.tsx`, `ResetsTable.tsx`, `PortsTable.tsx`

**Action:** Move `displayDirection` to `src/webview/shared/utils/formatters.ts` (or similar). Import in all three.

**Effort:** ~15 min

### P3-3: Extract shared calculateBlockSize utility (review H6)

**Files:** `AddressBlockRepacker.ts`, `MemoryMapEditor.tsx`, `AddressMapVisualizer.tsx`

**Action:** Create `src/webview/utils/blockSize.ts` with a single `calculateBlockSize` function. Align the type signatures or use a minimal common interface.

**Effort:** ~30 min

### P3-4: Consolidate ACCESS_OPTIONS constant (review L17)

**Files:** `BlockEditor.tsx`, `RegisterArrayEditor.tsx`, `FieldsTable.tsx`

**Action:** Define `ACCESS_OPTIONS` once in `src/webview/shared/constants.ts` and import everywhere.

**Effort:** ~15 min

### P3-5: Extract useEscapeFocus and useAutoFocus hooks (review H2)

**Files:** `BlockEditor.tsx`, `MemoryMapEditor.tsx`, `RegisterArrayEditor.tsx`

**Action:** Create `src/webview/hooks/useEscapeFocus.ts` and `src/webview/hooks/useAutoFocus.ts` to encapsulate the duplicated `useEffect` patterns. Replace inline effects in all three editors.

**Effort:** ~1 hour

### P3-6: Extract shared focusContainer utility (review L16)

**Action:** Create a `focusContainer(ref: React.RefObject<HTMLElement>)` utility that wraps the `setTimeout(() => ref.current?.focus(), 0)` pattern. Replace 15+ call sites.

**Effort:** ~30 min

### P3-7: Consolidate SpatialInsertionService after/before pairs (review H3)

**File:** `src/webview/services/SpatialInsertionService.ts`

**Action:** Merge each after/before pair into a single method with a `direction: 'before' | 'after'` parameter:
- `insertField(direction, ...)` replacing `insertFieldAfter`/`insertFieldBefore`
- `insertRegister(direction, ...)` replacing `insertRegisterAfter`/`insertRegisterBefore`
- `insertBlock(direction, ...)` replacing `insertBlockAfter`/`insertBlockBefore`

Also extract shared `defaultReg()` and `defaultBlock()` factory functions.

**Effort:** ~2 hours

### P3-8: Extract YAML file reading helper (review L6)

**File:** `src/services/ImportResolver.ts`

**Action:** Create `private async readYamlFile(absolutePath: string): Promise<unknown>` to replace the 3 duplicated `Uri.file -> readFile -> Buffer -> yaml.load` chains.

**Effort:** ~30 min

### P3-9: Consolidate ipcore table editor pattern (review H1)

**Files:** `ClocksTable.tsx`, `ResetsTable.tsx`, `PortsTable.tsx`, `ParametersTable.tsx`

**Action:** Create a generic `useTableEditing<T>` hook or configuration-driven table component that encapsulates: state (selectedIndex, activeColumn, editingIndex, isAdding, draft), CRUD callbacks, `useTableNavigation` setup, escape handler, getRowProps/getCellProps. Each table then provides a column definition and validation function.

This is the highest-effort duplication fix but eliminates ~1,200 lines of near-identical code.

**Effort:** ~1-2 days

### P3-10: Extract useMemoryMapState shared update logic (review for useMemoryMapState.ts)

**File:** `src/webview/hooks/useMemoryMapState.ts`

**Action:** `updateFromYaml` and `updateRawText` are nearly identical. Extract a shared `applyYamlUpdate(text, filename?)` internal function.

**Effort:** ~30 min

---

## P4 -- Large File Decomposition

Each task reduces a file to a focused orchestrator by extracting cohesive sub-units.

### P4-1: Decompose BusInterfacesEditor (1,879 lines) (review C1)

**File:** `src/webview/ipcore/components/sections/BusInterfacesEditor.tsx`

**Steps:**
1. Extract reusable `InlineEditField` component to replace 10 repeated edit/save/cancel patterns
2. Extract `BusInterfaceCard.tsx` -- renders a single bus interface's detail view
3. Extract `PortMappingTable.tsx` -- port table and editing
4. Extract `useBusInterfaceEditing.ts` -- state management and keyboard handler
5. Reduce orchestrator to layout and iteration

**Target:** Orchestrator < 300 lines

**Effort:** ~2-3 days

### P4-2: Continue BitFieldVisualizer decomposition (864 lines) (review C2)

**File:** `src/webview/components/BitFieldVisualizer.tsx`

**Steps:**
1. Move 14 module-level utility functions to `src/webview/components/bitfield/utils.ts`
2. Extract `handleCtrlPointerMove` algorithm to `src/webview/components/bitfield/reorderAlgorithm.ts`
3. Group related props into interface objects (e.g., `DragState`, `FieldOperations`, `LayoutConfig`) to reduce ProLayoutView's 35 props
4. Extract duplicated `<ValueBar>` JSX to a shared variable

**Target:** Orchestrator < 400 lines

**Effort:** ~1 day

### P4-3: Decompose index.tsx / App component (677 lines) (review C3)

**File:** `src/webview/index.tsx`

**Steps:**
1. Extract `resolveFromSelection` to `src/webview/hooks/useSelectionResolver.ts`
2. Extract `handleFieldOperations` to `src/webview/services/FieldOperationService.ts` (pure function)
3. Move remaining business logic (outline rename, register/block navigation) to dedicated hooks
4. Remove or comment "Export Header"/"Documentation" dead buttons

**Target:** App component < 200 lines (layout + wiring only)

**Effort:** ~1 day

### P4-4: Continue Outline.tsx decomposition (668 lines) (review C4)

**File:** `src/webview/components/Outline.tsx`

**Steps:**
1. Extract `visibleSelections` useMemo to `src/webview/components/outline/buildVisibleSelections.ts` (pure function, ~144 lines)
2. Extract `onTreeKeyDown` to `src/webview/components/outline/useOutlineKeyboard.ts` hook
3. Replace string ID parsing (`block-0-arrreg-1`) with structured objects or a typed ID helper
4. Extract repeated `memoryMap.name || 'Memory Map'` to a const

**Target:** Container < 300 lines

**Effort:** ~1 day

### P4-5: Reduce FieldsTable.tsx (665 lines) (review C5)

**File:** `src/webview/components/register/FieldsTable.tsx`

**Steps:**
1. Move validation functions (`parseBitsWidth`, `validateBitsString`, `parseBitsInput`, `parseReset`, `getFieldBitWidth`, `validateResetForField`) to `src/webview/shared/utils/fieldValidation.ts`
2. Extract duplicated cell-click pattern to `handleCellClick(index, key)` helper
3. Extract duplicated `onFocus` pattern similarly

**Target:** < 400 lines

**Effort:** ~0.5 day

### P4-6: Reduce IpCoreScaffolder.ts (632 lines) (review C5, L13)

**File:** `src/generator/IpCoreScaffolder.ts`

**Steps:**
1. Move all interface/type definitions (~70 lines) to `src/generator/types.ts`
2. Extract register preparation and VHDL type mapping to `src/generator/registerProcessor.ts`
3. Consolidate the two bus type normalization approaches (`BUS_TYPE_MAP` and `normalizeBusTypeKey`)
4. Centralize dual camelCase/snake_case access -- normalize data once at load time

**Target:** < 300 lines

**Effort:** ~1 day

### P4-7: Refactor IpCoreEditorProvider.resolveCustomTextEditor (330 lines) (review L3)

**File:** `src/providers/IpCoreEditorProvider.ts`

**Steps:**
1. Extract inline error HTML to a template helper or `errorHtml.ts`
2. Move `IpcMessage` and `FileSet` type definitions to module scope or shared types
3. Extract generate workflow (130 lines) to a `GenerateHandler` class or function
4. Replace if/else message handler chain with a strategy map

**Target:** < 150 lines for `resolveCustomTextEditor`

**Effort:** ~1 day

---

## P5 -- Code Quality and Conventions

Smaller improvements for readability, consistency, and adherence to project rules.

### P5-1: Replace emojis with text/codicons (review L1)

**Files:** `GeneratorPanel.tsx`, `IpCoreApp.tsx`, `RegisterMapVisualizer.tsx`, `AddressMapVisualizer.tsx`, `IpCoreEditorProvider.ts`

**Action:** Replace emoji characters with codicons (`<span class="codicon codicon-warning">`) or plain text equivalents. Project rules: "no emojis ever."

### P5-2: Convert static-only classes to modules (review L2)

**Files:** `ErrorHandler.ts`, `VhdlParser.ts`

**Action:** Convert to modules of standalone exported functions. Remove `class` wrappers. (Note: `Logger` uses hybrid static/instance pattern for VS Code channel management -- address separately if desired.)

### P5-3: Consolidate bit-range parsers/formatters (review L4)

**File:** `src/webview/utils/BitFieldUtils.ts`

**Action:** Consolidate `parseBitsRange`/`parseBitsLike` into a single parser. Consolidate `formatBitsRange`/`formatBitsLike` into a single formatter. The `Like` variants can be thin adapters over the core `Range` functions.

### P5-4: Standardize error handling strategy (review L5)

**Files:** `ImportResolver.ts`, `BusLibraryService.ts`, `YamlPathResolver.ts`

**Action:** Adopt one pattern: throw on errors, let callers catch. Remove silent swallowing in `resolveFileSetImports` and `BusLibraryService`. Document the chosen strategy in each service's JSDoc.

### P5-5: Clean up BusLibraryService (review L8)

**File:** `src/services/BusLibraryService.ts`

**Action:** Remove `for...of` loop over single-element `candidates` array. Use direct `try/catch` on the single path.

### P5-6: Fix duplicate color value (review L9)

**File:** `src/webview/shared/colors.ts`

**Action:** Change `tangerine` to a distinct hex value, or remove it and adjust the color count.

### P5-7: Add useCallback memoization (review L10)

**Files:** `useMemoryMapState.ts`, `useYamlSync.ts`, `useIpCoreSync.ts`

**Action:** Wrap `updateFromYaml`, `updateRawText`, `sendUpdate`, `sendCommand` in `useCallback`.

### P5-8: DRY editor provider construction (review L11, L12)

**Files:** `extension.ts`, `IpCoreEditorProvider.ts`, `MemoryMapEditorProvider.ts`

**Action:** Create a shared factory or base class for service construction (`HtmlGenerator`, `DocumentManager`, `YamlValidator`, `MessageHandler`). DRY the registration blocks in `activate()`.

### P5-9: Reduce ProLayoutView inline SVG (review L18)

**File:** `src/webview/components/bitfield/ProLayoutView.tsx`

**Action:** Extract the 110-line resize handle SVG to a `ResizeHandleIndicator` sub-component.

### P5-10: Type safety improvements (review T1, T2, T3)

**Action (incremental):**
- Align repacker types with `BitFieldRuntimeDef[]` to reduce double casts in SpatialInsertionService
- Remove `[key: string]: unknown` index signatures from `FieldModel` and `FieldDef`; add explicit optional properties
- Extend `RegisterRecord` to include optional `count` and `stride` fields

---

## P6 -- Test Coverage

Target: 30% statements, 20% branches.

Current: Statements **21.32%**, Branches **12.31%**

### High-value untested targets

| File | Lines | Coverage | What to test |
|------|-------|----------|-------------|
| `src/webview/index.tsx` | 677 | 0% | Selection resolution, field operations, keyboard shortcuts |
| `src/webview/components/BitFieldVisualizer.tsx` | 864 | 0% | Utility functions (once extracted to utils.ts) |
| `src/webview/components/Outline.tsx` | 668 | 0% | Tree building logic (once extracted) |
| `src/providers/IpCoreEditorProvider.ts` | 405 | 0% | Message handling, generate workflow |
| `src/commands/GenerateCommands.ts` | 253 | 0% | VHDL parse command, file set update |
| `src/commands/FileCreationCommands.ts` | 151 | 0% | Template generation, file creation |

### Optional hardening

- Investigate Jest worker teardown warning (`--detectOpenHandles`)

---

## Effort Estimates

| Priority | Items | Effort | Timeline |
|----------|-------|--------|----------|
| P1 -- Correctness | 7 items | 2-3 hours | Immediate |
| P2 -- Dead code | 5 items | 2-3 hours | Immediate |
| P3 -- Duplication | 10 items | 3-5 days | Next sprint |
| P4 -- Decomposition | 7 items | 5-8 days | Next sprint |
| P5 -- Quality | 10 items | 2-3 days | Backlog |
| P6 -- Coverage | Ongoing | 3-5 days | Backlog |

---

## Completed History

Current pass resolved (2026-02-21):
- P1-1 to P1-7 completed:
	- parse radix fixes in memory map editors
	- ImportResolver cache fixes (`clearCache` + default cache dedupe)
	- escaped regex prefix in `nextSequentialName`
	- IpCoreScaffolder redundancy/no-op branch cleanup
	- VhdlParser prefix stripping fixed + regression test for `IO_I_DATA`
- P2-1 to P2-5 completed:
	- removed dead utility exports in bitfield utils/repacker, validation helpers, and yaml mapper
	- removed dead `ReferenceField`, trimmed `NumberField` dead props, removed `resizeEdge` dead state
	- removed dead live-code branches/returns/buttons/effects (`colors`, `useIpCoreState`, `useNavigation`, `index.tsx`, `BusInterfacesEditor`)
	- switched save flow to `DocumentManager.saveDocument()` in `MessageHandler`
	- removed dead `ErrorHandler` exports and corresponding tests
- Verification completed for current pass:
	- `npm run lint` passed
	- `npm run compile` passed
	- `npm test` passed

Current pass resolved (2026-02-21, current batch):
- P3-1 completed: unified `HtmlGenerator` methods using shared private `generateHtmlForEditor(...)`
- P3-2 completed: extracted shared `displayDirection(...)` formatter and reused in clocks/resets/ports tables
- P3-3 completed: extracted shared `calculateBlockSize(...)` utility and reused in repacker/editor/visualizer
- P3-4 completed: consolidated shared access options in `src/webview/shared/constants.ts`
- P3-6 completed: extracted `focusContainer(...)` and replaced repeated focus-timeout call sites
- P3-8 completed: extracted `ImportResolver.readYamlFile(...)` to remove duplicated YAML file-read/parse chains
- P3-10 completed: extracted `applyYamlUpdate(...)` shared update path in `useMemoryMapState`
- P3-5 completed: extracted shared `useAutoFocus` and `useEscapeFocus` hooks and applied to memory map editors
- P3-7 completed: consolidated insertion API usage to direction-based methods (`insertField`, `insertRegister`, `insertBlock`) and extracted shared default register/block factories
- P3-9 completed: extracted shared `useTableEditing<T>` hook and migrated `ClocksTable`, `ResetsTable`, `PortsTable`, and `ParametersTable` to the shared pattern
- P5-1 completed: removed emoji usage in source paths flagged by review
- P5-6 completed: fixed duplicate color value (`tangerine` now distinct from `orange`)
- P5-7 completed: memoized update/command callbacks in `useMemoryMapState`, `useYamlSync`, and `useIpCoreSync`
- Verification completed for this batch:
	- `npm run lint` passed
	- `npm run compile` passed
	- `npm test` passed

Current pass resolved (2026-02-21, decomposition slice):
- P4-1 started: extracted reusable `InlineEditField` in `src/webview/ipcore/components/sections/InlineEditField.tsx`
- P4-1 started: replaced repeated inline edit/save/cancel blocks in `BusInterfacesEditor.tsx` (bus name, prefix, array fields, port name/width)
- Verification completed for this slice:
	- `npm run lint` passed
	- `npm run compile` passed
	- `npm test` passed

Current pass resolved (2026-02-21, decomposition slice 2):
- P4-1 continued: extracted `BusInterfaceCard` into `src/webview/ipcore/components/sections/BusInterfaceCard.tsx`
- P4-1 continued: replaced inline card rendering in `BusInterfacesEditor.tsx` with `BusInterfaceCard` composition
- Verification completed for this slice:
	- `npm run lint` passed
	- `npm run compile` passed
	- `npm test` passed

Current pass resolved (2026-02-21, decomposition slice 3):
- P4-1 continued: extracted `PortMappingTable` into `src/webview/ipcore/components/sections/PortMappingTable.tsx`
- P4-1 continued: replaced inline ports table rendering in `BusInterfaceCard.tsx` with `PortMappingTable` composition
- Verification completed for this slice:
	- `npm run lint` passed
	- `npm run compile` passed
	- `npm test` passed

Previous review items resolved (2026-02-20):
- N1 (coverage thresholds), S2 (invalid woff2), N2 (lint enforcement), N3 (parseInt radix), N5 (repacker bounds), N4 (dead EditorPanel sections), N6 (all sub-items)
- M4 (BitFieldVisualizer partial decomposition -- hooks, sub-components extracted)
- M8 (Outline partial decomposition -- node components, header extracted)

---

## Verification Checklist

After each priority level, verify:

- [x] **P1:** `npm run compile && npm run lint && npm test` all pass
- [x] **P2:** `npm run compile && npm run lint && npm test` all pass; grep for removed exports confirms zero hits
- [x] **P3:** `npm run compile && npm run lint && npm test` all pass; duplicated functions have single source
- [ ] **P4:** Each decomposed file under target line count; `npm run compile && npm run lint && npm test` all pass
- [ ] **P5:** No emojis in source; no static-only classes; `npm run lint` clean
- [ ] **P6:** Coverage > 30% statements, > 20% branches
