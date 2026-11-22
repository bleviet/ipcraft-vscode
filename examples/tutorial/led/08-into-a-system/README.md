# Episode 8: Into a system

This is the project at the start of the episode. See the [checkpoint overview](../README.md) for how to use it.

## What is here

The finished spec: the `.mm.yml` now has the `EVENTS` register, and the core has the heartbeat logic. `altera/qsys/` holds the Platform Designer system scripts: a Nios V/m system (`led_avmm_system.tcl`) and the same system with a JTAG-to-Avalon-MM master added (`led_avmm_system_debug.tcl`). `led_ctrl` sits at address `0x00010010` in both. The generated files are not committed.

## First step

Run **IPCraft: Scaffold Project (RTL + EDA packaging + Testbench)** with VHDL and keep the core, then open the generated `altera/led_controller_avmm_hw.tcl` component. To build the system scripts, run `qsys-script --script=led_avmm_system.tcl --search-path=<path to altera>,$` from `altera/qsys/` (needs Quartus Prime 24.x or newer, which includes Nios V; Nios II is not part of Quartus Prime Lite 25.1).
