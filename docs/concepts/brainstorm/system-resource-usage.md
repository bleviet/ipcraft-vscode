# Resource Usage in the System Viewer

## Status

Implemented: phases 0 to 3 of [Delivery Phases](#delivery-phases). The open
questions are decided; see [Decisions](#decisions). The user documentation is
[Resource usage](../../how-to/view-a-system-design.md#resource-usage) in the
system viewer how-to and `ipcraft resources` in the
[command line reference](../../reference/command-line.md#report-the-resource-usage-of-a-system-design).
Not done: Quartus Prime Pro, LE device families (MAX 10, Cyclone IV) and
UltraScale+ URAM columns have no real fixture yet; an extracted checkpoint is not
watched, so a new run is offered for extraction the next time the diagram opens;
the stale-report notice of IPCraft builds compares with the design file, not with
each IP core's sources.

The approach was checked on 2026-11-21 with real tool runs, not only against the
documentation:

- Vivado 2024.2, xc7a100t: a block design with two `axi_gpio`, an
  `axi_bram_ctrl`, a `smartconnect` and a hierarchy block holding a
  `blk_mem_gen`. Synthesized with per-IP out-of-context (OOC) runs, then placed
  and routed.
- Quartus Prime Lite 25.1std, Cyclone V: a Platform Designer system with a clock
  source, an MM bridge, two PIOs and an on-chip RAM, instantiated as `u0` by a
  hand-written top level with some glue logic. Full compile.

The findings below quote those reports.

## Problem

Users of the [system viewer](../../how-to/view-a-system-design.md) want to see
how much of the device each block uses: after synthesis (including per-IP
out-of-context synthesis) and after place and route, for Vivado and Quartus.

Today the numbers exist only in the vendor GUI or in report files. Those files
list the netlist hierarchy, not the block design, so it is hard to see from
them which block of the diagram is expensive.

## Is It Possible

Yes. Both tools write a per-hierarchy utilization table whose instance names
are the instance names of the block design or Platform Designer system. A
system viewer path such as `/hier_0/axi_gpio_1` is a suffix of a report path.
The difference between the vendors is whether the table is already on disk.

| | Per-block table | Written by a normal run | Tool needed to show it |
|---|---|---|---|
| Quartus, synthesis | `<rev>.map.rpt`: *Analysis & Synthesis Resource Utilization by Entity* | Yes | No |
| Quartus, fitter | `<rev>.fit.rpt`: *Fitter Resource Utilization by Entity* | Yes | No |
| Vivado, per-IP OOC | `<proj>.runs/<xci_name>_synth_1/<xci_name>_utilization_synth.rpt` (one flat report per IP) | Yes, in the default OOC-per-IP mode | No |
| Vivado, top synthesis | `report_utilization -hierarchical` on `synth_1/<top>.dcp` | No: `<top>_utilization_synth.rpt` is flat | Vivado, batch, read-only |
| Vivado, place and route | `report_utilization -hierarchical` on `impl_1/<top>_routed.dcp` (or `_placed.dcp`) | No: `<top>_utilization_placed.rpt` is flat | Vivado, batch, read-only |

On Vivado, either the user adds `report_utilization -hierarchical` to the run
(a `tcl.post` hook) or IPCraft runs it once on the checkpoint. On the spike, opening the
routed checkpoint and writing the report took 25 s, and the table was identical
to the one written inside the run.

### What the reports look like

Vivado, `report_utilization -hierarchical` (columns trimmed). Indentation of
two spaces per level encodes the tree, and a `(name)` row is the logic of the
cell itself:

```
| Instance            | Module                | Total LUTs | ... | FFs  | RAMB36 | RAMB18 | DSP Blocks |
| sys_wrapper         |                 (top) |        841 | ... | 1386 |      2 |      0 |          0 |
|   sys_i             |                   sys |        841 | ... | 1386 |      2 |      0 |          0 |
|     axi_gpio_0      |      sys_axi_gpio_0_0 |        131 | ... |  382 |      0 |      0 |          0 |
|     hier_0          |    hier_0_imp_1HP7EO4 |        135 | ... |  387 |      2 |      0 |          0 |
|       axi_gpio_1    |      sys_axi_gpio_1_0 |        131 | ... |  382 |      0 |      0 |          0 |
|       bram_0        |          sys_bram_0_0 |          4 | ... |    5 |      2 |      0 |          0 |
|     smartconnect_0  |  sys_smartconnect_0_0 |        422 | ... |  449 |      0 |      0 |          0 |
```

The Module of the design root is the block design name (`sys`), and the Module
of an IP cell is the `xci_name` that the `.bd` file records for that cell.

Quartus, fitter report (columns trimmed). Values are `total (self)`, and the
*Full Hierarchy Name* column holds the unambiguous path:

```
; Compilation Hierarchy Node                  ; ALMs needed  ; ... ; Full Hierarchy Name                                       ;
; |top                                        ; 120.5 (6.4)  ; ... ; |top                                                      ;
;    |sys:u0|                                 ; 114.1 (0.0)  ; ... ; |top|sys:u0                                               ;
;       |altera_avalon_mm_bridge:bridge_0|    ; 50.4 (50.4)  ; ... ; |top|sys:u0|altera_avalon_mm_bridge:bridge_0              ;
;       |altera_reset_controller:rst_controller| ; 3.0 (2.5) ; ... ; |top|sys:u0|altera_reset_controller:rst_controller        ;
;       |sys_mm_interconnect_0:mm_interconnect_0| ; 46.2 (0.0) ; ... ; |top|sys:u0|sys_mm_interconnect_0:mm_interconnect_0     ;
;       |sys_pio_0:pio_0|                     ; 4.8 (4.8)    ; ... ; |top|sys:u0|sys_pio_0:pio_0                               ;
```

`rst_controller` and `mm_interconnect_0` are generated by Platform Designer and
are not blocks of the diagram. Here they are about 43 % of the system's ALMs, so
the viewer must show them rather than drop them. The 6.4 ALMs of `|top` itself
are the glue logic outside the system.

### Synthesis and implementation differ

The same blocks, Vivado, LUTs:

| Block | Post-synthesis | Post-route |
|---|---|---|
| `axi_bram_ctrl_0` | 188 | 154 |
| `smartconnect_0` | 464 | 422 |
| `axi_gpio_0` | 131 | 131 |
| Design | 919 | 841 |

`opt_design` removes logic after synthesis. The viewer therefore always labels
the stage of the numbers on show and never mixes stages in one total.

## Goals and Non-Goals

Goals:

- Show the resource usage of each block, hierarchy block and level of a Vivado
  block design or Platform Designer system, for a chosen report stage: per-IP
  OOC, synthesis, or implementation (placed, routed, fitted).
- Read existing report files offline, with no vendor tool and no license,
  whenever the report on disk has per-block data.
- Account for all the logic: blocks of the diagram, logic the tool generated
  (interconnect, reset controllers) and logic outside the design.
- Tell the user when a report is older than the design, or does not match it.

Non-goals:

- Running synthesis or implementation from the viewer. The existing **Build**
  commands do that for a single IP core; a system build is a separate feature.
- Converting between vendors' units (an ALM is not a LUT).
- Timing per block. A later extension could use the same mapping.
- Resource differences between two revisions (a follow-up to the
  [system design diff](system-design-diff.md)).
- Quartus Prime Pro. Quartus Prime Lite is supported. Standard shares Lite's
  compiler and is expected to write the same reports, but this was not checked.
  Pro writes a different set of files (`.syn.rpt`) and can follow
  later with its own fixtures.
- Reading archives (`.zip`) directly. A CI artifact archive is unpacked first,
  then its folder is chosen (see [Attach a Report](#attach-a-report)).

## Identity: Matching Report Rows to Blocks

The mapping is a pure function of the report tree and the `SystemGraph`.

1. **Find the design root in the report.** Vivado: the row whose Module is the
   design name (`sys`; the wrapper is usually `<name>_wrapper/<name>_i`, but a
   user top level may use any instance name). Quartus: the node whose entity is
   the system name (`|top|sys:u0`). When several rows match, for example a
   block design instantiated twice, the user picks one and the choice is
   remembered.
2. **Walk down by instance name.** Below the root, each path component is an
   instance name of the viewer path. Quartus components are `entity:instance`;
   only the instance part is compared.
3. **Cross-check with the definition.** For a `.bd` file, the Vivado Module of
   an IP cell must equal the cell's `xci_name`. A mismatch is a diagnostic, not
   a silent match. Hierarchy blocks get generated module names
   (`hier_0_imp_1HP7EO4`) and match by name only.
4. **Classify what is left over.**
   - A child of a level in the report with no block in the diagram is
     *generated by the tool*. It is listed per level, never drawn as a block.
   - Logic above the design root is *outside the design*.
   - A block in the diagram with no row in the report is *not in the report*:
     removed by optimization, flattened away, or the report is stale.
5. **Grafted subsystems.** The viewer already grafts nested Platform Designer
   systems and block design containers into one graph
   (`src/services/systemDiagram/enrichment/graftSubsystem.ts`). Their paths
   continue through the subsystem instance in the report, so the same walk
   applies.

Hierarchy blocks show the report's total for their cell. They are not summed
from their children, so cross-boundary optimization is reflected correctly.

### Per-IP OOC numbers

Per-IP OOC reports are flat, one per IP, and found by `xci_name`. They have no
cross-boundary optimization and include no top-level logic, so their sum is not
the design's usage. In the OOC stage the viewer shows each IP's own number,
hierarchy totals are labelled *sum of OOC IPs*, and no device percentage is
claimed for a hierarchy. Blocks without an OOC run (module references, Global
synthesis mode) show *not synthesized out of context*.

An OOC run that was an IP cache hit has no utilization report: Vivado copies
only the cached checkpoint into the run directory (seen in the spike for
`axi_gpio_1`, which has the same configuration as `axi_gpio_0`; its
`runme.log` says `Using cached IP synthesis design`). Such a block shows *IP
cache hit, no report*, and its `<xci_name>.dcp` is offered for *Extract from
checkpoint* like the top-level runs.

## Resource Vocabulary

Columns are read from the table headers by their text, not by position, and
each vendor keeps its own names. The four primary metrics of the vendor are
shown on every block header.

| Vendor | Primary on the block | Also in Details and the table |
|---|---|---|
| Vivado | LUTs, FFs, BRAM tiles (RAMB36 + RAMB18 / 2), DSPs | Logic LUTs, LUTRAMs, SRLs, URAM (UltraScale+), CARRY, any further column of the report |
| Quartus (ALM families) | ALMs needed, registers, M10K/M20K, DSP blocks | Combinational ALUTs, block memory bits, ALMs for memory |
| Quartus (LE families: Cyclone IV, MAX 10) | Logic elements, registers, memory bits, embedded multipliers | Every further column |

Device capacity, for percentages, comes from the flat report of the same stage
(Vivado `Slice LUTs* | 919 | ... | 20800 | 4.42`) and from `<rev>.fit.summary`
(`Logic utilization (in ALMs) : 121 / 32,070`). When capacity is unknown, only
absolute numbers and the share of the design are shown.

## Where Reports Come From

The extension discovers candidates near the open design and lets the user pick
one in the viewer. The choice is remembered per design file in workspace state,
per user; it is not written to `.vscode/settings.json`.

- **Vivado project.** Walk up from the design file to a `.xpr`, then look in
  `<proj>.runs/`: `synth_1/`, `impl_1/`, and `<xci_name>_synth_1/` for each IP
  cell. A hierarchical report found in a run directory is used directly.
  A checkpoint without one is offered as *Extract from checkpoint*.
- **Quartus project.** Walk up to a `.qpf`; read `PROJECT_OUTPUT_DIRECTORY`
  from the `.qsf` (the default is the project directory) and look for
  `<rev>.map.rpt` and `<rev>.fit.rpt`.
- **IPCraft builds.** `xilinx/build/ooc/` (else `xilinx/build/xpr/`, counted as
  post-route in the label) and `altera/build/output_files/` of IP cores in the
  workspace, for blocks defined by an `.ip.yml`. Device shares only when every
  build used the same device.
- **Attached.** A report file or folder the user chose, anywhere on disk; see
  [Attach a Report](#attach-a-report). A `write_bd_tcl` script kept in git
  usually has no project next to it, and a CI build runs on another machine, so
  this is the common path for `.tcl` designs and for reports from Jenkins.

A watcher on a chosen file inside the workspace reloads the numbers when it
changes.

### Attach a Report

When discovery finds nothing, or the report the user wants is a download from a
CI build (for example the archived artifacts of a Jenkins job), the user attaches
it in one step.

- **Where to start.** With no report found, the Resources toggle still works:
  the Resources tab shows an empty state with **Attach Report...** and
  **Choose Folder...** buttons, the list of places that were searched, and the
  Tcl line that writes a hierarchical Vivado report (to add to a run or a CI
  script). The source picker and the command **IPCraft: Attach Resource
  Report** offer the same two actions at any time.
- **Attach Report...** opens a file dialog filtered to `*.rpt`, `*.dcp` and all
  files, starting in the design's folder. A downloaded file may have any name,
  so the kind is recognized from its content, not its name:
  - Vivado: the `report_utilization` header (`Command`, `Design`, `Device`,
    `Design State : Synthesized | Placed | Routed`), and whether the command
    had `-hierarchical`. The design state gives the stage.
  - Quartus: the first line, `Analysis & Synthesis report for <rev>` or
    `Fitter report for <rev>`, and the entity table in it.
  - A `.dcp` is offered for *Extract from checkpoint*.
- **Choose Folder...** takes an unpacked CI artifact folder or a vendor
  project, runs the same discovery in it, and lists what it finds by stage. One
  folder can hold synthesis and implementation reports of the same build.
- **Copied, not linked.** A file outside the workspace is copied into the
  extension's workspace storage when it is attached, so it survives a cleanup of
  the Downloads folder. The picker shows its original name, the date from its
  header and *attached*. **Replace...** attaches the report of a newer build;
  **Remove** deletes the copy. A file inside the workspace is linked and
  watched instead.
- **Helpful refusals.** A report that cannot be used says why and what to do:
  - A flat Vivado report (no `-hierarchical`): only the design total can be
    shown, together with the one-line command to add.
  - Another kind of report (timing, power): it is not a utilization report.
  - A different device, or a design root that is not in the report: the
    report is for another design.
- **Freshness.** For an attached report the modification time of the copy
  means nothing, so the banner compares the date in its header with the design
  file and says *Report from <date>*, not *stale*. The block match (blocks not in
  the report, rows with no block) is the real check, and it is shown the same
  way for every source.
- **No private data shown.** Vivado headers include the build host and the
  absolute command line; the viewer does not display them.

### Extract from checkpoint (Vivado)

One batch call through the existing Vivado toolchain resolution (configured
version, local install or Docker launcher in `src/services/toolchains/`):

```tcl
open_checkpoint <dcp>
report_utilization -hierarchical -file <out>
report_utilization -file <out-flat>
```

- Only on an explicit click, only in a trusted workspace, with progress and
  cancel. The command line is shown in the IPCraft output channel.
- Read-only on the user's project: the output goes to the extension's
  workspace storage, keyed by checkpoint path and modification time, so it is
  reused until the run changes. Opening a checkpoint does not lock the project,
  so it works while the Vivado GUI is open.
- `report_utilization -format xml` worked in 2024.2 but is not listed in
  `help report_utilization`. The text table is parsed instead.

## Viewer Experience

- **Toolbar.** A **Resources** toggle in the Design group, after **Unconnected
  pins**, and a chip with the stage and the design total, for example
  `Post-route · 841 LUTs · 1.3 %`. Clicking the chip opens the **Resources** tab.
- **Source bar.** At the top of the Resources tab (the toolbar has no room for
  it): a **Report** list of the discovered and attached reports by stage with
  their date (unusable ones marked *not usable* and selectable, so their reason
  shows), *Extract from checkpoint* entries (phase 2), **Attach Report...**,
  **Choose Folder...** and **Remove** for an attached report.
- **On the diagram.** While Resources is on, a strip directly above each block
  shows its four primary metrics on one line (`154 LUT · 168 FF · 0 BRAM · 0 DSP`)
  and the share of the design and of the device of the first one on a second
  (`18.3 % design · 0.2 % device`; one line was wider than most blocks and went
  under the block to its right), and a thin bar under the block header its share
  of the level. The block header
  keeps its type line, whose tooltip has the exact values. The metrics did not
  fit in the header of a typical block, so they moved above it; the strip is
  drawn, not laid out, so it never moves a block. A heat map (a metric selector
  that colored the block headers by their share) and a Counts / % of device
  switch were built in phase 3 and removed again: users found the options
  confusing, and the strip and the tab now show both shares at once.
- **Details.** A **Resources** section for the selected block: every column,
  total and self, share of the design and of the device. When reports of two
  stages are loaded, both columns with the difference.
- **Resources tab.** One row per block with its level, sortable by any column,
  with the existing filter box. Each level also has *Generated by the tool* and,
  at the root, *Outside the design*. Clicking a row goes to the block, as in the
  other tabs.
- **Empty state.** With no report, the tab offers the attach actions described
  in [Attach a Report](#attach-a-report).
- **Banners.** The report is older than the design file; the design root was
  not found in the report; N blocks are not in the report; the report's
  device differs from the design's part.

## Architecture

The dependency direction follows the binding rules in `AGENTS.md`: pure parsing
and mapping, then services, then the provider, then React.

| Module | Side | Responsibility |
|---|---|---|
| `src/domain/resourceUsage.ts` | shared | JSON-serializable types: `ResourceReport`, metrics, per-instance usage, leftovers, diagnostics |
| `src/services/resources/vivadoHierarchyTable.ts` | pure | Text table to report tree (indentation, `(self)` rows, header-keyed columns) |
| `src/services/resources/quartusEntityTable.ts` | pure | `; ... ;` entity table of `.map.rpt` / `.fit.rpt` to report tree, keyed by *Full Hierarchy Name* |
| `src/services/resources/reportKind.ts` | pure | Recognizes a report from its header: vendor, stage, device, design, date, hierarchical or flat, or why it cannot be used |
| `src/services/resources/reportTree.ts` | pure | The report tree shared by both table parsers |
| `src/services/resources/vivadoFlatTable.ts` | pure | Rows of a flat Vivado utilization table by header (also used by `ReportParser.parseVivadoUtilization`) |
| `src/services/resources/resourceMetrics.ts` | pure | Metrics per vendor and stage from the table columns, and device capacity from the flat Vivado report and the Quartus summary |
| `src/services/resources/mapReportToGraph.ts` | pure | Report tree + `SystemGraph` to `ResourceReport` (the identity rules above) |
| `src/services/resources/reportDiscovery.ts` | extension | Candidate reports for a design file or a chosen folder |
| `src/services/resources/attachedReports.ts` | extension | Copies attached files into workspace storage, lists, replaces and removes them |
| `src/services/resources/extractVivadoHierarchy.ts` | extension | The checkpoint extraction, through the toolchain launcher |
| `src/providers/systemDiagram/PanelResources.ts` | extension | Source choice, watcher, re-mapping when the graph changes, messages |
| `src/webview/systemDiagram/resources/` | webview | `resourceView.ts` (pure shares, formatting, header and Details texts), `resourceRows.ts` (pure rows, changes and sorting of the Resources tab), `ResourcesTable.tsx`, `ResourceDetails.tsx`, header decoration |

- **Messages.** A separate `{ type: 'resources'; report?: ResourceReport;
  candidates: ResourceSource[] }` to the webview, and `pickResourceSource`,
  `extractResources`, `attachReport`, `chooseReportFolder`, `removeAttached`,
  `clearResources` back. The file and folder dialogs run in the extension. The graph is posted on every edit;
  the report changes rarely. The extension owns both and re-maps on each graph
  update (cheap), so the webview never parses reports.
- **Header decoration.** A `resources?: NodeResources` prop on `NodeHeader`,
  alongside `domains` and `review`, built by `resourceView.ts`.
- **Reuse, not a second parser.** The flat Vivado utilization table is already
  parsed by `src/services/ReportParser.ts` for the build reports tree. The flat
  per-IP OOC reports and the capacity numbers use one extracted Vivado table
  reader, shared by both.
- **CLI.** The pure modules have no `vscode` import, so a later
  `ipcraft resources <design> <report> --format md|json` and an
  `ipcraft render --resources` option can reuse them.

## Trust and Safety

Report files are read as text and never executed. The only tool run is the
Vivado checkpoint extraction: explicit, trusted workspaces only, through the
configured toolchain, writing only to extension storage.

## Testing

- **Fixtures from real runs**, trimmed: the Vivado 2024.2 synth and route
  hierarchical reports and per-IP OOC reports of the spike; the Quartus 25.1std
  `.map.rpt`, `.fit.rpt` and `.fit.summary`; the spike `.bd` and `.qsys`. Still
  needed: an LE family (MAX 10, in Quartus Prime Lite), an UltraScale+ part
  (URAM column), a design with a block design container, and a nested Platform
  Designer subsystem.
- **Report recognition**: each fixture renamed to an unrelated name is still
  recognized; a flat Vivado report, a timing report and a report of another
  device are refused with their message.
- **Unit tests** for each parser and for `mapReportToGraph`: root detection, two
  candidate roots, `xci_name` mismatch, generated and outside logic, blocks not
  in the report, grafted subsystems, OOC sums.
- **`resourceView.ts`** tested directly; a browser test for the toggle, the
  tab, row navigation and that blocks do not move.
- **Integration**, gated like the other EDA tests: run the extraction on a small
  checkpoint and compare with the fixture.

## Delivery Phases

Each phase goes through `/orchestrate`.

0. **Fix the existing Quartus summary parsing** (see
   [Findings](#findings-in-the-existing-code)), with a real `.fit.summary`
   fixture. It shares the summary reader with phase 1.
1. **Read-only overlay from files.** Parsers, report recognition, mapping,
   discovery, attaching a file or folder (with the empty state and the
   refusal messages), source picker, Resources toggle, block header metrics,
   Details, Resources tab, stale and mismatch banners. Covers Quartus Prime Lite
   synthesis and fitter completely, Vivado per-IP OOC, and Vivado hierarchical
   reports the user already has, including ones downloaded from CI.
2. **Vivado extraction.** *Extract from checkpoint* for synthesis and
   implementation, the storage cache, the file watcher, two stages side by side
   in Details.
3. **Extras.** Resource badges in exported images
   (`src/shared/render/`), the CLI command, and numbers from IPCraft's own OOC
   builds for blocks defined by an `.ip.yml`.

## Findings in the Existing Code

Found while checking the report formats. They affect the existing build
reports tree, not this feature yet.

1. `parseQuartusUtilization` in `src/services/ReportParser.ts` expects
   `; key ; value ;` lines, but a real Quartus 25.1std `.fit.summary` writes
   `Logic utilization (in ALMs) : 121 / 32,070 ( < 1 % )`. None of the LUT,
   register or block memory patterns matches the real file. The unit test
   passes only because its fixture uses the `;` form.
2. `parseQuartusReports` reads `<buildDir>/output_files/`, but
   `quartus_project.tcl.j2` does not set `PROJECT_OUTPUT_DIRECTORY`. In the
   spike, a project created by `project_new` without it wrote its reports to the
   project directory. To confirm with an IPCraft-generated Quartus project.

## Decisions

Decided on 2026-11-21:

1. **Block header metrics:** the four primary metrics of the vendor, from the
   [Resource Vocabulary](#resource-vocabulary) table.
2. **Extracted Vivado reports:** in the extension's workspace storage, not in
   the user's run directory.
3. **Quartus edition:** Quartus Prime Lite. Pro is a non-goal for now.
4. **Remembered report source:** per user, in workspace state.
5. **Report not found:** the user can attach a report file or choose a folder
   from anywhere, for example a report downloaded from a Jenkins build; see
   [Attach a Report](#attach-a-report).
