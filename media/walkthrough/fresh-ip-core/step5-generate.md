## Generating your RTL

**Scaffold Project** (`Scaffold Project (RTL + EDA packaging + Testbench)`) is the all-in-one command. Its output depends on the selected scaffold pack, enabled toolbar targets, and testbench/documentation settings.

With the `builtin-ipcraft` pack selected, a memory-mapped slave can generate:

| Output | What it is |
|--------|------------|
| `<name>.vhd` / `.sv` | Top-level entity/module that instantiates core + bus wrapper |
| `<name>_core.vhd` / `.sv` | Generated core logic skeleton; protect it before adding hand-written logic |
| `<name>_pkg.vhd` / `.sv` | Register constants and types package |
| `<name>_axil.vhd` / `<name>_avmm.vhd` (+ `.sv`) | Bus wrapper — AXI-Lite or Avalon-MM, matching the bus type on your register-mapped slave interface |
| `<name>_regs.vhd` / `.sv` | Register decode logic (if you have a register map) |
| `tb/<name>_test.py` | cocotb Python test skeleton |
| `tb/Makefile` | Simulation Makefile for GHDL / Icarus / Verilator |
| `component.xml` | Vivado IP-XACT descriptor (if Vivado is a target) |
| `<name>_hw.tcl` | Platform Designer component (if Quartus is a target) |

### Generate HDL only

If you just want the RTL without vendor packaging or testbench, use **Generate Top-Level HDL** instead.

### Choosing a scaffold pack

The **Scaffold Template** dropdown in the toolbar lets you pick which scaffold pack drives the generation. With no pack selected in `.ip.yml` or settings, the default is `builtin-minimal`, which produces a single empty top-level RTL stub. Select `builtin-ipcraft` for the layered package, core, bus wrapper, and register-file structure shown above.

The `builtin-ipcraft` core file is managed by default and is regenerated on
every scaffold run. Before adding hand-written logic, mark that path
`managed: false` in `.ip.yml` or use a pack whose core rule is
`managed: false`.

> **Tip:** Change `ipcraft.generate.hdlLanguage` in settings to switch between VHDL and SystemVerilog output.
