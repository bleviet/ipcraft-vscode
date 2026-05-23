# IPCraft for VS Code

Visual editor for FPGA IP Core and Memory Map specifications — design, generate, and build from inside VS Code.

## Features

### Visual Editors
- **IP Core Canvas** — block-diagram editor for IP cores; drag clocks, resets, ports, bus interfaces, and generics from a palette onto an SVG schematic
- **Canvas Inspector** — click any element to edit its properties inline, without leaving the diagram
- **Memory Map Editor** — tabular editor for address blocks, registers, and bit fields with visual bit-layout view
- **Bit Field Visualizer** — drag to resize fields, Shift+click to create new fields, Ctrl+drag to reorder
- **Real-time Validation** — YAML cross-reference checks with click-to-navigate error list
- **Bi-directional Sync** — changes in the visual editor are instantly reflected in the YAML source, and vice versa

### HDL Generation
- **Full Project Scaffold** — one command generates a package, top entity, user-logic skeleton, bus wrapper (AXI-Lite or Avalon-MM), register file with field decode, testbench, and vendor project files in either **VHDL** (`.vhd`) or **SystemVerilog** (`.sv`), controlled by the `ipcraft.generate.hdlLanguage` setting
- **Vendor Integration** — generates Xilinx/AMD Vivado OOC synthesis project (`.tcl`, `.xdc`) and Intel/Altera Quartus project (`.tcl`, `.sdc`), both ready to open or run headlessly

### Headless Build (no GUI required)
- **Batch Compilation** — runs Vivado or Quartus in batch mode from inside VS Code; live output streams to a dedicated Output Channel
- **OOC Synthesis** — fast out-of-context synthesis via `vivado -mode batch`; reports in `xilinx/build/ooc/`
- **Full Implementation** — synthesis + place + route via Vivado project mode; reports in `xilinx/build/xpr/`
- **Quartus Compile** — full synthesis + fitting + timing via `quartus_sh --flow compile`; reports in `altera/build/output_files/`
- **Build Reports Panel** — Explorer sidebar tree showing WNS/WHS (Vivado) or Fmax (Quartus), LUT/FF/BRAM/DSP utilization, and CDC violations; click any row to open the raw report file
- **Status Bar** — live `$(loading~spin) Building…` indicator; collapses to `✓ WNS +1.23ns` or `✓ Fmax 156 MHz` when done

### Import
- **Parse VHDL** — reverse-engineer an existing `.vhd` entity into an `.ip.yml` specification, with automatic clock/reset/bus-interface detection
- **Parse Platform Designer** — import an Altera `_hw.tcl` component into an `.ip.yml` spec; `source` directives are followed recursively so multi-file IP core packages are imported in full
- **Parse Vivado IP** — import a Xilinx `component.xml` (IP-XACT) into an `.ip.yml` spec

---

## Commands

All commands are available in the Command Palette (`Ctrl+Shift+P`) under the **IPCraft** category. Many also appear in the Explorer and editor title-bar context menus when an `.ip.yml` file is active.

### Create

| Command | Description |
|---------|-------------|
| `IPCraft: New IP Core` | Create a new `.ip.yml` specification file |
| `IPCraft: New Memory Map` | Create a new `.mm.yml` specification file |
| `IPCraft: New IP Core + Memory Map` | Create both files and link them |

### Scaffold & Generate

| Command | Description |
|---------|-------------|
| `IPCraft: Scaffold Project` | Generate RTL sources (VHDL or SystemVerilog) + testbench + Vivado and Quartus project files in one step |
| `IPCraft: Generate HDL` | Generate RTL source files only (package, top, core, bus wrapper, register file) in the configured HDL language |
| `IPCraft: Generate CocoTB Testbench` | Generate a cocotb Python test skeleton and GHDL Makefile |
| `IPCraft: Generate Vivado Project` | Generate Vivado OOC synthesis project files for a chosen FPGA part |
| `IPCraft: Generate Quartus Project` | Generate a Quartus project for a chosen device |
| `IPCraft: Generate Altera Platform Designer Component (_hw.tcl)` | Export an Altera Platform Designer integration file |
| `IPCraft: Generate Xilinx Vivado Component (component.xml)` | Export a Vivado IP-XACT descriptor and XGUI TCL |

### Build (requires vendor tools in PATH or configured)

| Command | Description |
|---------|-------------|
| `IPCraft: Build` | Detect available build targets and compile headlessly; shows a QuickPick when both Vivado and Quartus targets exist |
| `IPCraft: Show Build Output` | Open the *IPCraft Build* Output Channel |

### Import

| Command | Description |
|---------|-------------|
| `IPCraft: Parse VHDL to .ip.yml` | Convert an existing VHDL entity into an IP Core spec |
| `IPCraft: Parse Altera Platform Designer Component (_hw.tcl) to .ip.yml` | Convert an Altera `_hw.tcl` file into an IP Core spec |
| `IPCraft: Parse Xilinx component.xml to .ip.yml` | Convert a Vivado `component.xml` file into an IP Core spec |

### Vivado Integration

| Command | Description |
|---------|-------------|
| `IPCraft: Edit in IP Packager` | Open the selected `component.xml` in the Vivado IP Packager GUI |
| `IPCraft: Scan Vivado IP Catalog` | Scan the installed Vivado IP catalog and cache the results for bus-library suggestions |

### Browse

| Command | Description |
|---------|-------------|
| `IPCraft: View Bus Definitions` | Browse the built-in library of bus interface definitions |

---

## Generated Project Layout

`IPCraft: Scaffold Project` produces the following structure next to the `.ip.yml` file.
File extensions are `.vhd` for VHDL (default) or `.sv` for SystemVerilog, depending on `ipcraft.generate.hdlLanguage`:

```text
<ip_name>/
  rtl/
    <ip_name>_pkg.vhd/.sv    # Package — register constants and types
    <ip_name>.vhd/.sv         # Top entity — instantiates core + bus wrapper
    <ip_name>_core.vhd/.sv    # User logic skeleton (edit this)
    <ip_name>_axil.vhd/.sv    # AXI-Lite bus wrapper (or _avmm for Avalon-MM)
    <ip_name>_regs.vhd/.sv    # Register file with field decode
  tb/
    <ip_name>_test.py         # cocotb test skeleton
    Makefile                  # GHDL simulation Makefile
  xilinx/
    component.xml             # Vivado IP-XACT descriptor
    xgui/<ip_name>_v*.tcl    # Vivado XGUI customization
    <ip_name>_project.tcl    # Creates Vivado OOC synthesis project
    <ip_name>_run_ooc.tcl    # Runs OOC synthesis headlessly
    <ip_name>_run_xpr.tcl    # Runs full synthesis + implementation headlessly
    <ip_name>_ooc.xdc        # OOC timing constraints (clocks)
    build/ooc/               # Created by IPCraft: Build
      timing.rpt
      utilization.rpt
      cdc.rpt
    build/xpr/               # Created by IPCraft: Build (XPR mode)
      timing.rpt
      utilization.rpt
      cdc.rpt
  altera/
    <ip_name>_hw.tcl          # Platform Designer integration
    <ip_name>_project.tcl    # Creates Quartus project
    <ip_name>.sdc             # SDC timing constraints
    build/                   # Created by IPCraft: Build
      output_files/
        <ip_name>.sta.summary # Timing summary
        <ip_name>.fit.summary # Resource utilization
```

---

## Settings

Configure IPCraft via **File → Preferences → Settings** (search for `IPCraft`):

| Setting | Default | Description |
|---------|---------|-------------|
| `ipcraft.vivadoPath` | _(empty)_ | Path to the Vivado executable (e.g. `/tools/Xilinx/Vivado/2024.2/bin/vivado`). Leave empty to use `vivado` from PATH. Vivado commands are greyed out when the executable cannot be found |
| `ipcraft.vivado.defaultPart` | `xc7z020clg484-1` | Default FPGA part for Vivado projects |
| `ipcraft.quartus.installDir` | _(empty)_ | Top-level Quartus install directory (e.g. `/opt/intelFPGA_pro/23.1` or `C:\intelFPGA_pro\23.1`). IPCraft locates `quartus_sh`, `quartus`, and `qsys-edit` automatically. Commands that require Quartus are greyed out until a valid directory is set |
| `ipcraft.quartus.defaultDevice` | `5CSEBA6U23I7` | Default device for Quartus projects |
| `ipcraft.build.jobs` | `4` | Parallel jobs for Vivado `launch_runs` |
| `ipcraft.generate.vendor` | `none` | Vendor files to auto-include when scaffolding (`none`, `altera`, `xilinx`, `both`) |
| `ipcraft.generate.hdlLanguage` | `vhdl` | RTL language for generated source files (`vhdl` or `systemverilog`) |
| `ipcraft.generate.includeTestbench` | `true` | Include cocotb testbench when scaffolding |
| `ipcraft.busLibraryPaths` | `[]` | Extra directories to search for custom bus definition YAML files |
| `ipcraft.ipRepositoryPaths` | `[]` | Extra directories to scan for IP cores |

---

## Keyboard Shortcuts

### IP Core Canvas

| Key | Action |
|-----|--------|
| `Delete` | Delete selected element |
| `Ctrl+D` / `Cmd+D` | Duplicate selected element |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Cmd+Y` | Redo |
| `Ctrl+0` / `Cmd+0` | Reset zoom to 100% |
| `Escape` | Deselect |
| `Ctrl+Wheel` | Zoom in / out |

### Memory Map / Register Table

| Key | Action |
|-----|--------|
| Arrow keys or `h`/`j`/`k`/`l` | Navigate cells |
| `F2` or `e` | Enter edit mode |
| `Enter` | Save edit |
| `Escape` | Cancel edit |
| `o` / `Shift+O` | Insert field after / before |
| `d` or `Delete` | Delete selected field |
| `Alt+Up` / `Alt+Down` | Move field |

---

## Documentation

Full documentation is in the `docs/` directory, built with [MkDocs](https://www.mkdocs.org/):

```bash
pip install mkdocs mkdocs-material
mkdocs serve
```

Then open `http://127.0.0.1:8000`.

---

## Development

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host.

```bash
npm run watch        # watch mode
npm run test:unit    # unit tests (579 tests)
npm run lint         # ESLint (zero warnings)
npm run type-check   # TypeScript check
```

See [Development Setup](docs/getting-started/development.md) for the full contributor workflow.

---

## License

[MIT](LICENSE)
