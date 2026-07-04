# Generating a Project

How to scaffold a complete RTL project from an IP Core specification.

## Prerequisites

- An IP Core file (`.ip.yml`) with at least one bus interface that has a `memoryMapRef`
- A corresponding memory map file (`.mm.yml`) with registers defined

## Quick Path: Scaffold Everything at Once

`IPCraft: Scaffold Project` is the all-in-one command. It generates RTL files (VHDL or SystemVerilog), a testbench, and vendor project files in a single step.

1. Open your `.ip.yml` file (visual editor or text editor)
2. Open the Command Palette (`Ctrl+Shift+P`) and run **IPCraft: Scaffold Project**
   - Also available as a button in the editor title bar and via the **IPCraft** top-level menu
3. If the output directory already exists, confirm the overwrite prompt
4. All files are written next to the `.ip.yml` file

Settings that control scaffold output:

| Setting | Default | Effect |
|---------|---------|--------|
| `ipcraft.generate.targets` | `[]` | Which vendor toolchain files to generate (e.g. `["vivado"]`, `["vivado","quartus"]`) |
| `ipcraft.generate.hdlLanguage` | `vhdl` | HDL language: `vhdl` or `systemverilog` |
| `ipcraft.generate.includeTestbench` | `true` | Whether to generate a testbench |
| `ipcraft.vivado.defaultPart` | `xc7z020clg484-1` | FPGA part used for the Vivado project |
| `ipcraft.quartus.defaultDevice` | `5CSEBA6U23I7` | Device used for the Quartus project |

## Generating Individual Pieces

Use the following commands when you need to regenerate a specific part without touching everything else:

| Command | What it generates |
|---------|-------------------|
| `IPCraft: Generate HDL` | RTL files only (package, top, core, bus wrapper, register file) — respects `ipcraft.generate.hdlLanguage` |
| `IPCraft: Generate CocoTB Testbench` | Testbench scaffold in `tb/` — respects `ipcraft.testbench.framework` and `ipcraft.testbench.engine` |
| `IPCraft: Generate Vivado Project` | Vivado `.tcl` project scripts + `.xdc` constraints (prompts for part number) |
| `IPCraft: Generate Quartus Project` | Quartus `.tcl` + `.sdc` (prompts for device) |
| `IPCraft: Generate Altera Platform Designer Component` | `altera/<ip_name>_hw.tcl` |
| `IPCraft: Generate Xilinx Vivado Component` | `xilinx/component.xml` + `xilinx/xgui/*.tcl` |

## Generated Output

The scaffolder produces a structured project next to the `.ip.yml` file. The exact file extensions depend on `ipcraft.generate.hdlLanguage` (`.vhd` for VHDL, `.sv` for SystemVerilog):

```text
<ip_name>/
  rtl/
    <ip_name>_pkg.vhd/.sv     # Package — register constants and types
    <ip_name>.vhd/.sv          # Top entity — instantiates core + bus wrapper
    <ip_name>_core.vhd/.sv     # User logic skeleton (edit this)
    <ip_name>_axil.vhd/.sv     # AXI-Lite bus wrapper  (or _avmm for Avalon-MM)
    <ip_name>_regs.vhd/.sv     # Register file with field decode
  tb/
    mm_loader.py               # Generic .mm.yml reader
    <ip_name>_test.py          # cocotb test skeleton
    conftest.py                # pytest session fixture
    test_<ip_name>_sim.py      # pytest wrapper functions
    Makefile                   # Simulation Makefile
  xilinx/
    component.xml             # Vivado IP-XACT descriptor
    xgui/<ip_name>_v*.tcl    # Vivado XGUI customization
    <ip_name>_project.tcl    # Creates Vivado OOC synthesis project
    <ip_name>_run_ooc.tcl    # Runs OOC synthesis headlessly
    <ip_name>_run_xpr.tcl    # Runs full synthesis + implementation headlessly
    <ip_name>_ooc.xdc        # OOC timing constraints (clocks)
  altera/
    <ip_name>_hw.tcl          # Platform Designer component
    <ip_name>_project.tcl    # Creates Quartus project
    <ip_name>.sdc             # SDC timing constraints
```

## Bus Type Detection

The generator selects the bus wrapper template automatically based on the bus interface type in the spec:

| Bus type in `.ip.yml` | Generated wrapper |
|-----------------------|-------------------|
| `AXI4L`, `axi4lite`, `axi*` | AXI-Lite (`bus_axil.vhdl.j2` or `bus_axil.sv.j2`) |
| `Avalon-MM`, `avmm`, `avalon*` | Avalon-MM (`bus_avmm.vhdl.j2` or `bus_avmm.sv.j2`) |

If no bus interface with a `memoryMapRef` is found, the generator defaults to AXI-Lite.

## After Generation

1. The IP Core's `fileSets` section is automatically updated with the generated file paths
2. Edit `<ip_name>_core.vhd` (or `.sv`) to implement your custom logic
3. Run **IPCraft: Build** to synthesize or implement the design headlessly — see [Building a Project](building-a-project.md)
4. Open `xilinx/<ip_name>_project.tcl` in the Vivado IDE or import `altera/<ip_name>_hw.tcl` into Platform Designer as an alternative

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Empty RTL files | Verify the IP Core has a bus interface with a valid `memoryMapRef` pointing to an existing memory map |
| Missing register file | Ensure the memory map has at least one register |
| Wrong bus type | Check the `type` field of the bus interface in the IP Core spec |
| Vendor files not generated | Check `ipcraft.generate.targets` in Settings, or use the vendor-specific generate commands |
| cocotb testbench fails to compile after adding `fileSets` | Once an IP Core defines *any* `fileSets`, the cocotb Makefile's `VHDL_SOURCES` is derived **only** from the RTL-type files listed there (it does not merge with the auto-derived file list) — see [Memory-Mapped Registers § the generated hardware contract](../tutorials/memory-mapped-registers.md). If you add a `fileSets` entry just to mark one file `managed: false` (e.g. a hand-edited `_core.vhd`), you must list every RTL file (`_pkg.vhd`, `_regs.vhd`, `_core.vhd`, the bus wrapper, and the top entity) in that same file set, not just the protected one. Prefer running generation with `updateYaml: true` (or the **IPCraft: Scaffold Project** command's default behavior) first, which populates a complete `RTL_Sources` file set automatically — then add `managed: false` on top of the generated entries. |
