# Commands & Settings Reference

Complete reference for all IPCraft commands, context menus, and configuration settings.

---

## Commands

All commands are available in the Command Palette (`Ctrl+Shift+P`) under the **IPCraft** category. The tables below also indicate where each command appears in context menus.

### Create

| Command | Palette | Explorer | Editor Title |
|---------|:-------:|:--------:|:------------:|
| `IPCraft: New IP Core` | ✓ | | |
| `IPCraft: New Memory Map` | ✓ | | |
| `IPCraft: New IP Core + Memory Map` | ✓ | | |

**New IP Core** — Creates a new `.ip.yml` file with a minimal VLNV skeleton and opens it in the IP Core visual editor.

**New Memory Map** — Creates a new `.mm.yml` file with an empty address block and opens it in the Memory Map visual editor.

**New IP Core + Memory Map** — Creates both files at once and links them via a `memoryMapRef` bus interface.

---

### Scaffold & Generate

These commands are available on `.ip.yml` files.

| Command | Palette | Explorer | Editor Title |
|---------|:-------:|:--------:|:------------:|
| `IPCraft: Scaffold VHDL Project` | ✓ | ✓ | ✓ |
| `IPCraft: Generate VHDL` | ✓ | | |
| `IPCraft: Generate CocoTB Testbench` | ✓ | | ✓ |
| `IPCraft: Generate Vivado Project` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Quartus Project` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Altera Platform Designer Component (_hw.tcl)` | ✓ | ✓ | ✓ |
| `IPCraft: Generate Xilinx Vivado Component (component.xml)` | ✓ | ✓ | ✓ |

**Scaffold VHDL Project** — The all-in-one command. Generates VHDL RTL files, a cocotb testbench, and Vivado/Quartus project files in a single step. Part number and device are read from settings (`ipcraft.vivado.defaultPart`, `ipcraft.quartus.defaultDevice`). The output is written next to the `.ip.yml` file.

**Generate VHDL** — Generates RTL source files only (package, top entity, core skeleton, bus wrapper, register file). Prompts for an output directory.

**Generate CocoTB Testbench** — Generates `<ip_name>_test.py` and `Makefile` (GHDL) in the `tb/` directory.

**Generate Vivado Project** — Prompts for an FPGA part number, then generates `xilinx/<ip_name>_project.tcl` (OOC project creator), `xilinx/<ip_name>_run_ooc.tcl` (OOC synthesis runner), `xilinx/<ip_name>_run_xpr.tcl` (full implementation runner), and `xilinx/<ip_name>_ooc.xdc` (timing constraints).

**Generate Quartus Project** — Prompts for a device part number, then generates `altera/<ip_name>_project.tcl` and `altera/<ip_name>.sdc`.

**Generate Altera Platform Designer Component** — Exports `altera/<ip_name>_hw.tcl` for use in Quartus Platform Designer.

**Generate Xilinx Vivado Component** — Exports `xilinx/component.xml` and `xilinx/xgui/<ip_name>_v*.tcl` for use in the Vivado IP catalog.

---

### Build

These commands are available on `.ip.yml` files and require vendor tools installed and reachable (see Settings below).

| Command | Palette | Explorer | Editor Title | Status Bar |
|---------|:-------:|:--------:|:------------:|:----------:|
| `IPCraft: Build` | ✓ | ✓ | ✓ | |
| `IPCraft: Show Build Output` | ✓ | | | ✓ (click) |

**Build** — Detects available build targets by checking for `xilinx/<ip_name>_run_ooc.tcl`, `xilinx/<ip_name>_run_xpr.tcl`, and `altera/<ip_name>_project.tcl`. When multiple targets exist, a QuickPick is shown. The selected tool runs in batch mode; output streams live to the *IPCraft Build* Output Channel. On completion, the *IPCraft Build* sidebar panel updates with parsed timing and utilization metrics.

Available build targets:

| Target | Tool | Reports written to |
|--------|------|--------------------|
| Vivado OOC Synthesis | `vivado -mode batch` | `xilinx/build/ooc/` |
| Vivado Full Implementation (XPR) | `vivado -mode batch` | `xilinx/build/xpr/` |
| Quartus Compile | `quartus_sh --flow compile` | `altera/build/output_files/` |

**Show Build Output** — Opens the *IPCraft Build* Output Channel. The status bar item also triggers this command on click.

---

### Import

| Command | Palette | Explorer | Editor Title |
|---------|:-------:|:--------:|:------------:|
| `IPCraft: Parse VHDL to .ip.yml` | ✓ | ✓ (`.vhd`, `.vhdl`) | ✓ (`.vhd`, `.vhdl`) |
| `IPCraft: Parse Altera Platform Designer Component (_hw.tcl) to .ip.yml` | ✓ | ✓ (`_hw.tcl`) | ✓ (`_hw.tcl`) |
| `IPCraft: Parse Xilinx component.xml to .ip.yml` | ✓ | ✓ (`component.xml`) | ✓ (`component.xml`) |

**Parse VHDL to .ip.yml** — Parses a `.vhd` or `.vhdl` file and extracts entity name, generics, clock/reset/port signals, and AXI-Lite or Avalon-MM bus interfaces. Creates `<entity_name>.ip.yml` in the same directory.

**Parse Altera Platform Designer Component** — Parses a `_hw.tcl` file (Altera IP specification language) and creates an `.ip.yml` spec.

**Parse Xilinx component.xml** — Parses a Vivado IP-XACT `component.xml` and creates `.ip.yml`. If register data is present (memory maps), a `.mm.yml` is also created.

---

### Vivado Integration

| Command | Palette | Explorer | Editor Title |
|---------|:-------:|:--------:|:------------:|
| `IPCraft: Edit in IP Packager` | | ✓ (`component.xml`) | ✓ (`component.xml`) |
| `IPCraft: Scan Vivado IP Catalog` | ✓ | | |

**Edit in IP Packager** — Launches Vivado in GUI mode with the selected `component.xml`, opening it directly in the IP Packager. Requires `ipcraft.vivadoPath` to be set correctly.

**Scan Vivado IP Catalog** — Invokes Vivado in batch mode to enumerate the installed IP catalog and caches the result in the IPCraft config directory. Used for bus-library suggestions.

---

### Browse

| Command | Palette |
|---------|:-------:|
| `IPCraft: View Bus Definitions` | ✓ |

**View Bus Definitions** — Shows a QuickPick of the built-in bus definition YAML files (AXI4-Lite, AXI4, AXI-Stream, Avalon-MM, Avalon-ST, and custom definitions). Selecting one opens the file in a read-only editor.

---

## Settings

Configure via **File → Preferences → Settings** and search for `IPCraft`, or edit `settings.json` directly.

### Vivado

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.vivadoPath` | string | `"vivado"` | Path to the Vivado executable. Set to the full path if not in `PATH` (e.g., `/tools/Xilinx/Vivado/2024.2/bin/vivado`). |
| `ipcraft.vivado.defaultPart` | string | `"xc7z020clg484-1"` | Default FPGA part used when generating a Vivado project. |

### Quartus

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.quartus.shellPath` | string | `"quartus_sh"` | Path to the Quartus Shell executable (`quartus_sh`). Set to the full path if not in `PATH`. |
| `ipcraft.quartus.defaultDevice` | string | `"5CSEBA6U23I7"` | Default device part used when generating a Quartus project (e.g., DE10-Nano Cyclone V SoC). |

### Build

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.build.jobs` | number | `4` | Number of parallel jobs passed to `launch_runs` in Vivado. |

### Generation

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.generate.vendor` | enum | `"none"` | Vendor integration files to include when scaffolding: `none`, `altera`, `xilinx`, `both`. |
| `ipcraft.generate.includeTestbench` | boolean | `true` | Include a cocotb testbench when scaffolding a project. |

### Import

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.import.vendor` | string | `"user"` | Vendor name to assign when importing IP cores. `"user"` auto-detects from the git `user.email` domain. |
| `ipcraft.import.library` | string | `"ip"` | Default library name assigned when importing. |
| `ipcraft.import.version` | string | `"1.0.0"` | Default version string assigned when importing. |

### Paths

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipcraft.busLibraryPaths` | string[] | `[]` | Additional directories to search recursively for custom bus definition YAML files (`.busdef.yml`). |
| `ipcraft.ipRepositoryPaths` | string[] | `[]` | Additional directories to scan for IP cores (directories containing `.ip.yml` or `component.xml` files). |

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
