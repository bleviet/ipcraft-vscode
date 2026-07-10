# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.8.6] - 2026-07-10

### Added
- **Bus interface clock/reset routing matrix**: a new clickable "Ports" header on the IP Core canvas (positioned below the Generics/Dependencies sections, mirroring the existing Generics overview) opens a matrix panel listing every bus interface with inline Clock/Reset dropdowns and a hover-to-delete action, plus a separate Resets section showing each reset's own associated clock — so clock/reset routing can be audited and fixed across the whole core without clicking through each interface individually. ([#57](https://github.com/bleviet/ipcraft-vscode/issues/57))

## [0.8.3] - 2026-07-07

### Fixed
- **Parameterized port widths lost their function/generic on VHDL and Verilog import**: `extractWidthFromType`/`extractWidth` only recognized a predefined width function (`clog2`, `log2`, `ceil`, `floor`, `min`, `max`) when its argument was a bare parameter name. A function applied to an arithmetic expression on a generic — e.g. `clog2(DW/2)` — matched none of the import patterns: the Verilog importer dropped the width entirely (silently falling back to a fixed default, losing the generic reference altogether), and the VHDL importer fell back to re-storing the raw expanded VHDL text (`integer(ceil(log2(real(DW/2))))`) instead of the canonical `clog2(DW/2)`, which then failed to parse on the next regeneration and leaked VHDL-only syntax into SystemVerilog/Tcl output. Both importers now reverse-map the generator's own canonical VHDL/SystemVerilog expansions back to the width-expression form via the shared `widthExprAst` module, with the function argument allowed to be an arbitrary arithmetic expression. ([#37](https://github.com/bleviet/ipcraft-vscode/issues/37))

## [0.8.2] - 2026-07-04

### Fixed
- **Vivado VHDL-93/2008 misclassification**: generated `component.xml` registered every VHDL file as plain `vhdlSource`, which Vivado treats as VHDL-93 when the IP is instantiated in a block design, rejecting VHDL-2008 constructs during synthesis. VHDL files now default to VHDL-2008 (`userFileType vhdlSource-2008`, matching Vivado's own packaging), and each file in a `fileSets` entry can set an explicit `version` (`87`/`93`/`2002`/`2008`/`2019`) via a new dropdown in the Source Files editor. ([#28](https://github.com/bleviet/ipcraft-vscode/issues/28))

## [0.8.0] - 2026-06-27

### Added
- **Master-detail block editor**: the address-block screen now shows the register map alongside an inline register editor, so registers can be edited in place without leaving the block.
- **Drag-to-reorder in the outline**: address blocks, top-level registers, and registers inside a register array can now be reordered by dragging their gripper handle. Moves are confined to the same sibling group and repack offsets automatically.
- **Live reorder preview**: dragging a bit field or an outline node reflows the list into the prospective drop position in real time, with a theme-aware focus ring marking the item being moved (replaces the previous drop-line indicators).

### Fixed
- **Register map visualizer**: register name labels stay visible when the panel is resized narrow, the register-array badges no longer crop, and the side-by-side panes are resizable.

## [0.3.0] - 2026-06-13

### Fixed
- **Memory Map Structural Desync**: Fixed a critical bug where array-level operations (insert, delete, drag-and-drop relocate) on Address Blocks, Registers, and Bitfields would corrupt memory address offsets and bit range allocations.
- **Memory map file corruption on rapid edits**: register insertions sent two document updates back-to-back (structural edit + layout repack); the second edit could race the first in the extension host, replacing only the older document extent and leaving a stale tail of duplicated YAML. The webview now applies the edit and the repack in a single pass (one update per gesture), and `DocumentManager` serializes document updates per URI so overlapping edits can never use a stale replace range.
- **Spurious document changes and whole-file reformatting**: clicking around the memory map view could mark the file dirty without any real edit (editors committed unchanged values on blur), and every write reserialized the entire document with js-yaml — changing indentation and deleting all comments. All memory-map writes now go through `YamlService.applyPathEdits`, which edits the parsed document in place (yaml Document API): no-op edits produce no update at all, untouched content keeps its formatting, comments and hex spellings, and structural edits only re-render the subtree that actually changed.
- **YAML schema pollution**: whole-map and array-level writes now pass through a `YamlSanitizer` that strips runtime-only keys (`address_offset`, `base_address`, `bit_offset`/`bit_width`/`bit_range`, `__kind`), canonicalizes aliases to the ipcraft-spec schema spelling (`baseAddress`, `resetValue`, `enumeratedValues`), and drops injected defaults (`size: 32`, `range: 4096`, `monitorChangeOf: null`). `DataNormalizer` no longer fabricates `range` and preserves `defaultRegWidth`, so those values survive round-trips through the editor.

### Changed
- **Stateless Layout Recomputation**: Replaced ad-hoc manual array shifting and incremental offset math in UI components with a centralized, pure functional `LayoutEngine` that strictly enforces invariants top-down.
- **Mutation Service API**: Re-architected structural edits across the application (in `BlockEditor.tsx`, `RegisterMapVisualizer.tsx`, and `FieldOperationService.ts`) to use `MutationService` for array state manipulations, followed by a global `recomputeFullLayout` pass.
## [0.2.0] - 2026-05-23

### Added
- **SystemVerilog generation**: all scaffold and generate commands now produce `.sv` source files when `ipcraft.generate.hdlLanguage` is set to `systemverilog`. The scaffold command generates the full project layout (package, top, core, bus wrapper, register file) in the configured HDL language.
- **Headless build** (`IPCraft: Build`): compiles Vivado (OOC and full XPR) and Quartus projects in batch mode from inside VS Code, without opening the GUI. Live output streams to a dedicated *IPCraft Build* Output Channel.
- **Build Reports panel**: Explorer sidebar tree view showing WNS/WHS (Vivado) or Fmax (Quartus), LUT/FF/BRAM/DSP utilization, and CDC violations. Click any node to open the corresponding report file.
- **Status bar build indicator**: shows live `$(loading~spin) Building…` while running; collapses to `$(pass) WNS +1.23ns` or `$(pass) Fmax 156 MHz` on success.
- **`vivado_run_ooc.tcl`** and **`vivado_run_xpr.tcl`** scripts generated alongside the Vivado project files, allowing headless OOC synthesis and full implementation via `vivado -mode batch`.
- New settings: `ipcraft.quartus.shellPath` (path to `quartus_sh`), `ipcraft.build.jobs` (parallel job count), and `ipcraft.generate.hdlLanguage` (`vhdl` or `systemverilog`).
- Vivado project output directory changed from `<ip_name>_vivado/` to `build/ooc/` to keep source files clean.
- **Full bus-interface detection in VHDL parser**: `detectBusInterfaces` now scores against all five supported bus definitions — AXI4-Full, AXI4-Lite, AXI-Stream, Avalon-MM, and Avalon-ST — using a prefix-based scoring algorithm with exclusive-signal disambiguation (e.g. `awlen`/`wlast` distinguish AXI4-Full from AXI4-Lite) and a pollution ratio check to reject false-positive matches.
- **Auto clock/reset association**: when a VHDL entity has exactly one clock and one reset, the parser automatically populates `associatedReset` on clock entries, `associatedClock` on reset entries, and `associatedClock`/`associatedReset` on every detected bus interface.
- **IPCraft application menu**: added a top-level **IPCraft** entry to the VS Code application menu bar. All file-type commands (scaffold, export, build, import) are now accessible from this menu without needing to right-click a file in the Explorer.
- **`_hw.tcl` source directive resolution**: the Platform Designer importer now follows `source` directives recursively, so multi-file IP core packages are imported in full.
- **Compilation-order sorting**: imported fileset files are sorted by compilation dependency order (packages before entities, entities before architectures) when scaffolding from existing source.

### Changed
- `IPCraft: Scaffold VHDL Project` renamed to `IPCraft: Scaffold Project` to reflect support for both VHDL and SystemVerilog.
- `IPCraft: Generate VHDL` renamed to `IPCraft: Generate HDL` to reflect support for both HDL languages.
- `IPCraft: Scaffold Project` now always generates Vivado and Quartus project files by default.
- Removed the table view from the IP Core editor; the canvas is now the default (and only) view.
- Vendor output directory for Vivado renamed from `amd/` to `xilinx/` to better reflect common usage.
- Simulation_Resources filesets are excluded from generated Vivado/Quartus project files.
- Removed all commands from the Explorer and editor context menus for `.ip.yml`, `.vhd`/`.vhdl`, and `component.xml` files. Commands are now accessed via the Command Palette, the **IPCraft** application menu, or the editor title bar.
- Documentation: updated all references to `amd/` → `xilinx/`; added Commands & Settings reference page; added Building a Project how-to; updated README with complete command listing and SystemVerilog coverage.

### Fixed
- VHDL parser no longer produces false-positive Avalon-ST detections on register bank ports such as `rd_data`/`rd_valid` when sibling ports (`rd_en`, `rd_addr`) clearly indicate a different interface.
- Logger unit tests: resolved split-module-instance issue where `jest.mock()` factory and `moduleNameMapper` each created their own `vscode` instance, causing mock channel assertions to fail.
- Browser integration tests: fixed Playwright strict-mode violations caused by `getByText()` matching both HTML `<span>` elements and SVG `<text>` nodes for VLNV info strings.
- Scaffolder now includes all HDL languages (VHDL and SystemVerilog) when sorting imported fileset files.

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
