# Commands & Settings Reference

Complete reference for all IPCraft commands, context menus, and configuration settings.

---

## Commands

All commands are available in the Command Palette (`Ctrl+Shift+P`) under the **IPCraft** category. Many commands are also reachable from the **IPCraft** top-level application menu bar entry or from the editor title bar icon.

### Create

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: New IP Core` | ✓ | ✓ | |
| `IPCraft: New Register Map` | ✓ | ✓ | |
| `IPCraft: New IP Core + Register Map` | ✓ | ✓ | |

**New IP Core** — Creates a new `.ip.yml` file with a minimal VLNV skeleton and opens it in the IP Core visual editor.

**New Register Map** — Creates a new `.mm.yml` file with an empty address block and opens it in the Memory Map visual editor.

**New IP Core + Register Map** — Creates both files at once and links them via a `memoryMapRef` bus interface.

---

### Scaffold & Generate

These commands are available on `.ip.yml` files.

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Scaffold Project` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Top-Level HDL` | ✓ | | |
| `IPCraft: Generate CocoTB Testbench` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Vivado Project` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Quartus Project` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Altera Platform Designer Component (_hw.tcl)` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Xilinx Vivado Component (component.xml)` | ✓ | ✓ | ✓ |
| `IPCraft: Generate & Build (Vivado OOC)` | ✓ | ✓ | ✓ |
| `IPCraft: Generate & Build (Quartus)` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Documentation` | ✓ | ✓ | ✓ |

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
| `IPCraft: Preview Template Output` | ✓ | ✓ (`.j2` files) |
| `IPCraft: Export Built-in Scaffold Pack` | ✓ | |

**Preview Template Output** — Opens a read-only, live-refreshing preview of a `.j2` template's rendered output next to the editor, evaluated against a pinned or auto-detected `.ip.yml` file. See [Scaffold Packs](../how-to/scaffold-packs.md).

**Export Built-in Scaffold Pack** — Copies a built-in or example scaffold pack (and all its templates) into `.vscode/ipcraft/packs/<name>/` in the workspace as a starting point for customization.

---

### Validate

These commands are available on `.ip.yml` files.

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Check Consistency` | ✓ | ✓ | ✓ |
| `IPCraft: Check HDL Consistency (managed:false)` | ✓ | ✓ | |

**Check Consistency** — Cross-references the spec's declared ports, clocks, resets, generics, bus interfaces, and registers against the generated top-level HDL entity/module and, when scaffolded, the Platform Designer (`_hw.tcl`) and Vivado (`component.xml`) vendor artifacts. Reports drift in both directions: implementation-only items (extra port/parameter — a plausible adopt) and spec-only items (missing port/parameter — declared but gone from the implementation), plus property mismatches (direction/width/default) on items both sides declare.

**Check HDL Consistency (managed:false)** — The same cross-check restricted to the top-level HDL entity/module, regardless of the file's `managed:` flag.

---

### Build

These commands are available on `.ip.yml` files and require vendor tools installed and reachable (see Settings below).

| Command | Palette | IPCraft Menu | Editor Title | Status Bar |
|---------|:-------:|:------------:|:------------:|:----------:|
| `IPCraft: Build` | ✓ | ✓ | ✓ | |
| `IPCraft: Build: Vivado OOC Synthesis` | ✓ | ✓ | | |
| `IPCraft: Build: Quartus Compile` | ✓ | ✓ | | |
| `IPCraft: Show Build Output` | ✓ | ✓ | | ✓ (click) |

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
| `IPCraft: Import from VHDL (Experimental)` | ✓ | ✓ | ✓ (`.vhd`, `.vhdl`) |
| `IPCraft: Import from Altera Platform Designer (Experimental)` | ✓ | ✓ | ✓ (`_hw.tcl`) |
| `IPCraft: Import from Xilinx Component XML (Experimental)` | ✓ | ✓ | ✓ (`component.xml`) |

**Import from VHDL** — Parses a `.vhd` or `.vhdl` file and extracts entity name, generics, clock/reset/port signals, and bus interfaces (AXI4-Full, AXI4-Lite, AXI-Stream, Avalon-MM, Avalon-ST). Creates `<entity_name>.ip.yml` in the same directory.

**Import from Altera Platform Designer** — Parses a `_hw.tcl` file (Altera IP specification language) and creates an `.ip.yml` spec.

**Import from Xilinx Component XML** — Parses a Vivado IP-XACT `component.xml` and creates `.ip.yml`. If register data is present (memory maps), a `.mm.yml` is also created.

> **Note:** Import commands are experimental. Complex or non-standard files may not parse correctly.

---

### Vivado Integration

| Command | Palette | IPCraft Menu | Editor Title |
|---------|:-------:|:------------:|:------------:|
| `IPCraft: Edit in IP Packager` | | ✓ | ✓ (`component.xml`) |
| `IPCraft: Open in Platform Designer` | | ✓ | ✓ (`_hw.tcl`) |
| `IPCraft: Scan Vivado IP Catalog` | ✓ | | |
| `IPCraft: Scan Vivado Interface Catalog` | ✓ | | |
| `IPCraft: Open in Vivado` | ✓ | ✓ | ✓ (`.ip.yml`) |
| `IPCraft: Open in Quartus` | ✓ | ✓ | ✓ (`.ip.yml`) |

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
| `IPCraft: View Bus Definitions` | ✓ | |
| `IPCraft: Scan Workspace Bus Definitions` | ✓ | |
| `IPCraft: Copy Component Instance` | ✓ | ✓ (`.vhd`, `.vhdl`, `.v`, `.sv`) |

**View Bus Definitions** — Shows a QuickPick of the built-in bus definition YAML files (AXI4-Lite, AXI4, AXI-Stream, Avalon-MM, Avalon-ST, and custom definitions). Selecting one opens the file in a read-only editor.

**Scan Workspace Bus Definitions** — Re-scans the workspace for standalone bus/abstraction definition files (YAML files with a top-level `ports` array, or IP-XACT busDefinition/abstractionDefinition XML pairs) and refreshes the set of known interfaces available in the canvas Inspector.

**Copy Component Instance** — Copies a VHDL/Verilog instantiation template for the selected source file's entity/module to the clipboard.

---

### Walkthroughs

| Command | Palette |
|---------|:-------:|
| `IPCraft: Open Walkthrough...` | ✓ |
| `IPCraft: Get Started with Scaffold Packs` | ✓ |
| `IPCraft: Design Your First IP Core` | ✓ |
| `IPCraft: IP Core with a Register Map` | ✓ |
| `IPCraft: Bring Your VHDL into IPCraft` | ✓ |
| `IPCraft: Import from Xilinx or Intel Tools` | ✓ |
| `IPCraft: Synthesize and Check Timing` | ✓ |

**Open Walkthrough...** — Shows a QuickPick of all IPCraft walkthroughs. The other commands each jump directly to one.

---

### Editor Mode

| Command | Palette | Editor Title |
|---------|:-------:|:------------:|
| `IPCraft: Open as Text Editor` | ✓ | ✓ (`.ip.yml`, `.mm.yml`) |
| `IPCraft: Open as Visual Editor` | ✓ | ✓ (`.ip.yml`, `.mm.yml`) |
| `IPCraft: Preview in IPCraft (Experimental)` | ✓ | |

**Open as Text Editor** — Reopens the current `.ip.yml` or `.mm.yml` file in the default VS Code text editor.

**Open as Visual Editor** — Reopens the current file in the IPCraft visual editor. Useful after opening a file with the text editor.

**Preview in IPCraft** — Opens a read-only IPCraft preview panel for any YAML file. Experimental.

---

### Migrate

| Command | Palette |
|---------|:-------:|
| `IPCraft: Migrate Legacy IP Cores (vendor: → targets:)` | ✓ |

**Migrate Legacy IP Cores** — Scans the workspace for `.ip.yml` files that use the old `vendor:` field and rewrites them to the new `targets:` array format used by `ipcraft.generate.targets`.

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
| `ipcraft.generate.scaffoldPack` | string | `""` | Scaffold pack used for RTL/testbench generation. See [Scaffold Packs](../how-to/scaffold-packs.md). |

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
| `ipcraft.scaffoldPackPaths` | string[] | `[]` | Additional directories to scan recursively for custom Scaffold Packs. See [Scaffold Packs](../how-to/scaffold-packs.md). |

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
Vivado — OOC          ✓
├── Timing            ✓
│   ├── WNS +1.234 ns ✓
│   ├── WHS +0.456 ns ✓
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
