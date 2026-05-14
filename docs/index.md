# IPCraft for VS Code

Visual editor for FPGA IP Core and Memory Map specifications, built as a VS Code extension.

## What It Does

### Visual Editing
- **IP Core Canvas** — block-diagram editor for IP cores; drag clocks, resets, ports, bus interfaces, and generics from a library palette onto an SVG schematic
- **Canvas Inspector** — click any canvas element to edit its properties inline without leaving the diagram; configure mode, width, memory map reference, and more
- **Memory Map Editor** — tabular editor for address blocks, registers, and bit fields with visual bit-layout view
- **Bit Field Visualizer** — drag to resize fields, Shift+click gaps to create new fields, Ctrl+drag to reorder
- **Custom Interfaces** — define conduit (custom) bus interfaces with user-named signals, stored as reusable `.busdef.yml` files
- **Real-time Validation** — YAML cross-reference checks with a click-to-navigate error list
- **Bi-directional Sync** — visual editor changes are instantly reflected in the YAML source, and vice versa

### VHDL Generation
- **Full Project Scaffold** — one command generates VHDL package, top entity, user-logic skeleton, bus wrapper (AXI-Lite or Avalon-MM), register file, testbench, and vendor project files
- **Vendor Integration** — generates Xilinx/AMD Vivado OOC synthesis project (`.tcl`, `.xdc`, run scripts) and Intel/Altera Quartus project (`.tcl`, `.sdc`), ready to open in the GUI or run headlessly

### Headless Build
- **Batch Compilation** — runs Vivado or Quartus in batch mode from inside VS Code; no GUI required
- **OOC Synthesis** — fast out-of-context synthesis via `vivado -mode batch`
- **Full Implementation** — synthesis + place + route in Vivado project mode
- **Quartus Compile** — full synthesis + fitting + timing via `quartus_sh --flow compile`
- **Build Reports Panel** — Explorer sidebar showing WNS/WHS (Vivado) or Fmax (Quartus), LUT/FF/BRAM/DSP utilization, and CDC violations
- **Status Bar** — live build indicator; collapses to `✓ WNS +1.23ns` or `✓ Fmax 156 MHz` on success

### Import
- **Parse VHDL** — reverse-engineer an existing VHDL entity into an `.ip.yml` spec with automatic clock, reset, and bus-interface detection
- **Parse Platform Designer** — import an Altera `_hw.tcl` component
- **Parse Vivado IP** — import a Xilinx `component.xml` (IP-XACT) descriptor
- **Bus Library Viewer** — browse the built-in library of bus interface definitions

## File Types

| Extension | Editor | Purpose |
|-----------|--------|---------|
| `*.mm.yml` | Memory Map Visual Editor | Address blocks, registers, and bit fields |
| `*.ip.yml` | IP Core Visual Editor | IP core metadata, ports, bus interfaces, clocks, resets, and file sets |

## Where to Start

| Goal | Go to |
|------|-------|
| New to IPCraft? | [Quick Start](getting-started/quickstart.md) |
| Setting up a dev environment | [Development Setup](getting-started/development.md) |
| Import an existing VHDL file | [Importing from VHDL](how-to/vhdl-import.md) |
| Generate a full RTL project | [Generating a Project](how-to/generating-a-project.md) |
| Compile without opening the GUI | [Building a Project](how-to/building-a-project.md) |
| Use AI tools with IPCraft | [AI Design Guide](how-to/ai-design-guide.md) |
| Run EDA integration tests | [Run EDA Integration Tests](how-to/run-eda-integration-tests.md) |
| Understand the extension design | [Concepts](concepts/extension-model.md) and [Architecture](architecture/overview.md) |
| Look up all commands and settings | [Commands & Settings](reference/commands.md) |
| Look up keyboard shortcuts | [Keyboard Shortcuts](reference/keyboard-shortcuts.md) |
| Contribute | [Contributing Guidelines](contributing/guidelines.md) |
