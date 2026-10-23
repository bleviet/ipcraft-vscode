# Release Notes

What's new in each IPCraft release. Entries under **Before you upgrade** need
attention when you update, for example because generated files change.

Contributors: the technical changelog, with modules, issues and pull requests,
is in [docs/contributing/changelog.md](docs/contributing/changelog.md).

## [Unreleased]

### Fixed

- **Avalon-MM registers decode at the right address when the address port is narrower than the register map.** With `portWidthOverrides: { address: 2 }` (a word-addressed slave, as the Nios II needs), a two-register map placed the second register at word address 2 instead of 1, so software writing `base + 4` missed it. The old VHDL wrapper was right only when the port was exactly as many bits narrower than the register file's address as the byte lane is wide (2 bits for 32-bit data), so it depended on the number of registers. The SystemVerilog wrapper was wrong for every narrow port (the upper address bits were undefined). The generated wrapper now shifts the word address by the width of a data word for any register count and address width, in VHDL and SystemVerilog, including a 1-bit address port. Byte-addressed slaves are unchanged.
- **The generated cocotb testbench of a word-addressed Avalon-MM slave drives word addresses.** It always used byte offsets, which cocotb 2.x rejects with `Int value (4) out of range for assignment of 2-bit signal`, and which would hit the wrong register on a wider port. Its reads past the last register also stay within the addresses the narrow port can carry.
- **Generate lists the generated files in the same order every time.** The `fileSets` block that Generate adds to your `.ip.yml` was ordered by which file finished writing first, so regenerating could reorder it and show a change in version control. The order is now fixed.
- **The generated pytest wrapper of a register-mapped core runs the simulation.** `pytest tb/` and the VS Code Testing view reported `test_register_access` as passed, but it ran no test: it selected a cocotb test that does not exist (`test_register_semantics` is the real one), and cocotb only printed `No tests left after filtering`. The wrapper now runs `test_register_semantics`. Regenerate your core to get it, and run `pytest -k test_register_semantics` to run the test alone.
- **The heartbeat of the `led_avmm` example and the tutorial toggles every 0.67 s, as documented.** It toggled twice as fast, about 1.5 Hz instead of 0.75 Hz, because the divider was one bit too narrow.
- **`debug_console.py write` in the `led_avmm` example and the tutorial checks a write-1-to-clear register correctly.** Writing `0x2` to `EVENTS` cleared the flag, but the script read the register back in a second System Console session several seconds later and compared it with the written value, so it printed `[FAIL]` whenever the heartbeat had set the flag again. It now reads back in the same session and checks only the bits a write can change: read-write fields must read what was written, and a write-1-to-clear flag written with 1 must read 0. A write to read-only bits only reports `not checked`. If the heartbeat sets the flag again between the write and the read, which takes milliseconds against 0.67 s, it still prints `[FAIL]`.

### Before you upgrade

- Regenerate any IP core with a narrow `portWidthOverrides.address`, for example the `led_avmm` example: the wrapper's address logic and the testbench's addresses change. Every SystemVerilog wrapper and every generated testbench for such a core was wrong before.

## [1.6.2] - 2026-11-22

### New

- **See the resource usage of each block in the system viewer.** Turn on **Resources** to show the LUTs, FFs, BRAM and DSPs (Vivado) or ALMs, registers, memory blocks and DSPs (Quartus) of every block of a block design or Platform Designer system, from a synthesis, out-of-context or post-route report, or a Quartus fitter report. The viewer finds the reports of the Vivado or Quartus project next to the design, and you can attach a report from anywhere, for example one downloaded from a CI build, with **Attach Report...** or **IPCraft: Attach Resource Report**. A **Resources** tab lists every block, sortable, together with the logic the tool generated and the logic outside the design. Reports of AMD 7-series and Zynq-7000 devices (Vivado 2019.1 and later) and of Intel devices with ALMs, such as Cyclone V, are read in full, and so are those of AMD UltraScale and UltraScale+ devices, such as Kintex UltraScale and Zynq UltraScale+ (tested with Vivado 2024.2 reports). See [Viewing a System Design](docs/how-to/view-a-system-design.md#resource-usage).
- **Extract a per-block report from a Vivado checkpoint.** When a Vivado run has no hierarchical utilization report, select its checkpoint in the Resources tab and click **Extract**: IPCraft opens the checkpoint in Vivado in batch mode, without running synthesis or implementation again, and keeps the report in the extension's storage. This also fills in the IPs whose out-of-context run was an IP cache hit. **Compare with** shows two stages, for example post-synthesis and post-route, side by side in Details, and the change next to each number in the Resources tab.
- **Resource usage in exported images.** **Export image** draws the resource numbers above the blocks while Resources is on. Every block shows its share of the design and of the device next to its numbers, and the Resources tab shows the share of the device next to every number.
- **See the numbers of your own IP cores' builds in the system viewer.** For the blocks defined by an `.ip.yml`, the Resources tab offers **IPCraft builds**: the results of each IP core's IPCraft Build (Vivado out-of-context or full run, or Quartus compile), shown on its block. You can also attach the report of an IP core built on its own, for example by a CI job: when its top level is the IP of a block, its numbers show on every block of that IP.
- **Resource usage on the command line.** `ipcraft resources <design> <report>...` writes the resource usage of every block as Markdown or JSON, for example in a CI job after synthesis, and `ipcraft render --resources <report>` draws it on the diagram image. See [Command Line](docs/reference/command-line.md#report-the-resource-usage-of-a-system-design).
- **Trace a port of a hierarchy block to where it is connected.** In the system viewer, right-click a port of the level you opened (an input or output of the subsystem) and choose **Trace Signal**: the viewer goes to the highest level the wire reaches through the hierarchy above the port, selects it so the whole connection is highlighted, expands the subsystems the wire passes through so the whole path is visible, and centres the block it enters with its pin marked, zooming out when needed so the whole expanded block is in view. Selecting such a port also shows its **Connection tree** in Details, from the driver through every level above and below, with the port marked `THIS PORT`; click a net or pin in the tree to go to its level. A port with no connection on the level above says so, and Trace Signal is disabled for a port on no wire.

### Changed

- **System diagrams have more room between blocks.** Blocks stand further apart, and expanded subsystems leave more space above their blocks, to make room for the resource numbers. Exported images and `ipcraft render` output change even when Resources is off.
- **The IP core editor matches the system viewer's look.** Clocks are now orange, resets red and interrupts purple, as in the system viewer, on the canvas, in the inspector and in exported images. A bus interface connects to the block with a small square, a signal with a small circle, and the block header is a neutral band with the core name in the editor's UI font.
- **Clock domains have the system viewer's colors.** With several clocks, the IP core editor colors each clock domain with the same theme colors as the system viewer, on the canvas and in exported images.

### Fixed

- **A Vivado or Quartus run that cannot start no longer waits forever.** When a vendor tool failed to start (for example because a library was missing), it waited for input and the build kept running until you cancelled it. It now ends at once and the build reports the failure.
- **Connection, clock and reset trees no longer list wires that only the base of a comparison has.** With a comparison on and removed items shown, the tree of a net in Details followed a removed wire, for example the old wire of a rewired hierarchy pin, as if it were part of the open design.
- **Quartus build results show timing and utilization.** After a Quartus Build, the reports tree showed no timing or utilization, or reported timing as met for a design that failed it. It now reads the real Quartus reports and shows the maximum clock frequency (Fmax), whether timing passes, and the logic, register, memory and DSP usage on devices with ALMs, such as Cyclone V and Arria; on MAX 10 and Cyclone IV only the register count is read. Timing passes only when every slack in every corner, including recovery, removal and minimum pulse width, is zero or better.
- **The timing constraints of a generated Quartus project are applied.** The project could not find its `.sdc` file, so Quartus analysed every clock at its 1 GHz default and reported failing timing for a design that meets it at the clock you declared. The project also wrote its reports to `altera/build/` instead of `altera/build/output_files/`, where IPCraft and the documentation expect them.
- **Vivado build results show the device totals.** After a Vivado Build, the utilization in the reports tree showed an available device total of 0 for LUTs, registers, block RAM and DSPs, so no share of the device could be computed. It now shows the real totals, a row whose share is written as `<0.01` is no longer skipped, and on UltraScale and UltraScale+ devices it counts all LUTs and registers, not only the logic LUTs.
- **Check Consistency opens the Issues panel again.** Clicking Check Consistency in the IP core editor's toolbar opens the Issues panel when it finds differences, with the findings listed under their source.
- **The Issues panel keeps the inspector's width.** In the IP core editor, the Issues panel no longer grows with its longest message and covers the canvas. It has the width of the inspector, you can resize it the same way, and long messages wrap.

### Before you upgrade

- If you commit images made with **Export image**, `ipcraft render` or `ipcraft diff --image`, expect them to change: the layout has more room between blocks.
- Regenerate the Quartus project files of your existing IP cores (the `<name>_project.tcl` in `altera/`) so Quartus builds apply the `.sdc` file and write their reports to `altera/build/output_files/`. Until then, builds keep the old behavior and IPCraft cannot show their results.

## [1.6.1] - 2026-11-20

### New

- **See search results in a list under the search box in the system viewer.** As you type, a list opens under the box with the matching blocks grouped by level and a summary such as `5 matches in 3 levels`; click a row to go to that block. Up and Down step through the list while it is open (and through your earlier searches otherwise), and Enter, Shift+Enter and the counter follow its order. Long lists scroll, and above 20 matches the groups are collapsed except the one you are on. Escape or leaving the box closes it.
- **Hierarchy blocks show how many matches they hold.** While you search, a hierarchy block, collapsed or expanded in place, that has matching blocks inside is no longer dimmed and shows a badge such as `3 matches inside` (`99+` above 99).
- **Follow a data or bus connection through the hierarchy.** Selecting a data or interface net that continues into or out of a hierarchy block now selects the whole connection on every level, as for a clock or reset net: its pins and badges are highlighted on every level, the blocks it does not touch are dimmed, and Details shows a **Connection tree** with the driver and the nets it reaches level by level, through hierarchy pins and ports.
- **Expand the selected hierarchy block with Space.** In the system viewer, Space expands the selected hierarchy block in place, or collapses it again, like its **+** and **-** button.

## [1.6.0] - 2026-11-15

### New

- **Post the system design diff on a pull request.** A GitHub Action in this repository (`actions/system-design-diff`) runs `ipcraft diff` for the designs you list and posts one comment with the changes and findings, updated on each push; it can fail the job on any change or on new findings. See [Review system design changes in CI](https://github.com/bleviet/ipcraft-vscode/blob/main/docs/how-to/review-system-design-changes-in-ci.md). ([#302](https://github.com/bleviet/ipcraft-vscode/issues/302))

- **Compare a system design with another revision in the system viewer.** Click **Compare** in the toolbar (or run **IPCraft: Compare System Design with...**) and pick another open design, HEAD, the merge base with `main`, one of the commits that changed the file, a branch or tag, a revision you type, or another file. The open file is the current side and the pick is the base; the tab says so in a bar that stays in view (`Base HEAD → Current system.bd`), and **Swap** compares the other way round when the base is a file. A new **Changes** tab lists the added, removed and changed blocks, parameters, connections, external ports and address segments, with the toolbar showing the counts. Click a row to go to its block; the list follows your edits, and **Exit compare** ends it. The diagram marks the added, changed, renamed and version-only blocks and external ports, their changed pins and the new wires, with a sign next to each color, counts the changes inside a hierarchy block, and shows them in the outline, the legend and a **Changes** section of Details. **Marks** hides them, **Changes only** shows just the changed blocks and what they connect to; removed blocks, ports and wires are drawn as dashed ghosts with a `−` (see below) and listed in the Changes tab. **Export image** draws the marks while Marks is on, and the change entries of the legend when the legend is included. A **Findings** tab lists the unconnected pins and the clock or reset crossings that are new or resolved compared with the base; click a row to go to its block. The **Address map** tab marks the added, changed and removed segments. A **Show version-only changes** button (the `v`, shown when a block's only change is its IP version) hides those blocks from the marks, the counts and the Changes tab, and from exported images, like `ipcraft diff --ignore-version-only`. When the base is a git revision, its blocks are checked with the `.ip.yml`, HDL and `.qsys` definitions as they were at that revision, and the Findings tab says so. A **Show removed** button (the `−`) shows or hides the ghosts of what only the base has (a removed block, port or wire, or the old wire of a rewired pin), dashed in the removed color with the name struck through; the diagram is laid out with them, so blocks can move once when a comparison starts but never when you press a toggle. Exported images (while Show removed is on) and `ipcraft diff --image` draw the ghosts too. ([#302](https://github.com/bleviet/ipcraft-vscode/issues/302))
- **See what changed between two revisions of a system design from the command line.** `ipcraft diff bd/system.bd --base HEAD` compares a Vivado block design or a Platform Designer system with an earlier git revision (or with another file) and reports the added, removed and changed blocks, parameters, connections, external ports and address segments as Markdown for a pull request comment, or as JSON with `--format json`. The order of blocks, net names, line numbers and tool metadata do not count as changes, and `--ignore-version-only` hides blocks whose only change is the IP version. Nothing is executed. The JSON report also says which peers a changed pin gained and lost. The report also lists the findings that are new or resolved between the two revisions: pins that no net touches, and data or resets that cross into another clock domain without a known synchronizer. With `--fail-on changes` or `--fail-on new-findings` the command exits with 1 on any change or on new findings respectively, so a CI job can fail on them. With `--image changes.png` (or `.svg`, `.jpg`) the command also draws the top level of the current revision with the changes marked: borders and signs on added, changed and renamed blocks, new wires in color, removed blocks, ports, pins and wires drawn as dashed ghosts, and a legend that names `− Removed` and `Removed wire`. A file that did not exist at the base revision shows everything as added, and a file that was renamed since is read under its old path, in the command and in the system viewer. ([#302](https://github.com/bleviet/ipcraft-vscode/issues/302))
- **A renamed block is one change in the system design comparison.** When a block has only been renamed (a fixed typo in its name, say), the **Changes** tab and `ipcraft diff` show one `→` row with the old and the new name and the characters that differ emphasised, instead of a removed and an added block and a row for each address segment and connection that carries the name. It applies to a block with the same type, parameters, pins and connections in the same level; a block that was also changed still shows as removed and added. A block that only moved to another level, with the same name and contents, is one `»` row too: the old and the new path, then the connections the move rewired. ([#302](https://github.com/bleviet/ipcraft-vscode/issues/302))
- **Open Vivado `.bd` block design files in the system viewer.** A `.bd` file saved by Vivado 2018.3 or later opens as a read-only diagram, with hierarchy, connections and address map, without Vivado and without exporting a Tcl script first. Unconnected ports are checked on module references, which the file lists completely. The `.bd` files of earlier releases (XML) are not supported. ([#300](https://github.com/bleviet/ipcraft-vscode/issues/300))
- **See every search result at once in the system viewer.** While you search, the outline lists only the matching blocks under their hierarchy blocks, on every level, so you can see where each match sits; click one to go to it. The outline opens when you start a search and returns to the full design when you clear it. ([#298](https://github.com/bleviet/ipcraft-vscode/issues/298))
- **Search options in the system viewer.** **Match Case** and **Match Whole Word** buttons next to the search box narrow the matches, and `*` (any characters) and `?` (one character) work as wildcards, for example `axi*fifo`. With **Match Whole Word**, `count` finds a block named `count` but not `count_0`. ([#298](https://github.com/bleviet/ipcraft-vscode/issues/298))
- **Filter the bottom panel of the system viewer.** A box at the right of the **Address map**, **Clocks**, **Resets** and **Unconnected** tabs lists only the rows of the tab on show that contain its text, with the same `*` and `?` wildcards. Each tab keeps its own filter. ([#298](https://github.com/bleviet/ipcraft-vscode/issues/298))

## [1.5.3] - 2026-11-10

### New

- **Blocks defined elsewhere are shown as black boxes.** The system viewer, **Export image** and `ipcraft render` no longer drop a block that the design uses but does not define, for example a hierarchy created by a `create_hier_cell_*` procedure in a sourced Tcl file, or a Platform Designer module that is not declared. The block is drawn with a dashed border and the label **Black box**, with the pins and connections seen in the file, and a warning lists it. ([#291](https://github.com/bleviet/ipcraft-vscode/issues/291))
- **Describe what the bits of a port carry.** In `.ip.yml`, a port, a conduit port or a bus interface port (for example AXI-Stream `TDATA`) can list named bit fields with a description and enumerated values, in the same format as register fields. Generated code does not change. The IP core editor warns in a new **Port fields** group when a field is outside the port, overlaps another or has an enum value that does not fit, and keeps the fields when you group ports into a bus interface or ungroup them. Files edited with this version declare `apiVersion` 1.2.
- **Import a port's fields into the Data Inspector.** The layout picker lists ports with field metadata next to registers, and **IPCraft: Open Register or Port in Data Inspector** (formerly **Open Register in Data Inspector**) opens either.

### Changed

- **External ports sit in two columns.** In the system viewer, **Export image** and `ipcraft render`, the input ports of the shown level are now a column on the left of every block, and the output and bidirectional ports a column on the right, instead of landing somewhere inside the design. Ports of unknown direction go to the right column. The diagram can be a little wider. A Platform Designer conduit export is an input (`conduit end`) or an output (`conduit start`), unless the exporting component's `.ip.yml` shows that all its conduit signals are outputs or all are inputs; then the export follows that direction. An `.ip.yml` conduit whose signals are all inputs or all outputs now has a direction, which can change which pin drives a conduit net (wire direction and block placement) and whether an unconnected conduit pin is reported as undriven or unused.

### Fixed

- **System diagrams open without waiting for the workspace scan.** The first time a design is opened in a window, the diagram now appears as soon as the file is read, with a note that workspace definitions are still loading; pins and definitions from `.ip.yml` and HDL files fill in when they are ready. Opening a design again is unchanged.
- **The workspace scan skips excluded and generated folders.** Finding `.ip.yml`, HDL and `.qsys` files for the system viewer no longer reads files in folders excluded by `search.exclude` or generated by Vivado (`.Xil`, `*.gen`, `*.runs`, `*.sim`, `*.cache`, `*.ip_user_files`), so large workspaces scan much faster and those folders no longer push real definitions past the file limit.

### Before you upgrade

- An `.ip.yml` you edit with this version is stamped `apiVersion` 1.2, with or without port field metadata. Older IPCraft versions, including an older `ipcraft` CLI on a build machine, refuse to open it with an "upgrade IPCraft" message, so update IPCraft wherever these files are used. `ipcraft migrate` upgrades files explicitly.

## [1.5.2] - 2026-11-09

### Changed

- **Clock and reset nets are drawn as wires.** The system viewer, **Export image** and `ipcraft render` now draw each clock and reset net as a wire from its driver to every load, routed around the blocks, with a dot where a branch leaves the wire. The net-name badges stay as labels at the wire ends, and the blocks are still placed by their data flow.
- **Expanding a block keeps it under the pointer.** Expanding or collapsing a hierarchy block in place no longer makes it jump away from the **+** or **-** button you clicked; the view follows the block.

## [1.5.1] - 2026-11-09

### Fixed

- **Highlighted wires stand out.** A highlighted wire is now as thick as a selected one, with a soft glow in its color, and is drawn above other wires; clock and reset badges of a highlighted net take its color.

## [1.5.0] - 2026-11-08

### New

- **Navigate VHDL across all your IP cores.** **IPCraft: Generate vhdl_ls.toml** (or `ipcraft vhdl-ls` in a terminal) writes the configuration the VHDL-LS language server needs, from the Vivado and Quartus projects, `component.xml`, `_hw.tcl` and `.ip.yml` files in your repository, so go to definition and find references work across cores. Generated output and template files are left out, testbenches that reuse unit names get a library each, and a unit used through `work` is found even when another library holds it. Libraries IPCraft cannot find, such as OSVVM or UNISIM, are proposed as comments for you to fill in, naming only the folders that provide the units used and the duplicate copies to exclude.
- **Export a diagram as an image.** The system viewer and the IP core editor have an **Export image** button (and the command **IPCraft: Export Diagram as Image**) that saves the diagram as SVG, PNG or JPG: the current view or the whole level or symbol, Light or Dark, with or without the grid and legend, at 1x to 4x. It draws exactly what `ipcraft render` draws, never moves the diagram, and remembers your options per workspace.
- **Images use the definitions in your workspace.** `ipcraft render design.tcl --out image.svg` now fills in the pins of blocks from the `.ip.yml` and HDL files next to the design, and opens Platform Designer subsystems, as the system viewer does. `--workspace <folder>` searches another folder; `--no-workspace` draws the design exactly as the file declares it.
- **Render many images from one file.** `ipcraft render --manifest docs/images.yml` draws every image listed in the manifest, with shared defaults, in one run. A mistake in one entry is reported with its position and the other images are still written.
- **Images of part of a design, and of its clock domains.** `ipcraft render design.tcl --out image.png --select axi_dma_0 --hops 2` draws a block (or an external port, as `port:name`) with the blocks up to 2 connections away, like the viewer's isolated view; `--highlight` outlines blocks without hiding the rest, and `--clocks` adds the Clocks and resets view: pins colored by clock domain, frequencies, and clock domain crossings in dashed warning color.
- **PNG and JPG images from the command line.** `ipcraft render design.tcl --out image.png` (or `.jpg`) now writes a raster image of a system design or an IP core symbol, with `--scale` (1 to 4, default 2) for the size and `--quality` (1 to 100, default 90) for JPG. The text uses the same IBM Plex fonts as the SVG, and the same command always gives the same file. A JPG cannot be transparent; use PNG with `--background transparent`.
- **Draw an IP core symbol as an image from the command line.** `ipcraft render core.ip.yml --out core.svg` draws the block the IP core editor shows (ports, bus interfaces, generics, dependencies and description) as an SVG image for documentation, in a light (default) or dark palette, with or without the grid. The same command always gives the same file.
- **Draw a system design as an image from the command line.** `ipcraft render design.tcl --out image.svg` draws a level of a Vivado block design or a Platform Designer system as an SVG image you can drop into documentation, in a light (default) or dark palette, with or without the grid and legend, and with chosen hierarchy blocks expanded. The same command always gives the same file, so committed images only change when the design does.
- **Grow an isolated view one step at a time.** In an isolated view, + and - in the toolbar show the blocks one more or one fewer connection away, until everything connected is on screen. The + and - keys do the same while the canvas has focus.
- **Minimap.** Turn on **Minimap** in the system viewer toolbar to see the whole level in a corner while you work zoomed in, and click or drag on it to move around.
- **Readable when zoomed out.** Far out, the system viewer hides pin and port names and other small text, and enlarges block names so you can still tell the blocks apart. Turn off **Simplify zoomed out** in the toolbar to show everything at every zoom.
- **Expand a hierarchy block in place in the system viewer.** Click + in the block header, or right-click and choose Expand In-Place, to show its contents inside a frame on the current level. Click - or choose Collapse to fold it again. Double-clicking still opens the block.
- **Highlight parts of a design.** Ctrl+Click (Cmd+Click on macOS) selects several blocks, ports and wires; right-click and choose Highlight to mark them in one of six colors. Highlights are remembered per design file, and a toolbar chip counts them and clears them all.
- **Find unconnected pins.** Turn on Unconnected pins to mark pins that nothing connects to: inputs that nothing drives in the warning color, unused outputs muted. The Unconnected tab lists them; clicking a pin zooms in to its block. Only blocks whose pins are known (from an `.ip.yml`, an HDL file, a hierarchy or an external port) are checked.
- **See clock and reset domains.** The Clocks and resets button colors clock and reset pins by domain, shows the clock frequencies set in the design, and marks clock and reset domain crossings (CDC and RDC). Select a clock or reset net to see its whole tree in Details. The new Clocks and Resets tabs list the domains, reset sources and crossings on screen; click a row to zoom to it, or click the count next to the button to open the Clocks tab. IPCraft never guesses a clock from a pin name: anything it cannot determine is listed as not checked.
- **Find with the usual keys.** Ctrl+F (Cmd+F on macOS) jumps to search, filled in with the name of the selected block. F3 and Shift+F3 go to the next and previous match.
- **Search history.** Up and Down in the system viewer search box go through your earlier searches, as in the VS Code find box.
- **Mouse forward button.** After going up a level with the mouse back button, the forward button takes you back down, one level at a time.

### Changed

- **A tidier toolbar.** The system viewer toolbar has icon buttons in labelled groups, Design, View and Panels, like the IP core editor. Hover a button to see its name.
- **Shorter, clearer wiring.** Blocks are placed next to the blocks they exchange data with, external ports sit next to the block they connect to, and clock and reset nets are shown as name badges on their pins instead of long wires. Large designs open much faster.
- **Blocks stand out from the canvas.** Blocks have a stronger outline, a tinted body and a light shadow in light and dark themes. Wires are lighter until you select or highlight them.
- Known outputs of common AMD IP blocks are drawn on the right side of the block.
- The Problems tab is gone. It listed what the viewer could not work out from the files, which read like faults in your design. Details still says what the offline view cannot know.

### Fixed

- Large designs in the system viewer respond faster when you search, select blocks and zoom.
- The system viewer fills the whole editor; there were empty strips on its left and right.
- Blocks, zoom and pan no longer jump when you turn Clocks and resets or Unconnected pins on or off.

## [1.4.0] - 2026-11-06

### New

- **Isolate blocks in the system viewer.** Ctrl+Click (Cmd+Click on macOS) to select several blocks and ports, then right-click and choose Isolate Selected. Only those blocks, their wires and the blocks at the other end remain, laid out compactly. Show All brings back the full view where you left it.
- **Mouse back button goes up a level**, like clicking the parent in the breadcrumb.
- **Step through search results.** Enter and Shift+Enter in the search box go to the next and previous match on any level, centering it and zooming in if needed. A counter shows where you are, and Escape clears the search.

### Changed

- **Refreshed system viewer look.** Blocks have a header band, hierarchy blocks a dashed outline, and clock and reset labels are quieter. A legend explains the wire colors, the side panels follow your VS Code theme, and addresses are easier to read. Pins sit on the block border; unconnected pins are shown hollow and pins on the selected net bold.

## [1.3.1] - 2026-11-06

### New

- **Open Platform Designer subsystems.** A `.qsys` module that is itself another `.qsys` file in your workspace becomes a level you can double-click into, including nested subsystems. Its blocks show the same pins as top-level blocks, and go-to-source opens the subsystem file at the right line.

## [1.3.0] - 2026-11-05

### New

- **System viewer.** Run **IPCraft: Open as System Diagram**, or press Ctrl+Shift+V (Cmd+Shift+V on macOS) on a `.tcl` or `.qsys` file, to see a Vivado block design script (`write_bd_tcl`), a Platform Designer system (`.qsys`) or a Platform Designer system script as a read-only diagram. The files are only read, never run, so you need no vendor tool or license. Browse one level at a time with an outline, search, details and an address map. `.ip.yml` and HDL files in your workspace fill in pins, directions and interface types, with a link to where each block is defined. See [Viewing a System Design](docs/how-to/view-a-system-design.md).

### Changed

- **Bus ports follow the protocol specifications.** AXI4-Stream `TREADY`, Avalon-ST `valid`, and AXI4-Lite and AXI4 `AWPROT`/`ARPROT` are now optional and generated only when listed in `useOptionalPorts`. IPCraft also rejects port sets that cannot work, such as an Avalon-MM `read` without `readdata` or an AXI4 `AWLEN` without `WLAST`.

### Before you upgrade

- If an interface relied on `TREADY`, `valid`, `AWPROT` or `ARPROT` being generated automatically, add them to its `useOptionalPorts` to keep them; otherwise the generated HDL, `component.xml` and `_hw.tcl` no longer have them. An Avalon-MM or AXI4 interface with an incomplete port set now fails validation until you add the missing port.

### Added

- **A version scheme for IP cores.** The IP Core editor has a **Version scheme** selector above the Version field. `vlnv.versionScheme` is `free` (any text, the default), `major.minor`, `major.minor.patch` or `major.feature.minor.patch`; each numeric component is 0 to 255 (8 bits). Switching the scheme never rewrites `vlnv.version`; a version that no longer fits is flagged under the field. Selecting Free text removes the `versionScheme` key.
- **`$version` register references.** A bit field's or a fieldless register's `resetValue` can be `$version` (the packed version, 8 bits per component, major first) or `$version.major`, `.feature`, `.minor`, `.patch`. The Memory Map editor accepts the token in the Reset cell and, for a fieldless register, in the Value bar, shows the resolved value next to it, and reports misplaced references (scheme, width, register arrays, several version registers). Generated HDL, `component.xml`, the datasheet and the verification manifest treat the field as a read-only constant that is not a hardware input. The file keeps the token, so a version bump never edits the memory map. The how-to guide "Versioning Register Sets" walks through it. `$version.crc8` and `$version.crc16` hold a CRC over the version bytes (CRC-8/I-432-1 and CRC-16/IBM-3740; the components, one byte each, or the UTF-8 bytes of a free-text version), so a driver can check the version register; they are the only references a free-text version supports, and version 0 never gives a CRC of 0. A field with a CRC reference is exactly 8 or 16 bits wide. Adding bit fields to a register that carries a register-level reference removes that reference in the same update, whether you insert from the keyboard, the hover bar, the context menu or Shift+drag in the visualizer, and a Value bar commit clears a reference left next to bit fields. The Value bar accepts any reference on a register without fields, and on a register with fields points to the bit field's Reset cell instead of reporting an invalid number.
- **Register-set version history.** A memory map can record each released version and the register layout it shipped with in `versionHistory` (a hash-keyed set of layout snapshots plus a version list). Maps with a `versionHistory` or a `$version` reference are checked before every generate command: a changed layout asks to **Adopt** it as a new version (asking for a new `vlnv.version` when the current one is already recorded) or, when the current version is recorded, to **Overwrite** its layout; dismissing cancels without writing. A design whose `$version` references generation rejects is not recorded: nothing is prompted or written and generation reports the errors. **IPCraft: Start Register-Set Versioning** records the first entry, and `ipcraft generate --register-set-policy adopt|overwrite` does the same headlessly. The editor and the generator warn when the version register moves or its fields change since a recorded version. Every version entry written records the `crc8` and `crc16` of its version under the core's scheme (existing entries stay as they are), and the generated datasheet's Version section lists them.

- **Vendor extension keys in memory maps.** Keys starting with `x-` on a register or bit field of an
  `.mm.yml` are kept: the editor writes them back unchanged, and templates read them from the new
  `extensions` object of each register and field in `memory_maps` (for example
  `reg.extensions['x-readSideEffect']`). IPCraft itself does not interpret them, and they are not part
  of the register-set layout hash.
- **Recorded register layouts for templates.** Each map in `memory_maps` has `versions`: every version of
  its `versionHistory`, oldest first, with the layout it shipped with as `address_blocks`, normalized like
  the map itself and with `$version` references resolved for that version. Registers and fields of
  `memory_maps` also carry `version_ref` (the reference of a constant, `null` otherwise). A pack can so
  describe older hardware versions, for example for a driver that picks the layout by the version it
  reads. The template context contract is now 1.8.0 (additive).

### Changed

- The IP Core editor's Version field validates against the selected scheme. Free text accepts any non-empty text instead of requiring `X.Y.Z`.
- Vivado XGUI file names replace every character other than letters, digits and `_` in the version with `_`, so a free-text version cannot produce an invalid file name. Numeric versions such as `1.2.0` still give `1_2_0`. Generating for Vivado or Quartus with a version that is not dotted numbers now warns that the tool may reject it.
- `ipcraft verify` lists the individual issues of a blocked generation instead of only the summary line.
- **Registered AXI-Lite register writes (VHDL).** The AXI-Lite wrapper registers the write enable (`wr_en_q`) and sets
  the new generic `G_REG_WRITE` of the register bank, which then decodes the address into one write-select flip-flop per
  register (`wr_sel_q`) and writes the register one cycle later; BVALID comes with that write (`wr_en_qq`), two cycles
  later than before. The register enable is a single select flip-flop, so the bank closes timing at 400 MHz. The
  address, data and strobe latches (`awaddr_int`, `wdata_latch`, `wstrb_latch`) stay stable until the B handshake;
  an IP that runs at such clock rates can relax the paths from them with a scoped multicycle constraint.
  `G_REG_WRITE = false` (the default of the bank) keeps the write in the cycle of `wr_en`.

### Fixed

- **The register Value bar no longer drops a value silently.** On a register without bit fields the value is stored in the register's own `resetValue`, which is what the generators read. On a register with fields, a value with a set bit that no field covers is rejected with `Bits <ranges> are not covered by a bit field` instead of being partly written.
- The Reset cell shows `Invalid number` for text it cannot parse, such as `A` or `FF`, instead of silently keeping a draft that never reaches the document.

### Compatibility

- `apiVersion: "1.2"` is not tied to `vlnv.versionScheme`: nothing checks one against the other. `ipcraft migrate` and the IP Core editor's first-edit format upgrade (once the bus library is loaded) stamp `1.2` on every older `.ip.yml`, after which IPCraft 1.2.0 refuses the file. The template context contract is now 1.6.0 and adds `is_constant` and `version_ref` per field and register, the `constant` value of `read_source`, and `version_scheme`, `version_history` and `version_file_suffix`. The keys are additive, so custom packs declaring `apiVersion: "^1.x"` keep working.
- `ipcraft generate` and `ipcraft verify` fail for a versioned memory map that is not up to date. `generate` writes the history only when `--register-set-policy` is given; `verify` never writes. Do not use versioned memory maps with an IPCraft older than this release: IPCraft 1.2.0 never schema-validates an imported `.mm.yml`, so it reads `$version.major` as `0`, ignores `versionHistory`, and silently generates the version field as an ordinary register with a reset value of `0`. Only the `.ip.yml` side fails loudly (IPCraft 1.2.0 refuses `apiVersion: "1.2"`, and its IP core schema rejects inline `$version` tokens).

## [1.2.0] - 2026-10-11

### New

- **Package an IP core with everything it needs.** **IPCraft: Package IP Core (Self-Contained)**, or `ipcraft package <ip.yml> --out <path> [--zip]`, collects an `.ip.yml` and every file it uses (memory maps, source files, bus library, subcores) into one folder or `.zip`. Files from outside the IP folder are copied in and their references updated; nothing else is changed. Missing files and conflicts are reported before anything is written.
- **Add bit fields with the mouse.** Hover between fields to get a + insert bar where a free bit exists, or use Insert Above/Below in the fields table and visualizer context menus. The new field's name is ready to type.
- **Regenerate without losing your edits.** IPCraft remembers what it last generated and can tell your hand edits from generator changes. For each changed file you can choose **Auto-merge**, **Sync interface** (update only the entity or module header), **Overwrite** or **Keep**. Hand-edited and locked files are never overwritten by default.

### Changed

- The "Generation failed" message shows the first problem found.
- New registers no longer get an explicit `access: read-write`.

### Fixed

- **Register files compile when the register `access` disagrees with its fields**, for example the old default `access: read-write` over read-only fields. The field accesses now decide; register-level `access` applies only to registers without fields.
- An IP-XACT bus definition in your workspace, such as the `avalon_mm.xml` that Vivado exports, no longer replaces IPCraft's built-in definition and turns a memory-mapped slave into a conduit. It is skipped with a warning.
- Shrinking a bit field trims its reset value, so cut-off bits do not come back when the field grows again.
- After Ctrl+Drag of a bit field, Shift+Drag resizing works again.

### Before you upgrade

- Generated HDL changes for registers whose `access` disagrees with their fields. That output did not compile before, so no working design is affected.
- Custom scaffold packs pinned to `~1.4` or exactly `1.4.0` must widen their `apiVersion` range. Packs declaring `^1.x` keep working.

## [1.1.0] - 2026-10-07

### New

- **Bus interfaces are checked against their protocol.** The editor, importers, consistency checks and generators all use the same protocol rules. The Issues panel groups errors and warnings, links each one to the signal on the canvas and the field in the Inspector, and blocks generation while an error remains. Messages explain the problem in plain words with the current and expected values.
- **Choose active-low or active-high per port.** Where a bus allows both, pick the polarity of a port in the Inspector; the canvas shows it, and vendor files use the matching role. Generated HDL stays active-high inside and inverts at the boundary. This replaces the separate Avalon-MM `_n` ports, which are still read from existing files.
- **The `ipcraft` command-line tool comes with the extension.** It works in VS Code terminals right away. **IPCraft: Install 'ipcraft' Command in PATH** makes it available in other terminals too, without sudo or Node.js.
- **Better Platform Designer `_hw.tcl` import.** Variables, loops, `expr`, procedures and elaboration callbacks are understood, so real-world components import with their actual ports and widths. Names or widths that cannot be resolved are dropped with a warning instead of being imported as Tcl text.
- **Migrate brings older files up to date.** It renames old snake_case keys to camelCase, rewrites bus types written for the IPCraft Python tool, and repairs a broken `memoryMapRef` when the intended map is clear, keeping your comments, key order and hex values. `ipcraft migrate --check` lists what would change.
- The Inspector shows the AXI-Stream `TUSER` width so you can change it.

### Changed

- **Interfaces without a `physicalPrefix` get unprefixed port names** (`awaddr`, `address`, ...). Before, every interface got `s_axi_`, even AXI-Stream and FIFO interfaces, which did not match the canvas.
- **IPCraft reads camelCase keys only.** Files that mixed old snake_case and camelCase spellings could show one value and generate another. Run **IPCraft: Migrate .ip.yml / .mm.yml to Latest Format** or `ipcraft migrate` on older files.
- The Upgrade command is now **IPCraft: Migrate .ip.yml / .mm.yml to Latest Format**. It also works on `.mm.yml` files and from a visual editor tab. Existing keybindings keep working.
- Avalon-MM and Avalon-ST follow their standard port sets. Avalon-ST uses `source` and `sink` modes and keeps symbol, latency, channel and endianness settings through Platform Designer and IP-XACT round trips.
- Validation and editor refreshes are much faster with large Vivado interface catalogs.

### Fixed

- **Generated AXI4-Lite slaves no longer lose transactions or hang** when the master sends several at once, as an AXI SmartConnect forwarding PCIe writes does. On a PCIe host this caused completion timeouts.
- **Editing no longer reformats untouched YAML.** Lists and folded text stay as you wrote them, and Windows line endings are kept.
- A `memoryMapRef` that names a missing memory map now stops generation instead of writing a broken reference into `component.xml`.
- **Vivado accepts more generated `component.xml` files** in `check_integrity`, including Avalon-MM and conduit interfaces. A conduit whose bus type cannot be found and that lists no ports now stops generation instead of losing its ports.
- `component.xml` import reads sizes such as `4K`, maps Avalon interfaces back correctly, and keeps all Avalon ports across a round trip.

### Security

- Updated bundled libraries (`@xmldom/xmldom`, `js-yaml`, `fast-uri`) to versions that fix published denial-of-service and injection advisories.

### Before you upgrade

- An IP that relied on the automatic `s_axi_` prefix now gets unprefixed port names in generated HDL, `component.xml`, `_hw.tcl` and testbenches, which breaks instantiations using the old names. Set `physicalPrefix: s_axi_` on the interface to keep them.
- Files that still use snake_case keys must be migrated once. Until then, those keys are ignored and reported.
- A file that selects an active-low port needs this version or later; older versions ignore the choice and generate the active-high port.

## [1.0.0] - 2026-08-09

### New

- **Work with several Vivado and Quartus versions.** Register several installed versions (or Docker images) per vendor. IPCraft picks the version an existing project needs, and **IPCraft: Select Vivado Version** / **Select Quartus Version** let you choose one yourself.
- Security reporting, support and contribution guides (`SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md`).

### Fixed

- The IP Core toolbar buttons "Open in Platform Designer" and "Edit in IP Packager" become available right after generating, without reopening the editor.
- The Vivado/Quartus version picker no longer closes on the first click, and no longer pops up twice when both projects are created together.
- Generation no longer stops when `fileSets` point outside the IP folder (for example `../src/pkg.vhd`, common in Platform Designer layouts).
- The demo in the README now plays on the Marketplace and in VS Code.

## [0.9.9] - 2026-07-29

### New

- A demo video in the README walks through visual editing and generation.

### Changed

- Parameter pages and groups you define appear in the Vivado IP customization GUI and in Platform Designer, and custom scaffold packs can use them.

### Fixed

- Vertical bit-field rulers label every bit, including gaps.
- Generation uses what is in the editor, even if not saved yet, and leaves the metadata it adds unsaved for you to review.
- Parameter pages, groups, labels and defaults survive a Platform Designer round trip.
- Quartus file lists point to the right RTL paths.

## [0.9.8] - 2026-07-28

### Changed

- The documentation explains IPCraft's workflow and benefits more clearly.

### Fixed

- Names such as `example.ip.yml` or `registers.mm.yml` typed into create dialogs no longer get a doubled or cut-off extension.
- The IP Core canvas zoom indicator stays visible while you zoom and hides afterwards.
- Imported VHDL ranges such as `WIDTH downto 0` keep their parameter expression.

## [0.9.7] - 2026-07-27

### New

- **Thorough register tests in generated cocotb testbenches.** They check reset values, access modes, reserved bits, byte enables, unmapped reads, write-1-to-clear and self-clearing bits, and run randomized traffic, on AXI and Avalon.
- **Interrupts know their bus and clock.** Interrupt ports can be associated with a bus interface and clock in the Inspector, and the association reaches generated RTL and Platform Designer.
- The DE10-Nano example projects run the same test scenarios in simulation and on hardware; the Avalon-MM example supports Nios II and Nios V.

### Changed

- IPCraft is published on the Marketplace by `bahonavi`.

### Fixed

- Long IP Core titles on the canvas wrap instead of overflowing.
- The Getting Started walkthrough matches what IPCraft actually does.

## [0.9.6] - 2026-07-25

### New

- **Choose the indentation of generated files** in the IPCraft settings or on the command line. Scaffold packs can set their own default.

### Fixed

- Access modes set on a register are kept in generated HDL.
- Consistency Check no longer reports false interface drift because of testbenches or black-box stubs.
- Data Inspector keeps an invalid canvas edit visible until you correct it, and new sources take the current input width.
- Inserting or deleting in the Memory Map editor no longer leaves stale values on screen.
- Register values entered in hex always use the `0x` prefix.
- A damaged bus-definition cache is rebuilt instead of reused.

## [0.9.5] - 2026-07-24

### New

- **Scaffold packs can state what they support**: HDL languages, bus types, whether they need a memory-mapped slave, and required ports. Unsuitable IPs are rejected before anything is generated. Packs can also mark generated scripts as executable.
- New template filters for scaffold packs: `snakecase`, `camelcase`, `pascalcase`, `constcase`, `log2`, `ljust` and `latexescape`.

### Changed

- Avalon-ST symbol order in Platform Designer follows the interface endianness; the separate checkbox is gone.
- Data Inspector bit lanes are more compact.

### Fixed

- A scaffold pack that generates the whole project no longer gets unrelated extra files (testbench, docs, vendor folders). Packs can turn off IPCraft's own testbench.
- Generated SystemVerilog byte-swapping compiles in Quartus.

## [0.9.4] - 2026-07-23

### New

- **Big-endian ports and buses.** Vector ports and built-in bus data paths can be marked big-endian; generated VHDL and SystemVerilog swap the data bytes and their byte enables together.

### Before you upgrade

- Custom scaffold packs with an `apiVersion` range of `~1.0` must change it to `~1.1` (or a compatible `^` range).

## [0.9.3] - 2026-07-22

### New

- The IP canvas shows reset polarity (active-high or active-low) and interrupt sensitivity (level or edge).

### Changed

- Editor controls are native VS Code form elements and work better with screen readers; Vim-style table navigation is unchanged.
- New how-to guides for creating, importing, generating and checking IP cores.

### Fixed

- In untrusted workspaces, generation, builds, vendor tools and templates are disabled, and generated files can no longer be written outside their target folder.
- Editing older memory maps with snake_case keys no longer creates duplicate sections or loses enum and custom metadata.
- Nodes on the IP canvas keep their size after a refresh.
- Bus Library section headers stay visible while scrolling.
- Avalon-ST signals are shown in their defined order.
- IPCraft works on VS Code 1.80 as declared.
- The documentation no longer claims you can run `npx ipcraft`.

## [0.9.2] - 2026-07-19

### New

- **Data Inspector.** Decode any value, pasted from a waveform, an ILA or SignalTap capture or a register read, into named bit fields. Use **IPCraft: Open Data Inspector**, **Open Register in Data Inspector** (uses a register's fields from your memory map) or **New Data Inspector** (saves a reusable `.ipci.yml` recipe). Unknown (`X`/`Z`) bits are shown as unknown rather than as a wrong number. Verilog, VHDL, C-style, decimal and binary values are accepted. Combine several sources (concatenate, slice, shift, mask, extend, byte-swap), show fields as hex, binary, signed, enum, float or fixed-point with a pass/fail check against an expected value, and import VCD or CSV/ILA captures. Recipes never store the values you paste.

### Changed

- The access column in the fields table shows short codes (`RO`, `RW`, `W1C`, ...) and its list always opens downwards. W1C monitors are set from a small button instead of an extra row.

### Fixed

- Data Inspector keeps overrides wider than 53 bits, and the value bar says whether a value is malformed, out of range or empty.

## [0.9.1] - 2026-07-17

### Changed

- **More room for registers.** The register list beside the block and register-array editors is gone, giving the fields table more space on small screens. Everything it did is in the Outline and a compact register header: keyboard insert and delete, renaming, offsets, descriptions, colors, and array count and stride.
- The register Value/Hex input sits in the fields toolbar.

### Fixed

- Outline labels are readable, the footer reflects the selected level, and long names end with an ellipsis instead of scrolling sideways.
- RTL files are compiled in the right order in more cases, including in Vivado `component.xml`.

## [0.9.0] - 2026-07-17

### New

- **Consistency Check.** Compares an `.ip.yml` with its top-level HDL and, once generated, with the Platform Designer `_hw.tcl` and Vivado `component.xml`: ports, clocks, resets, parameters, bus interfaces and (for Vivado) registers. Differences show on the canvas and in a review list where you can adopt, regenerate, inspect or ignore each one, and a Drift badge in the toolbar sums them up. Run it from the toolbar or **IPCraft: Check Consistency**; it also runs quietly when the editor opens and when a watched file changes.

### Fixed

- Consistency Check no longer reports bus-interface ports, interrupts or quoted string defaults as differences, and checks HDL files without an explicit `managed` flag.
- Renamed bus ports are kept when exporting to and importing from Vivado `component.xml`.
- Generated `component.xml` lists RTL files in compile order.
- Clicking the memory-map indicator of a bus interface opens its memory map.

## [0.8.9] - 2026-07-16

### New

- **Generate Documentation** creates a Markdown datasheet of the IP (parameters, ports, bus interfaces, clocks and resets, register map). Scaffold Project includes it by default; turn it off with `ipcraft.generate.includeDocs`.
- An optional `author` field, shown in the Inspector and the block header and written into generated file headers.
- **Report Issue** in the editors and next to error messages opens VS Code's issue reporter with your versions filled in.

## [0.8.8] - 2026-07-14

### New

- **`ipcraft` command-line tool** runs the same generator as the extension, without VS Code.
- **`ipcraft verify`** checks that generated files match the current `.ip.yml` and fails if they do not, for CI or pre-commit checks.
- **IPCraft: Check HDL Consistency (managed:false)** compares an `.ip.yml` with hand-written top-level HDL.
- Files marked `managed: false` are never generated, not even the first time.
- `simulation.topLevel` sets the top level of the generated cocotb testbench, for example a board wrapper.

### Fixed

- Quartus projects use the right HDL version setting for SystemVerilog-only and mixed designs.
- Components without a memory-mapped slave no longer get misleading `_hw.tcl` comments or an unneeded `derive_pll_clocks`.
- HDL Consistency Check no longer repeats findings or reports submodules as missing top-level ports, and `ipcraft verify` notices leftover files of removed targets.

## [0.8.7] - 2026-07-12

### New

- Three example projects, tested on DE10-Nano hardware: an Avalon-MM LED peripheral and register-access test suites for Avalon-MM and AXI4-Lite.

### Changed

- Smaller extension download.

### Fixed

- Generated AXI4-Lite slaves return SLVERR for reads from unmapped addresses.
- Reset values of `0x80000000` and above, and Avalon-MM slaves with word addressing, generate valid VHDL.
- Switching between VHDL and SystemVerilog no longer pulls old RTL files into the vendor projects.

## [0.8.6] - 2026-07-10

### New

- **Clock and reset overview.** Click the Ports header on the IP Core canvas to see every bus interface with its clock and reset, change them in place, and check which clock each reset belongs to.

## [0.8.3] - 2026-07-07

### Fixed

- Importing VHDL or Verilog keeps port widths such as `clog2(DW/2)` instead of losing the parameter or storing VHDL-only text.

## [0.8.2] - 2026-07-04

### Fixed

- Vivado treats generated VHDL files as VHDL-2008, so VHDL-2008 code synthesizes in block designs. Each file can be set to another VHDL version in the Source Files editor.

## [0.8.0] - 2026-06-27

### New

- Edit registers right next to the register map of their address block.
- Drag address blocks and registers in the outline to reorder them; offsets update automatically.
- While dragging a bit field or outline item, the list shows where it will land.

### Fixed

- Register map labels stay readable in a narrow panel, and the panes can be resized.

## [0.3.0] - 2026-06-13

### Fixed

- Inserting, deleting or moving address blocks, registers and bit fields no longer corrupts offsets and bit ranges.
- Fast edits in the Memory Map editor can no longer corrupt the file.
- Clicking around the Memory Map editor no longer marks the file as changed, and edits keep your formatting, comments and hex values.
- Values the editor uses internally are no longer written into your files, a `range` you did not set is no longer added, and `defaultRegWidth` is kept.

## [0.2.0] - 2026-05-23

### New

- **SystemVerilog generation.** Set `ipcraft.generate.hdlLanguage` to `systemverilog` to generate the full project in SystemVerilog.
- **IPCraft: Build** compiles Vivado and Quartus projects in the background, with live output in the IPCraft Build output channel and the result (timing or Fmax) in the status bar.
- **Build Reports panel** shows timing, resource use and CDC violations; click an entry to open the report.
- Vivado projects include scripts for batch out-of-context synthesis and full implementation.
- New settings: `ipcraft.quartus.shellPath`, `ipcraft.build.jobs` and `ipcraft.generate.hdlLanguage`.
- VHDL import detects AXI4, AXI4-Lite, AXI-Stream, Avalon-MM and Avalon-ST interfaces, and connects the clock and reset automatically when there is only one of each.
- An **IPCraft** menu in the menu bar.
- Platform Designer import follows `source` commands, so components split over several files are imported in full.
- Imported source files are put in compile order.

### Changed

- **IPCraft: Scaffold VHDL Project** is now **IPCraft: Scaffold Project** and **IPCraft: Generate VHDL** is now **IPCraft: Generate HDL**.
- Scaffold Project always creates Vivado and Quartus projects.
- The IP Core editor opens on the canvas; the table view is gone.
- Vivado output is in `xilinx/` (was `amd/`) and Vivado projects in `build/ooc/`.
- Simulation-only files are left out of Vivado and Quartus projects.
- Commands moved out of the Explorer and editor context menus into the Command Palette, the IPCraft menu and the editor title bar.

### Fixed

- VHDL import no longer mistakes register-bank ports such as `rd_data`/`rd_valid` for Avalon-ST.

## [0.1.0] - 2026-03-29

### New

- First release: visual editors for IP Core and Memory Map files, VHDL generation and import, and a Bus Library viewer.
