# Changelog

All notable changes to this project are documented in this file.

## 2026-02-24

### Changed
- Restructured `docs/` from flat files into mkdocs-friendly directory layout with sections: Getting Started, Concepts, Architecture, Reference, Contributing.
- Added `mkdocs.yml` configuration with Material theme, mermaid diagrams, and full navigation.
- Removed temporary planning files (`plan.md`, `review.md`).

## 2026-02-22

### Added
- Side-by-side register layout with vertical bitfield view.
- Vertical layout mode for Register Block, Address Map, Register Array Editor, and RegisterEditor.

### Changed
- Shared bit-cell styling refactored across pro and vertical layouts.
- Finalized vertical visualizer density and headerless shell updates.
- Reduced text value field width to 120px.
- Set default layout to side-by-side with vertical visualizer for RegisterEditor.
- Updated responsive design docs for current vertical visualizer behavior.

## 2026-02-21

### Added
- Added reusable inline editing component at `src/webview/ipcore/components/sections/InlineEditField.tsx`.

### Changed
- Began P4-1 decomposition of `BusInterfacesEditor` by replacing repeated inline edit/save/cancel UI blocks with `InlineEditField`.
- Updated `plan.md` to record the P4-1 decomposition slice and verification results.

## 2026-02-21 (decomposition slice 4)

### Added
- Added `useBusInterfaceEditing` at `src/webview/ipcore/hooks/useBusInterfaceEditing.ts` to encapsulate bus-interface editing state, actions, and keyboard behavior.

### Changed
- Rewired `BusInterfacesEditor` to consume `useBusInterfaceEditing` and delegate state/action logic to the hook.
- Reduced `BusInterfacesEditor` to orchestrator layout/iteration responsibilities (277 lines).
- Updated `plan.md` with slice 4 progress and verification results.

### Verification
- `npm run lint -- --max-warnings 0` passed.
- `npm run compile` passed.
- `npm test` passed (26 suites, 206 tests).

## 2026-02-21 (decomposition slice 6)

### Added
- Added `src/webview/components/bitfield/reorderAlgorithm.ts` for Ctrl-drag reorder preview computation.
- Added `src/webview/components/bitfield/keyboardOperations.ts` for keyboard reorder/resize helpers.

### Changed
- Rewired `src/webview/components/BitFieldVisualizer.tsx` to consume extracted reorder and keyboard modules.
- Grouped `src/webview/components/bitfield/ProLayoutView.tsx` inputs into `hoverState`, `dragState`, `interactions`, and `layoutConfig` objects.
- Extended `src/webview/components/bitfield/utils.ts` with bit-array and register-value helper functions used by the visualizer.
- Deduplicated `ValueBar` JSX in `BitFieldVisualizer`.
- Reduced `BitFieldVisualizer.tsx` from 603 lines to 380 lines, completing P4-2 target (<400).
- Updated `plan.md` to record P4-2 completion and verification.

### Verification
- `npm run lint -- --max-warnings 0` passed.
- `npm run compile` passed.
- `npm test` passed (26 suites, 206 tests).

## 2026-02-21 (decomposition slice 5)

### Added
- Added shared bitfield utility module at `src/webview/components/bitfield/utils.ts`.

### Changed
- Extracted 14 module-level utility helpers from `src/webview/components/BitFieldVisualizer.tsx` into the shared bitfield utility module.
- Rewired `BitFieldVisualizer` to consume utility functions from `bitfield/utils.ts`.
- Reduced `BitFieldVisualizer.tsx` from 862 lines to 603 lines.
- Updated `plan.md` with P4-2 slice 1 progress and verification results.

### Verification
- `npm run lint -- --max-warnings 0` passed.
- `npm run compile` passed.
- `npm test` passed (26 suites, 206 tests).
