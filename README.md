# IPCraft for VS Code

Visual editor for FPGA IP Core and Memory Map specifications — design, generate, and build from inside VS Code.

## Features

### Visual Editors
- **IP Core Canvas** — block-diagram editor for IP cores; drag clocks, resets, ports, bus interfaces, and generics from a palette onto an SVG schematic
- **Canvas Inspector** — click any element to edit its properties inline, without leaving the diagram
- **Memory Map Editor** — tabular editor for address blocks, registers, and bit fields with visual bit-layout view
- **Bit Field Visualizer** — drag to resize fields, Shift+click to create new fields, Ctrl+drag to reorder
- **Custom Interfaces** — define conduit (custom) bus interfaces with user-named signals, stored as reusable `.busdef.yml` files
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
- **Docker Runner** — run Vivado or Quartus commands inside a container instead of a local install, via `ipcraft.vivado.runner` / `ipcraft.quartus.runner`
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
| `IPCraft: New Register Map` | Create a new `.mm.yml` specification file |
| `IPCraft: New IP Core + Memory Map` | Create both files and link them |

### Scaffold & Generate

| Command | Description |
|---------|-------------|
| `IPCraft: Scaffold Project` | Generate RTL sources (VHDL or SystemVerilog) + testbench + vendor project files in one step |
| `IPCraft: Generate Top-Level HDL` | Generate RTL source files only (package, top, core, bus wrapper, register file) in the configured HDL language |
| `IPCraft: Generate CocoTB Testbench` | Generate a testbench skeleton (cocotb or VUnit, per `ipcraft.testbench.framework`) and simulation Makefile |
| `IPCraft: Generate Vivado Project` | Generate Vivado OOC synthesis project files for a chosen FPGA part |
| `IPCraft: Generate Quartus Project` | Generate a Quartus project for a chosen device |
| `IPCraft: Generate Altera Platform Designer Component (_hw.tcl)` | Export an Altera Platform Designer integration file |
| `IPCraft: Generate Xilinx Vivado Component (component.xml)` | Export a Vivado IP-XACT descriptor and XGUI TCL |
| `IPCraft: Generate & Build (Vivado OOC)` | Scaffold and immediately run Vivado OOC synthesis in one step |
| `IPCraft: Generate & Build (Quartus)` | Scaffold and immediately run a Quartus compile in one step |
| `IPCraft: Preview Template Output` | Render a generator template against the current spec without writing files |
| `IPCraft: Export Built-in Scaffold Pack` | Copy a built-in Scaffold Pack out as an editable starting point for a custom pack |

### Build (requires vendor tools in PATH, Docker, or configured install dirs)

| Command | Description |
|---------|-------------|
| `IPCraft: Build` | Detect available build targets and compile headlessly; shows a QuickPick when both Vivado and Quartus targets exist |
| `IPCraft: Build: Vivado OOC Synthesis` | Run Vivado OOC synthesis directly, without the target picker |
| `IPCraft: Build: Quartus Compile` | Run a Quartus compile directly, without the target picker |
| `IPCraft: Show Build Output` | Open the *IPCraft Build* Output Channel |

### Import

| Command | Description |
|---------|-------------|
| `IPCraft: Import from VHDL (Experimental)` | Convert an existing VHDL entity into an IP Core spec |
| `IPCraft: Import from Altera Platform Designer (Experimental)` | Convert an Altera `_hw.tcl` file into an IP Core spec |
| `IPCraft: Import from Xilinx Component XML (Experimental)` | Convert a Vivado `component.xml` file into an IP Core spec |
| `IPCraft: Migrate Legacy IP Cores (vendor: → targets:)` | Rewrite `.ip.yml` files using the old `vendor:` field to the current `targets:` schema |

### Vivado / Quartus Integration

| Command | Description |
|---------|-------------|
| `IPCraft: Edit in IP Packager` | Open the selected `component.xml` in the Vivado IP Packager GUI |
| `IPCraft: Open in Platform Designer` | Open the selected `_hw.tcl` in Altera/Intel Platform Designer (`qsys-edit`) |
| `IPCraft: Open in Vivado` | Open the generated Vivado project in the Vivado GUI |
| `IPCraft: Open in Quartus` | Open the generated Quartus project in the Quartus GUI |
| `IPCraft: Scan Vivado IP Catalog` | Scan the installed Vivado IP catalog and cache the results for bus-library suggestions |
| `IPCraft: Scan Vivado Interface Catalog` | Scan Vivado's built-in IP-XACT bus interface definitions for use in the interface picker |
| `IPCraft: Scan Workspace Bus Definitions` | Scan the workspace (and `ipcraft.busLibraryPaths`) for custom bus definition files |

### Browse & Preview

| Command | Description |
|---------|-------------|
| `IPCraft: View Bus Definitions` | Browse the built-in library of bus interface definitions |
| `IPCraft: Preview in IPCraft (Experimental)` | Preview a `.ip.yml`/`.mm.yml` file from another extension's editor in IPCraft's visual editor |
| `IPCraft: Open as Text Editor` | Reopen the current spec file in VS Code's built-in text editor |
| `IPCraft: Open as Visual Editor` | Reopen the current spec file in the IPCraft visual editor |
| `IPCraft: Copy Component Instance` | Copy a VHDL/SystemVerilog instantiation template for the current IP core to the clipboard |
| `IPCraft: Open Extension Settings` | Open VS Code settings scoped to `ipcraft.*` |

### Walkthroughs

Available from **Help → Get Started** or `IPCraft: Open Walkthrough...`: *Design Your First IP Core*, *IP Core with a Register Map*, *Bring Your VHDL into IPCraft*, *Import from Xilinx or Intel Tools*, *Synthesize and Check Timing*, and *Get Started with Scaffold Packs*.

The full command list, including every setting's default and description, is in [Commands & Settings](docs/reference/commands.md).

---

## Generated Project Layout

`IPCraft: Scaffold Project` produces the following structure next to the `.ip.yml` file, using the default `builtin-ipcraft` Scaffold Pack (see [Scaffold Packs](docs/how-to/scaffold-packs.md) to customize file layout). `xilinx/` and `altera/` are only generated when `vivado` / `quartus` are listed in `ipcraft.generate.targets`.
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
    <ip_name>_test.py         # cocotb test skeleton (or run.py for VUnit)
    conftest.py               # cocotb/pytest fixtures
    test_<ip_name>_sim.py     # pytest entry point that drives the simulation
    Makefile                  # Simulation Makefile for the configured engine
                               # (ipcraft.testbench.engine: ghdl/icarus/verilator/questa)
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

## Headless CLI

`ipcraft generate` runs the same generator the extension uses, from the command line — no VS Code, no extension source tree, no `npm run compile-tests`. Useful for CI (regenerate-and-diff, see `ipcraft-vscode#73`) or scripting.

```bash
npx ipcraft generate path/to.ip.yml --target quartus --lang systemverilog --out gen/
```

| Option | Description |
|---|---|
| `--target <quartus\|vivado>[,<...>]` | Vendor target(s) to scaffold a project for (repeatable or comma-separated). Omit for RTL + testbench only. |
| `--lang <vhdl\|systemverilog>` | HDL language to generate (default: `vhdl`) |
| `--out <dir>` | Output directory (default: alongside the `.ip.yml`) |
| `--pack <name>` | Scaffold pack to use (overrides `scaffold_pack` in the `.ip.yml`) |
| `--quartus-device <part>` | Quartus device part (default: `5CSEBA6U23I7`) |
| `--vivado-part <part>` | Vivado part (default: `xc7z020clg484-1`) |

A schema-invalid `.ip.yml` prints a readable error and exits non-zero:

```bash
$ npx ipcraft generate broken.ip.yml
Generation failed: IP core YAML schema validation failed: simulation.engine: must be equal to one of the allowed values
$ echo $?
1
```

### Stale-output detection: `ipcraft verify`

`ipcraft verify` regenerates a `.ip.yml` in memory and diffs it against what's actually committed in a generated directory — a tooling guarantee that generated output was regenerated after the last spec edit, suitable for CI or a pre-commit hook. It takes the same `--target`/`--lang`/`--pack`/`--quartus-device`/`--vivado-part` options as `generate` (use whatever the directory was originally generated with):

```bash
npx ipcraft verify path/to.ip.yml gen/ --target quartus --lang systemverilog
```

Exits `0` when every generated file matches a fresh generation; otherwise exits non-zero and names every stale (or missing) file:

```bash
$ npx ipcraft verify path/to.ip.yml gen/ --target quartus
Stale: 1 file(s) differ from a fresh generation:
  altera/led_blink.sdc
$ echo $?
1
```

---

## Settings

Configure IPCraft via **File → Preferences → Settings** (search for `IPCraft`). Full defaults and descriptions: [Commands & Settings](docs/reference/commands.md).

| Setting | Default | Description |
|---------|---------|-------------|
| `ipcraft.generate.targets` | `[]` | Vendor toolchains to generate packaging files for when scaffolding (`vivado`, `quartus`); empty generates HDL + testbench only |
| `ipcraft.generate.hdlLanguage` | `vhdl` | RTL language for generated source files (`vhdl` or `systemverilog`) |
| `ipcraft.generate.includeTestbench` | `true` | Generate a testbench (`tb/` folder) when scaffolding a project |
| `ipcraft.generate.scaffoldPack` | _(empty)_ | Scaffold Pack used for RTL/testbench generation (built-in: `builtin-minimal`, `builtin-ipcraft`) |
| `ipcraft.testbench.framework` | `cocotb` | Testbench framework used by *Generate CocoTB Testbench* (`cocotb` or `vunit`) |
| `ipcraft.testbench.engine` | `ghdl` | Simulation engine used by the generated testbench (`ghdl`, `icarus`, `verilator`, `questa`) |
| `ipcraft.vivado.runner` | `local` | `local` uses a native Vivado install; `docker` runs every Vivado command in a container |
| `ipcraft.vivado.installDir` | _(empty)_ | Vivado installation directory (used when `runner` is `local`); IPCraft locates the executable automatically. Leave empty to use `vivado` from PATH |
| `ipcraft.vivado.dockerImage` | _(empty)_ | Docker image used to run Vivado (used when `runner` is `docker`) |
| `ipcraft.vivado.defaultPart` | `xc7z020clg484-1` | Fallback FPGA part when no board has been picked yet |
| `ipcraft.vivado.pinnedPart` | _(empty)_ | Skip the board picker and always use this Vivado part |
| `ipcraft.customBoards.vivado` | `[]` | Custom Vivado boards shown at the top of the board picker |
| `ipcraft.quartus.runner` | `local` | `local` uses a native Quartus install; `docker` runs every Quartus command in a container |
| `ipcraft.quartus.installDir` | _(empty)_ | Top-level Quartus install directory (used when `runner` is `local`); IPCraft locates `quartus_sh`, `quartus`, and `qsys-edit` automatically |
| `ipcraft.quartus.dockerImage` | _(empty)_ | Docker image used to run Quartus (used when `runner` is `docker`) |
| `ipcraft.quartus.defaultDevice` | `5CSEBA6U23I7` | Fallback device when no board has been picked yet |
| `ipcraft.quartus.pinnedDevice` | _(empty)_ | Skip the board picker and always use this Quartus device |
| `ipcraft.customBoards.quartus` | `[]` | Custom Quartus boards shown at the top of the board picker |
| `ipcraft.build.jobs` | `4` | Parallel jobs for Vivado `launch_runs` and Quartus compilation |
| `ipcraft.import.vendor` | `user` | Vendor name stamped on IP cores imported from VHDL/`_hw.tcl`/`component.xml`; auto-detected from git `user.email` when left as `user` |
| `ipcraft.import.library` | `ip` | Default library name for VHDL imports |
| `ipcraft.import.version` | `1.0.0` | Default version string for VHDL imports |
| `ipcraft.busLibraryPaths` | `[]` | Extra directories to search recursively for custom bus definition YAML files |
| `ipcraft.ipRepositoryPaths` | `[]` | Extra directories to scan for IP cores |
| `ipcraft.scaffoldPackPaths` | `[]` | Extra directories to scan recursively for custom Scaffold Packs |
| `ipcraft.toolbar.targets` | `["vivado", "quartus"]` | Which vendor toolchain sections appear in the IP Core editor toolbar |
| `ipcraft.gui.display` / `ipcraft.gui.xauthority` | _(empty)_ | `DISPLAY` / `XAUTHORITY` overrides for launching GUI tools (Vivado, Quartus, Platform Designer) over Remote SSH / X11 forwarding |

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

`ipcraft-spec` (bus definitions and JSON schemas) is a git submodule — clone with `--recurse-submodules`, or run `git submodule update --init --recursive` after a plain clone.

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host.

```bash
npm run watch        # watch mode
npm run test:unit    # unit tests
npm run lint         # ESLint (zero warnings)
npm run type-check   # TypeScript check
```

See [Development Setup](docs/getting-started/development.md) for the full contributor workflow.

---

## License

[MIT](LICENSE)
