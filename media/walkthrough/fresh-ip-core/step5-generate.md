## Generating your RTL

**Scaffold Project** (`Scaffold Project (RTL + EDA packaging + Testbench)`) is the all-in-one command. It generates:

| Output | What it is |
|--------|------------|
| `<name>.vhd` / `.sv` | Top-level entity/module that instantiates core + bus wrapper |
| `<name>_core.vhd` / `.sv` | User logic skeleton — **this is where your code goes** |
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

The **Scaffold Template** dropdown in the toolbar lets you pick which scaffold pack drives the generation. The default `builtin-ipcraft` pack produces the full layered structure above. Once you are comfortable, you can eject and customise a pack to match your team's conventions.

> **Tip:** Change `ipcraft.generate.hdlLanguage` in settings to switch between VHDL and SystemVerilog output.
