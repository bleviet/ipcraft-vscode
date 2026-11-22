# Episode 9: Build with Quartus

This is the project at the start of the episode. See the [checkpoint overview](../README.md) for how to use it.

## What is here

Checkpoint 08, plus the DE10-Nano top level in `altera/hdl/`, the Quartus project scripts and Makefile in `altera/quartus/`, and the Nios V software in `software/`.

## First step

Run **IPCraft: Scaffold Project (RTL + EDA packaging + Testbench)** with VHDL and keep the core, then build with `make` in `altera/quartus/`. The Makefile runs the local Quartus Prime 24.x or newer when `quartus_sh` is on the `PATH`, and Docker (`ipcraft-examples/quartus:25.1`, which you build or tag yourself) otherwise. `make software` builds the Nios V firmware and needs the Nios V RISC-V GNU toolchain (`riscv32-unknown-elf-gcc`) on the `PATH`. `make program-sof download-elf` then runs it on the board (without the Ashling RiscFree tools, add `DOWNLOAD_FLAGS="-o -g"` so `niosv-download` uses OpenOCD) and `make terminal` shows its JTAG UART output; when Quartus runs in WSL2 with the USB-Blaster shared through usbipd-win, add `USBIPD_BUSID=<id>` (from `usbipd.exe list`; it is specific to your machine).
