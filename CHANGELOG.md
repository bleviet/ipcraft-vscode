# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- Production VSIX packages now exclude nested source maps and are checked in CI against an explicit runtime-content allowlist and size budget. The checked artifact is installed for extension-host smoke testing. ([#123](https://github.com/bleviet/ipcraft-vscode/issues/123))

### Fixed
- **CLI distribution contract**: removed the unavailable `npx ipcraft` claim from Marketplace-facing documentation and separated the `ipcraft` npm artifact from the VSIX. The CLI can now be packed and smoke-tested from a clean temporary installation without publishing; npm publication remains an explicit manual release after the matching extension release. ([#116](https://github.com/bleviet/ipcraft-vscode/issues/116))

## [0.9.2] - 2026-07-19

### Added
- **Data Inspector**: a new standalone tool for decoding an arbitrary-width value — pasted from a waveform, an ILA/SignalTap capture, a register read, or typed by hand — into named bit fields, without ever touching `.mm.yml`/`.ip.yml` or HDL generation. Three new commands: `IPCraft: Open Data Inspector` (a temporary inspection panel), `IPCraft: Open Register in Data Inspector` (pre-loads a register's field layout from a workspace memory map), and `IPCraft: New Data Inspector` (creates a reusable `*.ipci.yml` recipe with its own custom editor). Values are modeled as four-state bit vectors (`0`/`1`/`X`/`Z`, not plain integers), so numeric interpretations correctly report "unknown bits" instead of silently showing a wrong number when a range contains an unresolved bit. Accepts Verilog (`32'hDEAD_BEEF`), VHDL (`x"0123_ABCD"`), and C-style (`0xDEADBEEF`) literals, decimal, and binary, all with underscore digit separators. Supports multiple named sources composed via transform steps (concat, slice, bitwise and/or/xor/not, shift left/right, zero/sign-extend, truncate, byte swap), field overlays with hex/binary/unsigned/signed/enum/float/fixed-point interpretation and an expected-value pass/fail check, VCD signal timelines and CSV/ILA sample import (configurable radix, byte order, word order), and lane-width/zoom (overview, by-field, by-bit) controls with keyboard navigation. A saved recipe holds sources, fields, transforms, and view settings, but deliberately never the pasted value or capture history. ([#107](https://github.com/bleviet/ipcraft-vscode/issues/107))

### Changed
- **Fields table access column redesign**: the Memory Map fields table's access-mode dropdown now shows short SVD-style tokens (`RO`/`WO`/`RW`/`W1C`/`RW1C`/`WSC`/`RWSC`) when closed, with full names only in the open listbox, and the popup consistently opens downward and sizes to its content instead of occasionally misdirecting near the viewport edge. The W1C Monitors sub-row (which broke row-height uniformity) is replaced by a compact icon button opening an anchored picker menu.
- **Data Inspector internals decomposed**: the Data Inspector webview's monolithic app component was split into focused hooks (value input/literal parsing, capture import, field panel state, host sync, recipe autosave) and presentational components (value composer, capture panel, field panel), with direct unit test coverage added for each extracted hook, including the host-sync revision protocol. No user-visible behavior change. ([#112](https://github.com/bleviet/ipcraft-vscode/issues/112))

### Fixed
- **Data Inspector debug-mode overrides and value-bar validation**: a bit field defined via the common `offset`/`width` schema form lost a committed debug-mode override wider than 53 bits on the very next render (the reapplication only ran in the fallback code path); and the value-bar's parser collapsed malformed, out-of-range, and empty drafts into a single generic "Value is required" message instead of reporting which one actually happened.

## [0.9.1] - 2026-07-17

### Changed
- **Compact register and register-array editing**: removed the register-card rail from the block and register-array editors — selection, insert, delete, and drag-reorder already existed in the Outline panel, and the rail's fixed width squeezed the fields table on narrow screens (e.g. a 13" laptop). Keyboard insert/delete (`o`/`O`/`Shift+A`/`Shift+I`/`d`/`Delete`) and inline editing of a register's name, offset, and description moved onto the Outline and a new compact register header strip so nothing the rail did was lost; register and array rows also gained a color swatch, and array count/stride became double-click-editable directly on the row. The now-unused `RegisterMapVisualizer` was removed, the bit-field visualizer's default pane width shrank from 340px to 240px to match, its cells were flattened to match the memory map visualizer's style, and `ValueBar` was resized to fit the narrower pane. ([#99](https://github.com/bleviet/ipcraft-vscode/issues/99))
- **Register Value/Hex input moved to the fields toolbar**: lifted from the bottom of the (now-removed) bit-field rail to sit level with the field move-up/move-down buttons at the top of the fields table, in both the side-by-side and stacked layouts. ([#105](https://github.com/bleviet/ipcraft-vscode/issues/105))

### Fixed
- **Outline readability and navigation**: base-address, offset, count, and stride labels in the Memory Map outline were too small to read (10px, now matching the app's standard size); the footer's item count and "Base: 0x0" no longer ignore the current selection and instead reflect whatever level is selected (blocks, registers, or fields); and an implicit horizontal scrollbar — caused by `overflow-y: auto` also enabling `overflow-x`, per the CSS spec — no longer clips row content sideways; names now truncate with an ellipsis instead. ([#101](https://github.com/bleviet/ipcraft-vscode/issues/101), [#102](https://github.com/bleviet/ipcraft-vscode/issues/102))
- **RTL compile order still wrong in some fallback cases**: the topological-sort fix shipped in 0.9.0 (above) covered the common case, but a file whose declared `type` disagreed with its filename-inferred language, or whose `logicalName` went unresolved, could still sort incorrectly; separately, Vivado's `component.xml` generator re-resolved the fileset fallback path even when an explicit `rtlFiles` list was already supplied, silently discarding the caller's intended order. Both are now root-caused: a file's declared language/logical name is honored over path-based inference, and the fallback path only runs when `rtlFiles` is genuinely absent. ([#91](https://github.com/bleviet/ipcraft-vscode/issues/91))

## [0.9.0] - 2026-07-17

### Added
- **Consistency Check**: a new drift-detection feature that cross-references a `.ip.yml`'s declared ports, clocks, resets, parameters, bus interfaces, and registers against the top-level HDL (regardless of its `managed:` flag) and, once scaffolded, the Platform Designer (`_hw.tcl`) and Vivado (`component.xml`) vendor artifacts. Drift surfaces as color-coded canvas annotations, a review overlay with Adopt/Regenerate/Inspect/Ignore actions and a copy-to-clipboard button, and a single amber/red "Drift" status badge in the toolbar. Runs on demand from the toolbar or `IPCraft: Check Consistency`, and automatically (silently, badge-only) on webview open and whenever a watched HDL source or vendor artifact changes on disk, debounced 800ms. Bus-interface and memory-map/register comparison (Vivado only, since Platform Designer's `_hw.tcl` carries no register data) was added in a follow-up pass. ([#84](https://github.com/bleviet/ipcraft-vscode/issues/84), [#96](https://github.com/bleviet/ipcraft-vscode/issues/96), [#92](https://github.com/bleviet/ipcraft-vscode/issues/92))

### Fixed
- **Consistency Check false positives and gaps**: a series of correctness fixes found while auditing the new check against every bundled example — bus-interface physical ports (reconstructed from `physicalPrefix`/`portNameOverrides`) and interrupt ports were wrongly reported as undeclared new ports; the check silently passed when the top-level HDL file had no `managed: false` flag at all (the schema default is `managed: true`); quoted VHDL/Verilog string generic and parameter defaults were flagged as mismatched against the unquoted `.ip.yml` value even when identical; "Keep .ip.yml & Regenerate" skipped the staging/review step that "Scaffold Project" gives; a `fileSets` entry the scaffold pack has no rule for (e.g. an extra hand-authored file) vanished from the Scaffold/Regenerate review list instead of showing up as protected; and the audit also uncovered pre-existing bugs in `HwTclParser` (silently dropping `[expr ...]` bracket expressions it couldn't reduce), one-sided string-quote normalization, and conduit interfaces ignoring their own `physicalPrefix` when computing accounted-for port names. ([#93](https://github.com/bleviet/ipcraft-vscode/issues/93), [#94](https://github.com/bleviet/ipcraft-vscode/issues/94))
- **Vivado `component.xml` import/export correctness**: fixed two bugs surfaced by the new bus-interface/register comparison — `portNameOverrides` (per-signal renamed suffixes) were never passed through when generating `component.xml`, so renamed ports exported with the wrong physical names, and were never reconstructed at all when *importing* a `component.xml`; a bus interface with no common physical prefix (an empty-string prefix) lost its per-signal renames entirely on import, since the override computation only ran when a prefix was present.
- **Unsorted RTL file order in generated `component.xml`**: the `fileSets` fallback path (used when explicit RTL file list isn't supplied, e.g. import-only flows) emitted files in raw declaration order instead of compile-dependency order, unlike the equivalent Quartus `_hw.tcl` fallback — could place a register file before its package, causing simulation errors. ([#91](https://github.com/bleviet/ipcraft-vscode/issues/91))
- **Memory map indicator not opening for a per-interface `memoryMapRef`**: the canvas click-to-open handler for a bus interface's memory-map indicator only resolved the global `memoryMaps: { import }` form, never the array-of-named-maps form (`memoryMaps: [{ name, import }]`) written when a map is attached to a specific bus interface — clicking the indicator silently did nothing. ([#95](https://github.com/bleviet/ipcraft-vscode/issues/95))

## [0.8.9] - 2026-07-16

### Added
- **Generate Documentation**: a new standalone command and toolbar button that renders a full Markdown IP datasheet (`docs/<name>_datasheet.md`) covering overview, parameters, ports, bus interfaces, clocks/resets, and the register map. `IPCraft: Scaffold Project` now also emits the datasheet by default, gated by the new `ipcraft.generate.includeDocs` setting. ([#87](https://github.com/bleviet/ipcraft-vscode/issues/87))
- **Optional IP author field**: a new `author` field on the IP core, shown in the canvas Inspector's Details section and as a third block-header subtitle (visible only when set); flows into generated file headers and Platform Designer's legacy `AUTHOR` property. ([#86](https://github.com/bleviet/ipcraft-vscode/issues/86))
- **Report Issue / Send Feedback button**: a feedback button in the IP Core editor toolbar and the Memory Map editor sidebar strip opens VS Code's native issue reporter (pre-filled with extension/VS Code/OS versions), and the same action is now offered alongside "Show Logs" whenever an error notification is shown. No GitHub token or secrets are stored in the extension — submission happens through the user's browser. ([#85](https://github.com/bleviet/ipcraft-vscode/issues/85))

## [0.8.8] - 2026-07-14

### Added
- **`ipcraft` CLI**: a new standalone `ipcraft` command-line tool (`npx ipcraft generate ...`) that runs the same generator as the extension without needing VS Code or a built extension source tree. ([#72](https://github.com/bleviet/ipcraft-vscode/issues/72))
- **`ipcraft verify`**: regenerates a `.ip.yml` in memory and diffs it against what's actually committed in a generated directory, listing every stale or missing file and exiting non-zero on drift — a CI/pre-commit gate for "generated output matches the current spec". ([#73](https://github.com/bleviet/ipcraft-vscode/issues/73))
- **`IPCraft: Check HDL Consistency (managed:false)`**: cross-references a `.ip.yml`'s declared ports/clocks/resets/parameters against its `managed: false` top-level HDL. ([#74](https://github.com/bleviet/ipcraft-vscode/issues/74))
- `fileSets` entries marked `managed: false` that collide with a scaffold target are now never (re)generated, even on the very first run, instead of only once the file already exists on disk. ([#75](https://github.com/bleviet/ipcraft-vscode/issues/75))
- `simulation.topLevel` in `.ip.yml` now overrides the generated cocotb testbench's `TOPLEVEL` (e.g. to point at a board wrapper), defaulting to the IP core's own name. ([#78](https://github.com/bleviet/ipcraft-vscode/issues/78))

### Fixed
- **Quartus HDL input-version misconfiguration**: `quartus_project.tcl` unconditionally emitted a VHDL-2008 input-version assignment even for pure-SystemVerilog designs, which Quartus 23.1std rejects for mixed/SV-only projects. Now derives VHDL/SV presence from the actual RTL file list and emits the correct assignment(s) — `VERILOG_INPUT_VERSION SYSTEMVERILOG_2005` for SV, `VHDL_INPUT_VERSION VHDL_2008` for VHDL, or both for mixed-language designs. ([#76](https://github.com/bleviet/ipcraft-vscode/issues/76))
- **Bus-less generated output hygiene**: `_hw.tcl` no longer claims an "Avalon-MM slave interface for register access" in its header comment for components with no memory-mapped slave (e.g. clock + reset + one conduit), and the generated Quartus SDC no longer emits `derive_pll_clocks` for designs with no PLL instantiated — both were previously unconditional. ([#77](https://github.com/bleviet/ipcraft-vscode/issues/77))
- **HDL Consistency Check and `ipcraft verify` refinements**: a file listed in more than one `fileSet` no longer produces duplicate findings; when several `managed: false` HDL files exist, only the one whose entity/module name matches the IP core's name is checked against the full port/clock/reset/parameter list (falling back to checking every file when the top-level can't be identified), so a hand-authored submodule that doesn't expose the top-level interface no longer produces false missing-port findings; `ipcraft verify` now also scans for files left behind in a directory after a `--target` is dropped (previously invisible, since the scan only walked directories the *current* invocation's target list touches); and a schema-invalid `.ip.yml` with an undefined name can no longer spuriously "match" an unparseable HDL file as the top-level.

## [0.8.7] - 2026-07-12

### Added
- **Hardware-validated example projects** (`examples/`): three full IPCraft-generated example projects — a minimal Avalon-MM LED peripheral, and register/field-access conformance suites over Avalon-MM and AXI4-Lite — validated end-to-end on real DE10-Nano hardware. They double as generator regression fixtures.

### Fixed
- **SLVERR not returned for unmapped AXI-Lite reads**: the generated AXI-Lite bus wrapper's register bank asserted `rd_valid` on every `rd_en` regardless of address validity, so the SLVERR path was dead code and reads to unmapped addresses returned `RRESP=OKAY` with zero data instead of `RRESP=SLVERR`. Fixed in both the VHDL and SystemVerilog templates to match the already-correct write-response behavior. (Fixes [#59](https://github.com/bleviet/ipcraft-vscode/issues/59))
- **Reset-value overflow and WORD-addressed Avalon-MM slave bugs**: a 32-bit `resetValue` at or above `0x80000000` overflowed VHDL's signed 32-bit `integer`/`natural` default type and failed GHDL elaboration; fixed by emitting a fixed-width bit-string literal instead. Separately, an Avalon-MM slave whose address port is narrowed via `portWidthOverrides` (for Nios II-compatible WORDS addressing) produced an out-of-range VHDL slice; fixed by zero-padding instead of slicing, with a companion fix so the generated `_hw.tcl` correctly declares `addressUnits WORDS` to match.
- **Stale RTL files leaking into vendor packaging on a language switch**: regenerating an IP in a different `ipcraft.generate.hdlLanguage` than its existing `fileSets` entries (e.g. re-running in SystemVerilog when `fileSets` still names `.vhd` files) pulled the stale files back in alongside the freshly generated ones, corrupting the resulting Makefile/`component.xml`/Vivado/Quartus project scripts. `fileSets`-declared paths are now deduplicated against freshly generated output by path stem, ignoring extension.

### Changed
- Packaged `.vsix` no longer includes dev-only files (`build/`, `docker/`, `Jenkinsfile`, `AGENTS.md`, `CLAUDE.md`) or the `.test-fixtures/`/`examples/` directories, reducing package size.

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
