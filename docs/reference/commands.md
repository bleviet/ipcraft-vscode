# Commands & Settings Reference

Use this page to look up every IPCraft command and setting. Start with the
common tasks below; the later tables are the complete reference.

## Common tasks

| Goal | Command |
|---|---|
| Create a core and linked register map | **IPCraft: New IP Core + Register Map** |
| Generate the complete project | **IPCraft: Scaffold Project** |
| Check generated files against the specification | **IPCraft: Check Consistency** |
| Import an existing VHDL entity | **IPCraft: Import from VHDL (Experimental)** |
| Run the available vendor build | **IPCraft: Build** |
| Switch from the visual editor to YAML | **IPCraft: Open as Text Editor** |

All commands are in the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`). A
blank cell in the location tables means the command is not available there.

## Workspace Trust and Restricted Mode

IPCraft has limited support for untrusted workspaces. In Restricted Mode, the
visual IP Core, Memory Map, and Data Inspector editors remain available for
local authoring. The following inspection features also remain available and
do not execute workspace content:

- view built-in bus definitions and scan workspace bus-definition files;
- run HDL and full consistency checks, which only parse project files;
- copy a component instance, switch between text and visual editors, and view
  existing build output;
- create or migrate IPCraft YAML files and open IPCraft help and settings.

Commands that render templates, generate output, invoke Git during import,
scan an installed vendor catalog, build a project, or launch Vivado, Quartus,
or Platform Designer are disabled until the workspace is trusted. Calls from
the Command Palette, extension API, and IPCraft webviews use the same trust
check. If a command is invoked programmatically in Restricted Mode, IPCraft
shows an error with an option to open VS Code's Workspace Trust management.

Workspace values for scaffold-pack selection and paths, vendor runners,
installation directories, and Docker images are ignored in Restricted Mode.
Trust the workspace only when you are comfortable allowing its templates,
generated scripts, and tool configuration to run on your machine.

## All commands

All commands are available in the Command Palette (`Ctrl+Shift+P`) under the **IPCraft** category. Many commands are also reachable from the **IPCraft** top-level application menu bar entry or from the editor title bar icon.

### Create

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: New IP Core` | Yes | Yes | |
| `IPCraft: New Register Map` | Yes | Yes | |
| `IPCraft: New IP Core + Register Map` | Yes | Yes | |

**New IP Core** — Creates a new `.ip.yml` file with a minimal VLNV skeleton and opens it in the IP Core visual editor.

**New Register Map** — Creates a new `.mm.yml` file with an empty address block and opens it in the Memory Map visual editor.

**New IP Core + Register Map** — Creates both files at once and links them via a `memoryMapRef` bus interface.

---

### Scaffold & Generate

These commands are available on `.ip.yml` files.

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Scaffold Project` | Yes | Yes | Yes |
| `IPCraft: Generate Top-Level HDL` | Yes | | |
| `IPCraft: Generate CocoTB Testbench` | Yes | Yes | Yes |
| `IPCraft: Generate Vivado Project` | Yes | Yes | Yes |
| `IPCraft: Generate Quartus Project` | Yes | Yes | Yes |
| `IPCraft: Generate Altera Platform Designer Component (_hw.tcl)` | Yes | Yes | Yes |
| `IPCraft: Generate Xilinx Vivado Component (component.xml)` | Yes | Yes | Yes |
| `IPCraft: Generate & Build (Vivado OOC)` | Yes | Yes | Yes |
| `IPCraft: Generate & Build (Quartus)` | Yes | Yes | Yes |
| `IPCraft: Generate Documentation` | Yes | Yes | Yes |

**Scaffold Project** — The all-in-one command. Generates RTL files (VHDL or SystemVerilog, controlled by `ipcraft.generate.hdlLanguage`), a testbench, and vendor project files in a single step. Part number and device are read from settings (`ipcraft.vivado.defaultPart`, `ipcraft.quartus.defaultDevice`). The output is written next to the `.ip.yml` file.

**Generate Top-Level HDL** — Generates RTL source files only (package, top entity, core skeleton, bus wrapper, register file). Prompts for an output directory. Respects `ipcraft.generate.hdlLanguage`.

**Generate CocoTB Testbench** — Generates the testbench scaffold in the `tb/` directory. The framework and simulator engine are controlled by `ipcraft.testbench.framework` and `ipcraft.testbench.engine`. See [Run cocotb Simulations](../how-to/run-cocotb-simulation.md) for details.

**Generate Vivado Project** — Prompts for an FPGA part number, then generates `xilinx/<ip_name>_project.tcl` (OOC project creator), `xilinx/<ip_name>_run_ooc.tcl` (OOC synthesis runner), `xilinx/<ip_name>_run_xpr.tcl` (full implementation runner), and `xilinx/<ip_name>_ooc.xdc` (timing constraints).

**Generate Quartus Project** — Prompts for a device part number, then generates `altera/<ip_name>_project.tcl` and `altera/<ip_name>.sdc`.

**Generate Altera Platform Designer Component** — Exports `altera/<ip_name>_hw.tcl` for use in Quartus Platform Designer.

**Generate Xilinx Vivado Component** — Exports `xilinx/component.xml` and `xilinx/xgui/<ip_name>_v*.tcl` for use in the Vivado IP catalog.

**Generate Documentation** — Renders `docs/<ip_name>_datasheet.md`, a Markdown datasheet covering ports, generics, bus interfaces, and (if present) the linked register map. Same command run by scaffolding when `ipcraft.generate.includeDocs` is enabled.

---

### Scaffold Packs

| Command | Palette | Editor Title |
|---------|:-------:|:------------:|
| `IPCraft: Preview Template Output` | Yes | Yes (`.j2` files) |
| `IPCraft: Pin Preview IP Core` | Yes | No |
| `IPCraft: Export Built-in Scaffold Pack` | Yes | |

**Preview Template Output** — Opens a read-only, live-refreshing preview of a `.j2` template's rendered output next to the editor, evaluated against a pinned or auto-detected `.ip.yml` file. See [Scaffold Packs](../how-to/customizing-generated-files-with-scaffold-packs.md).

**Pin Preview IP Core** — Chooses the `.ip.yml` file that supplies data for
template previews until another file is pinned.

**Export Built-in Scaffold Pack** — Copies a built-in or example scaffold pack (and all its templates) into `.vscode/ipcraft/packs/<name>/` in the workspace as a starting point for customization.

---

### Validate

These commands are available on `.ip.yml` files.

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Check Consistency` | Yes | Yes | Yes |
| `IPCraft: Check HDL Consistency (managed:false)` | Yes | Yes | |

**Check Consistency** — Cross-references the spec's declared ports, clocks, resets, generics, bus interfaces, and registers against the generated top-level HDL entity/module and, when scaffolded, the Platform Designer (`_hw.tcl`) and Vivado (`component.xml`) vendor artifacts. Reports drift in both directions: implementation-only items (extra port/parameter — a plausible adopt) and spec-only items (missing port/parameter — declared but gone from the implementation), plus property mismatches (direction/width/default) on items both sides declare.

**Check HDL Consistency (managed:false)** — The same cross-check restricted to the top-level HDL entity/module, regardless of the file's `managed:` flag.

---

### Build

These commands are available on `.ip.yml` files and require vendor tools installed and reachable (see Settings below).

| Command | Palette | IPCraft Menu | Editor Title | Status Bar |
|---------|:-------:|:------------:|:------------:|:----------:|
| `IPCraft: Build` | Yes | Yes | Yes | |
| `IPCraft: Build: Vivado OOC Synthesis` | Yes | Yes | | |
| `IPCraft: Build: Quartus Compile` | Yes | Yes | | |
| `IPCraft: Show Build Output` | Yes | Yes | | Yes (click) |

**Build** — Detects available build targets by checking for `xilinx/<ip_name>_run_ooc.tcl`, `xilinx/<ip_name>_run_xpr.tcl`, and `altera/<ip_name>_project.tcl`. When multiple targets exist, a QuickPick is shown. The selected tool runs in batch mode; output streams live to the *IPCraft Build* Output Channel. On completion, the *IPCraft Build* sidebar panel updates with parsed timing and utilization metrics.

**Build: Vivado OOC Synthesis** — Directly runs the Vivado OOC synthesis target without a QuickPick prompt.

**Build: Quartus Compile** — Directly runs the Quartus compile target without a QuickPick prompt.

Available build targets:

| Target | Tool | Reports written to |
|--------|------|--------------------|
| Vivado OOC Synthesis | `vivado -mode batch` | `xilinx/build/ooc/` |
| Vivado Full Implementation (XPR) | `vivado -mode batch` | `xilinx/build/xpr/` |
| Quartus Compile | `quartus_sh --flow compile` | `altera/build/output_files/` |

**Show Build Output** — Opens the *IPCraft Build* Output Channel. The status bar item also triggers this command on click.

---

### Import

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Import from VHDL (Experimental)` | Yes | Yes | Yes (`.vhd`, `.vhdl`) |
| `IPCraft: Import from Altera Platform Designer (Experimental)` | Yes | Yes | Yes (`_hw.tcl`) |
| `IPCraft: Import from Xilinx Component XML (Experimental)` | Yes | Yes | Yes (`component.xml`) |

**Import from VHDL** — Parses a `.vhd` or `.vhdl` file and extracts entity name, generics, clock/reset/port signals, and bus interfaces (AXI4-Full, AXI4-Lite, AXI-Stream, Avalon-MM, Avalon-ST). Creates `<entity_name>.ip.yml` in the same directory.

**Import from Altera Platform Designer** — Parses a `_hw.tcl` file (Altera IP specification language) and creates an `.ip.yml` spec.

**Import from Xilinx Component XML** — Parses a Vivado IP-XACT `component.xml` and creates `.ip.yml`. If register data is present (memory maps), a `.mm.yml` is also created.

> **Note:** Import commands are experimental. Complex or non-standard files may not parse correctly.

---

### Vivado Integration

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Edit in IP Packager` | | Yes | Yes (`component.xml`) |
| `IPCraft: Open in Platform Designer` | | Yes | Yes (`_hw.tcl`) |
| `IPCraft: Scan Vivado IP Catalog` | Yes | | |
| `IPCraft: Scan Vivado Interface Catalog` | Yes | | |
| `IPCraft: Open in Vivado` | Yes | Yes | Yes (`.ip.yml`) |
| `IPCraft: Open in Quartus` | Yes | Yes | Yes (`.ip.yml`) |

**Edit in IP Packager** — Launches Vivado in GUI mode with the selected `component.xml`, opening it directly in the IP Packager. Requires Vivado to be configured (see `ipcraft.vivado.runner` and `ipcraft.vivado.installDir`).

**Open in Platform Designer** — Launches Quartus Platform Designer (qsys-edit) with the selected `_hw.tcl` component. Requires Quartus to be configured (see `ipcraft.quartus.runner` and `ipcraft.quartus.installDir`).

**Scan Vivado IP Catalog** — Invokes Vivado in batch mode to enumerate the installed IP catalog and caches the result in the IPCraft config directory. Used for bus-library suggestions.

**Scan Vivado Interface Catalog** — Invokes Vivado in batch mode to enumerate the installed bus/abstraction interface definitions and caches the result, so the canvas can suggest Vivado-native interface types.

**Open in Vivado** — Generates the Vivado project if it does not yet exist, then launches Vivado GUI pointing at the project. Prompts for a board/part if no default is configured.

**Open in Quartus** — Generates the Quartus project if it does not yet exist, then launches Quartus GUI pointing at the project. Prompts for a device if no default is configured.

---

### Browse

| Command | Palette | Editor Title |
|---------|:-------:|:------------:|
| `IPCraft: View Bus Definitions` | Yes | |
| `IPCraft: Scan Workspace Bus Definitions` | Yes | |
| `IPCraft: Copy Component Instance` | Yes | Yes (`.vhd`, `.vhdl`, `.v`, `.sv`) |

**View Bus Definitions** — Shows a QuickPick of the built-in bus definition YAML files (AXI4-Lite, AXI4, AXI-Stream, Avalon-MM, Avalon-ST, and custom definitions). Selecting one opens the file in a read-only editor.

**Scan Workspace Bus Definitions** — Re-scans the workspace for standalone bus/abstraction definition files (YAML files with a top-level `ports` array, or IP-XACT busDefinition/abstractionDefinition XML pairs) and refreshes the set of known interfaces available in the canvas Inspector.

**Copy Component Instance** — Copies a VHDL/Verilog instantiation template for the selected source file's entity/module to the clipboard.

---

### Walkthroughs

| Command | Palette |
|---------|:-------:|
| `IPCraft: Open Walkthrough...` | Yes |
| `IPCraft: Get Started with Scaffold Packs` | Yes |
| `IPCraft: Design Your First IP Core` | Yes |
| `IPCraft: IP Core with a Register Map` | Yes |
| `IPCraft: Bring Your VHDL into IPCraft` | Yes |
| `IPCraft: Import from Xilinx or Intel Tools` | Yes |
| `IPCraft: Synthesize and Check Timing` | Yes |

**Open Walkthrough...** — Shows a QuickPick of all IPCraft walkthroughs. The other commands each jump directly to one.

---

### Editor Mode

| Command | Palette | Editor Title |
|---------|:-------:|:------------:|
| `IPCraft: Open as Text Editor` | Yes | Yes (`.ip.yml`, `.mm.yml`) |
| `IPCraft: Open as Visual Editor` | Yes | Yes (`.ip.yml`, `.mm.yml`) |
| `IPCraft: Preview in IPCraft (Experimental)` | Yes | |

**Open as Text Editor** — Reopens the current `.ip.yml` or `.mm.yml` file in the default VS Code text editor.

**Open as Visual Editor** — Reopens the current file in the IPCraft visual editor. Useful after opening a file with the text editor.

**Preview in IPCraft** — Opens a read-only IPCraft preview panel for any YAML file. Experimental.

---

### Migrate

| Command | Palette |
|---------|:-------:|
| `IPCraft: Migrate Legacy IP Cores (vendor: → targets:)` | Yes |

**Migrate Legacy IP Cores** — Scans the workspace for `.ip.yml` files that use the old `vendor:` field and rewrites them to the new `targets:` array format used by `ipcraft.generate.targets`.

---

### Help and settings

| Command | Palette | Toolbar |
|---|:---:|:---:|
| `IPCraft: Open Extension Settings` | Yes | Yes |
| `IPCraft: Report Issue / Send Feedback` | Yes | Yes |

**Open Extension Settings** filters VS Code Settings to IPCraft options.

**Report Issue / Send Feedback** opens the project's issue and feedback page.

---

## Settings

Configure via **File → Preferences → Settings** and search for `IPCraft`, or edit `settings.json` directly.

### Vivado

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.vivado.runner` | `"local"` \| `"docker"` | `"local"` | How IPCraft executes Vivado. `local` uses a native install; `docker` runs every command in a container. |
| `ipcraft.vivado.installDir` | string | `""` | *(local)* Path to your Vivado installation directory (e.g. `/tools/Xilinx/Vivado/2024.2`). Leave empty to rely on `vivado` being in `PATH`. |
| `ipcraft.vivado.dockerImage` | string | `""` | *(docker)* Docker image used to run Vivado (e.g. `cvsoc/vivado:2024.2`). |
| `ipcraft.vivado.defaultPart` | string | `"xc7z020clg484-1"` | Fallback FPGA part when no board has been selected. |
| `ipcraft.customBoards.vivado` | object[] | `[]` | Custom Vivado boards shown under **My Boards** in the board picker. Each entry requires `label` (string) and `part` (Xilinx part number). |
| `ipcraft.vivado.pinnedPart` | string | `""` | Part chosen and pinned for the current workspace via the board picker; takes precedence over `defaultPart` when set. Written by the board picker, not usually edited by hand. |

### Quartus

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.quartus.runner` | `"local"` \| `"docker"` | `"local"` | How IPCraft executes Quartus. `local` uses a native install; `docker` runs every command in a container. |
| `ipcraft.quartus.installDir` | string | `""` | *(local)* Top-level Quartus installation directory (e.g. `/opt/intelFPGA_pro/23.1`). IPCraft automatically locates `quartus_sh` and `qsys-edit` inside it. |
| `ipcraft.quartus.dockerImage` | string | `""` | *(docker)* Docker image used to run Quartus (e.g. `cvsoc/quartus:23.1`). |
| `ipcraft.quartus.defaultDevice` | string | `"5CSEBA6U23I7"` | Fallback device part when no board has been selected. |
| `ipcraft.customBoards.quartus` | object[] | `[]` | Custom Quartus boards shown under **My Boards** in the board picker. Each entry requires `label` (string) and `device` (Intel/Altera part number). |
| `ipcraft.quartus.pinnedDevice` | string | `""` | Device chosen and pinned for the current workspace via the board picker; takes precedence over `defaultDevice` when set. Written by the board picker, not usually edited by hand. |

### Build

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.build.jobs` | number | `4` | Number of parallel jobs passed to Vivado `launch_runs` and Quartus compilation. |

### GUI / X11

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.gui.display` | string | `""` | `DISPLAY` environment variable to use for GUI tools (Vivado, Quartus, Platform Designer). Falls back to the process `DISPLAY` when unset. Useful for Remote SSH / X11 forwarding. |
| `ipcraft.gui.xauthority` | string | `""` | `XAUTHORITY` environment variable to use for GUI tools, for X11 forwarding setups that need an explicit auth file. |

### Generation

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.generate.targets` | string[] | `[]` | Synthesis vendor targets to include when scaffolding (e.g. `["vivado"]`, `["vivado","quartus"]`). Empty array generates HDL and testbench only. |
| `ipcraft.generate.hdlLanguage` | `"vhdl"` \| `"systemverilog"` | `"vhdl"` | HDL language for RTL file generation. |
| `ipcraft.generate.includeTestbench` | boolean | `true` | Include a testbench when scaffolding a project. |
| `ipcraft.generate.includeDocs` | boolean | `true` | Generate a Markdown IP datasheet (`docs/<ip_name>_datasheet.md`) when scaffolding a project. |
| `ipcraft.generate.scaffoldPack` | string | `""` | Scaffold pack used for RTL/testbench generation. See [Scaffold Packs](../how-to/customizing-generated-files-with-scaffold-packs.md). |

### Testbench

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.testbench.framework` | `"cocotb"` \| `"vunit"` | `"cocotb"` | Testbench framework. `cocotb` generates a Python/pytest test + Makefile; `vunit` generates a `run.py` + VHDL testbench entity. |
| `ipcraft.testbench.engine` | `"ghdl"` \| `"icarus"` \| `"verilator"` \| `"questa"` | `"ghdl"` | Simulation engine used by the generated testbench. |

### Toolbar

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.toolbar.targets` | string[] | `["vivado","quartus"]` | Which vendor toolchain sections to display in the IP Core editor toolbar. |

### Import

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.import.vendor` | string | `"user"` | Vendor name to assign when importing IP cores. `"user"` auto-detects from the git `user.email` domain. |
| `ipcraft.import.library` | string | `"ip"` | Default library name assigned when importing. |
| `ipcraft.import.version` | string | `"1.0.0"` | Default version string assigned when importing. |

### Paths

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.busLibraryPaths` | string[] | `[]` | Additional directories to search recursively for custom bus definition YAML files (`.yml`/`.yaml`). |
| `ipcraft.ipRepositoryPaths` | string[] | `[]` | Additional directories to scan for IP cores (directories containing `.ip.yml` or `component.xml` files). |
| `ipcraft.scaffoldPackPaths` | string[] | `[]` | Additional directories to scan recursively for custom Scaffold Packs. See [Scaffold Packs](../how-to/customizing-generated-files-with-scaffold-packs.md). |

---

## IPCraft Build Sidebar Panel

The **IPCraft Build** panel in the Explorer sidebar shows the result of the last `IPCraft: Build` invocation. It has four states:

| State | Display |
|-------|---------|
| Idle | *No build yet — run IPCraft: Build* |
| Running | Spinner with *Building…* |
| Failed | Error icon with *Build failed — check Output Channel* |
| Success | Expandable tree of timing and utilization results |

When a build succeeds, the tree shows:

```
Vivado — OOC          PASS
├── Timing            PASS
│   ├── WNS +1.234 ns PASS
│   ├── WHS +0.456 ns PASS
│   └── Failing paths: 0
└── Utilization
    ├── LUT: 1,234 / 53,200 (2.3%)
    ├── FF:  2,891 / 106,400 (2.7%)
    └── BRAM: 4 / 140 (2.9%)
```

Clicking **Timing** or a CDC node opens the corresponding report file in the editor.

---

## Status Bar Item

The `$(circuit-board) IPCraft` item appears in the left status bar throughout the session.

| State | Display |
|-------|---------|
| Idle | `$(circuit-board) IPCraft` |
| Building | `$(loading~spin) Building…` |
| Passed (Vivado) | `$(pass) WNS +1.23ns` |
| Passed (Quartus) | `$(pass) Fmax 156 MHz` |
| Failed | `$(error) Build failed` (red background) |

Clicking the item opens the *IPCraft Build* Output Channel.
