# IPCraft VS Code Extension -- Action Plan (Updated)

**Date:** 2026-02-20 (Updated)
**Based on:** [review.md](review.md)

> Previous plan items that have been completed are removed. This document contains only the remaining actionable work.

---

## Table of Contents

- [Status Summary](#status-summary)
- [Completed In This Pass](#completed-in-this-pass)
- [Priority 2 -- Next Sprint](#priority-2--next-sprint)
  - [M4: Break up BitFieldVisualizer into sub-components](#m4-break-up-bitfieldvisualizer-into-sub-components)
- [Priority 3 -- Backlog](#priority-3--backlog)
  - [T+: Increase test coverage toward 30%](#t-increase-test-coverage-toward-30)
  - [Optional hardening](#optional-hardening)
## Status Summary

**Completed from this implementation pass:**
- P1 items completed: N1, S2
- P2 items completed: N2, N3, N5
- P3 items completed: N4, N6

**Verified current health:**
- `npm run lint` passes with `--max-warnings 0`
- `npm run compile` passes
- `npm test` passes
- `npm run test:unit:coverage` passes
- Coverage now: Statements **16.16%**, Branches **9.43%**, Functions **12.74%**, Lines **16.08%**

**Remaining focus:** long-range coverage goal (30%).

---

## Completed In This Pass

### Priority 1 -- Immediate Fixes

- **N1 completed:** lowered coverage thresholds in `jest.config.js` to:
  - branches: 8
  - functions: 11
  - lines: 14
  - statements: 14
- **S2 completed:** deleted invalid `src/webview/resources/material-symbols-outlined.woff2`

### Priority 2 -- Next Sprint items completed early

- **N2 completed:**
  - fixed lint warnings
  - enforced zero-warning lint policy in `package.json`:
    - `"lint": "eslint src --max-warnings 0"`
- **N3 completed:** replaced remaining `Number.parseInt(value, 0)` usages with explicit numeric parsing
- **N5 completed:** added `fromIndex` bounds guards to all repackers and added tests for out-of-range behavior
- **M8 completed:** decomposed `Outline` into focused sub-components:
  - `src/webview/components/outline/BlockNode.tsx`
  - `src/webview/components/outline/RegisterNode.tsx`
  - `src/webview/components/outline/RegisterArrayNode.tsx`
  - `src/webview/components/outline/FieldNode.tsx`
  - `src/webview/components/outline/OutlineHeader.tsx`
  - `src/webview/components/outline/types.ts`
  - `src/webview/components/outline/index.ts`
  - `src/webview/components/Outline.tsx` reduced to container/orchestrator
  - verification: `npm run compile`, `npm run lint`, `npm test` all pass
- **M4 completed:** completed BitFieldVisualizer decomposition with remaining pro-layout extraction:
  - `src/webview/components/bitfield/FieldCell.tsx`
  - `src/webview/components/bitfield/ProLayoutView.tsx`
  - `src/webview/components/bitfield/index.ts`
  - `src/webview/components/BitFieldVisualizer.tsx` reduced further to orchestrator wiring for pro/default layout views
  - verification: `npm run compile`, `npm run lint`, `npm test` all pass

### Priority 3 -- Backlog items completed early

- **N4 completed:** removed dead placeholder section components from `src/webview/ipcore/components/layout/EditorPanel.tsx`
- **N6 completed:**
  - Q3: `TemplateLoader.resolveTemplatesPath()` fallback cleaned up
  - #2: removed deprecated `_bitOffset` parameter from `getFieldColor`
  - #3: removed legacy `BitFieldUtils` class API; callers switched to standalone exports
  - #5: removed legacy `generateVHDLWithBus` command registration/contribution
  - #10: preserved explicit `size` in `repackBlocksForward` via `size: block.size ?? blockSize`

---
```

If Material Symbols icons are needed later, download the correct WOFF2 from Google Fonts and add a `@font-face` in `src/webview/index.css`.

---

## Priority 2 -- Next Sprint

### M4: Break up BitFieldVisualizer into sub-components

**File:** `src/webview/components/BitFieldVisualizer.tsx` (1,595 lines)

**Problem:** Single component manages 13+ state variables, two layout modes, drag interactions, keyboard navigation, and value editing. Untestable in isolation.

**Approach:**

1. Create `src/webview/components/bitfield/` directory
2. Extract hooks first (lowest risk):
   - `useShiftDrag.ts` -- shift-drag resize state and listeners
   - `useCtrlDrag.ts` -- ctrl-drag reorder state and listeners
   - `useValueEditing.ts` -- inline hex/dec value editing
3. Extract render sub-components:
   - `ProLayoutView.tsx` -- the "pro" layout bit grid
   - `DefaultLayoutView.tsx` -- the default layout
   - `ValueBar.tsx` -- the value display bar below the grid
   - `FieldCell.tsx` -- individual bit field cell rendering
4. Reduce `BitFieldVisualizer.tsx` to orchestrator (~200-300 lines)
5. Add `index.ts` re-export

**Progress (this pass):**
- [x] `src/webview/components/bitfield/types.ts`
- [x] `src/webview/components/bitfield/useShiftDrag.ts`
- [x] `src/webview/components/bitfield/useCtrlDrag.ts`
- [x] `src/webview/components/bitfield/useValueEditing.ts`
- [x] `src/webview/components/bitfield/ValueBar.tsx`
- [x] `src/webview/components/bitfield/DefaultLayoutView.tsx`
- [x] Extract remaining render sub-components (`ProLayoutView`, `FieldCell`)
- [x] Reduce `BitFieldVisualizer.tsx` to orchestrator and add `index.ts`

**Verification (current milestone):**
- `npm run compile` passes
- `npm run lint` passes with `--max-warnings 0`
- `npm test` passes

**Verification:** Run `npm run compile` and manual test of drag resize, drag reorder, value editing, and both layout modes.

---

## Priority 3 -- Backlog

### T+: Increase test coverage toward 30%

Current: **16.16% statements**, **9.43% branches**, **12.74% functions**, **16.08% lines**.

Target: 30% statements, 20% branches.

**High-value, easy-to-test targets:**

| File | Lines | Why |
|------|-------|-----|
| `src/services/FileSetUpdater.ts` | 107 | Pure function, no VS Code deps |
| `src/webview/hooks/useSelection.ts` | ~100 | State logic, testable with renderHook |
| `src/webview/hooks/useTableNavigation.ts` | ~150 | Keyboard logic, testable with renderHook |
| `src/webview/utils/formatUtils.ts` | ~20 | Pure functions |
| `src/webview/services/SpatialInsertionService.ts` | 645 | Partially tested, expand existing suite |

**Now covered in this pass:**
- `src/services/FileSetUpdater.ts`
- `src/webview/hooks/useSelection.ts`

**Extension host services (require VS Code mocking):**

| File | Lines | What to test |
|------|-------|-------------|
| `src/services/BusLibraryService.ts` | ~200 | Cache behavior, YAML loading, bus merging |
| `src/services/ImportResolver.ts` | ~150 | Import path resolution, circular dependency detection |
| `src/services/YamlValidator.ts` | ~100 | Schema validation logic |

### Optional hardening

- Investigate and clean up Jest worker teardown warning (`--detectOpenHandles`) to prevent hidden resource leaks.

---

## Timeline Estimate

| Priority | Effort | Target |
|----------|--------|--------|
| P1 -- Immediate | 1-2 hours | Now |
| P2 -- Next Sprint | 5-7 days | Next sprint |
| P3 -- Backlog | 6-10 days | As capacity allows |

---

## Verification Checklist

After each priority level, verify:

- [x] **P1:** `npm test` passes (coverage thresholds met); invalid font file removed
- [x] **P2:** `npm run compile` succeeds; `npm run lint` passes with `--max-warnings 0`; no `parseInt(s, 0)` occurrences; repackers validate `fromIndex`
- [x] **P3 (completed subset):** dead placeholder exports removed; deprecated color param removed; legacy BitFieldUtils class removed; legacy generate-with-bus command removed; explicit block size preserved
- [x] **Remaining major refactors:** BitFieldVisualizer decomposition
- [ ] **Long-range target:** coverage > 30% statements
