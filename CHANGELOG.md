# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- **Headless build** (`IPCraft: Build`): compiles Vivado (OOC and full XPR) and Quartus projects in batch mode from inside VS Code, without opening the GUI. Live output streams to a dedicated *IPCraft Build* Output Channel.
- **Build Reports panel**: Explorer sidebar tree view showing WNS/WHS (Vivado) or Fmax (Quartus), LUT/FF/BRAM/DSP utilization, and CDC violations. Click any node to open the corresponding report file.
- **Status bar build indicator**: shows live `$(loading~spin) Building…` while running; collapses to `$(pass) WNS +1.23ns` or `$(pass) Fmax 156 MHz` on success.
- **`vivado_run_ooc.tcl`** and **`vivado_run_xpr.tcl`** scripts generated alongside the Vivado project files, allowing headless OOC synthesis and full implementation via `vivado -mode batch`.
- New settings: `ipcraft.quartus.shellPath` (path to `quartus_sh`) and `ipcraft.build.jobs` (parallel job count).
- Vivado project output directory changed from `<ip_name>_vivado/` to `build/ooc/` to keep source files clean.
- **Full bus-interface detection in VHDL parser**: `detectBusInterfaces` now scores against all five supported bus definitions — AXI4-Full, AXI4-Lite, AXI-Stream, Avalon-MM, and Avalon-ST — using a prefix-based scoring algorithm with exclusive-signal disambiguation (e.g. `awlen`/`wlast` distinguish AXI4-Full from AXI4-Lite) and a pollution ratio check to reject false-positive matches.
- **Auto clock/reset association**: when a VHDL entity has exactly one clock and one reset, the parser automatically populates `associatedReset` on clock entries, `associatedClock` on reset entries, and `associatedClock`/`associatedReset` on every detected bus interface.
- **IPCraft application menu**: added a top-level **IPCraft** entry to the VS Code application menu bar. All file-type commands (scaffold, export, build, import) are now accessible from this menu without needing to right-click a file in the Explorer.

### Changed
- `IPCraft: Scaffold VHDL Project` now always generates Vivado and Quartus project files by default.
- Removed the table view from the IP Core editor; the canvas is now the default (and only) view.
- Vendor output directory for Vivado renamed from `amd/` to `xilinx/` to better reflect common usage.
- Removed all commands from the Explorer and editor context menus for `.ip.yml`, `.vhd`/`.vhdl`, and `component.xml` files. Commands are now accessed via the Command Palette, the **IPCraft** application menu, or the editor title bar.
- Documentation: updated all references to `amd/` → `xilinx/`; added Commands & Settings reference page; added Building a Project how-to; updated README with complete command listing. Commands tables updated to reflect IPCraft menu bar instead of Explorer context menu. Bus detection section expanded to cover all five bus types.

### Fixed
- VHDL parser no longer produces false-positive Avalon-ST detections on register bank ports such as `rd_data`/`rd_valid` when sibling ports (`rd_en`, `rd_addr`) clearly indicate a different interface.
- Logger unit tests: resolved split-module-instance issue where `jest.mock()` factory and `moduleNameMapper` each created their own `vscode` instance, causing mock channel assertions to fail.
- Browser integration tests: fixed Playwright strict-mode violations caused by `getByText()` matching both HTML `<span>` elements and SVG `<text>` nodes for VLNV info strings.

## [0.1.0] - 2026-03-29

### Added
- Extension icon (PNG) based on bahonavi brand guidelines.
- Publishing metadata and optimized `.vscodeignore` for smaller package size.
- Support for visual editing of IP Core and Memory Map specifications.
- VHDL generation and import capabilities.
- Integrated Bus Library viewer.

## 2026-03-28

### Changed
- Renamed vendor options from `intel`/`xilinx` to `altera`/`amd` across the entire codebase.
- Renamed generator templates: `intel_hw_tcl.j2` to `altera_hw_tcl.j2`, `xilinx_component_xml.j2` to `amd_component_xml.j2`, `xilinx_xgui.j2` to `amd_xgui.j2`.
- Renamed vendor output directories from `intel/`/`xilinx/` to `altera/`/`amd/`.
- Updated UI labels in GeneratorPanel to reflect new vendor names.
- Updated `ipcraft-spec` submodule: renamed example vendor directories and updated bus definitions.

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
