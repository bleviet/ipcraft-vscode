## Generating your RTL

**Scaffold Full Project** is the all-in-one command. It generates:

| Output | What it is |
|--------|------------|
| `*_top.vhd` / `.sv` | Top-level entity/module that instantiates core + bus wrapper |
| `*_core.vhd` / `.sv` | User logic skeleton — **this is where your code goes** |
| `*_pkg.vhd` | Register constants and types package |
| `*_axil_wrap.vhd` | AXI-Lite bus wrapper (if you have a register map) |
| `*_regfile.vhd` | Register decode logic (if you have a register map) |
| `tb/test_*.py` | cocotb Python test skeleton |
| `tb/Makefile` | Simulation Makefile for GHDL / Icarus / Verilator |
| `component.xml` | Vivado IP-XACT descriptor (if Vivado is a target) |
| `*_hw.tcl` | Platform Designer component (if Quartus is a target) |

### Generate HDL only

If you just want the RTL without vendor packaging or testbench, use **Generate HDL** instead.

### Choosing a scaffold pack

The **Project Scaffold** section in the left navigation lets you pick which scaffold pack drives the generation. The default `builtin-ipcraft` pack produces the full layered structure above. Once you are comfortable, you can eject and customise a pack to match your team's conventions.

> **Tip:** Change `ipcraft.generate.hdlLanguage` in settings to switch between VHDL and SystemVerilog output.
