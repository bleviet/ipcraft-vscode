# Changelog

All notable changes to this project are documented in this file.

## 2026-02-21

### Added
- Added reusable inline editing component at `src/webview/ipcore/components/sections/InlineEditField.tsx`.

### Changed
- Began P4-1 decomposition of `BusInterfacesEditor` by replacing repeated inline edit/save/cancel UI blocks with `InlineEditField`.
- Updated `plan.md` to record the P4-1 decomposition slice and verification results.

### Verification
- `npm run lint` passed.
- `npm run compile` passed.
- `npm test` passed (26 suites, 206 tests).
