# Changelog

All notable changes to this project are documented in this file.

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

### Verification
- `npm run lint` passed.
- `npm run compile` passed.
- `npm test` passed (26 suites, 206 tests).
