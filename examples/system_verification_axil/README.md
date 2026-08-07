# Vivado AXI4-Lite system verification

This example demonstrates IPCraft's end-to-end system-verification workflow.
Vivado recreates a mixed-language block design from checked-in Tcl, IPCraft
drives the design's external AXI4-Lite port, and XSim checks the selected VHDL
register block against `control.mm.yml`.

The design contains:

- a 32-bit external AXI4-Lite interface named `S_AXI_TEST`;
- an AXI interconnect with two mapped targets;
- `control_0`, the VHDL register block verified by IPCraft; and
- `neighbour_0`, a SystemVerilog block that remains part of elaboration but is
  not targeted by the generated register vectors.

The selected target is mapped at `0x44A00000`. Its register contract contains
a fixed status value, a read-write control register, and a fixed identity
value. The block is word-aligned and its registers do not overlap.

## Prerequisites

- Vivado 2024.2 with XSim;
- GNU Make; and
- IPCraft running in a trusted VS Code workspace.

The example uses part `xc7z020clg484-1` for project creation only. It does not
run synthesis, create a bitstream, or require a board.

## Recreate and inspect the design

To inspect the block design without running verification:

```bash
mkdir -p /tmp/ipcraft-system-verification-example
cd /tmp/ipcraft-system-verification-example
vivado -mode batch \
  -source /path/to/ipcraft-vscode/examples/system_verification_axil/xilinx/create_system.tcl
```

The script creates a disposable `system_verification_project` directory below
the current working directory. Run it from a scratch directory, not from the
checked-in example.

## Regenerate the verification scaffold

1. Run **IPCraft: Generate System Testbench from Vivado Tcl**.
2. Select `xilinx/create_system.tcl`.
3. Select block design `system`, interface `/S_AXI_TEST`, and instance
   `/control_0`.
4. Select `control.mm.yml` as the register contract.
5. Select clock `/sys_clk` and reset `/sys_rst_n`.
6. Keep the discovered part, use a 10 ns clock period, active-low reset, and
   five reset cycles.
7. Review the staged files and apply them.

The generated files belong in `xilinx/verification/`. Regeneration should be
reviewed like source code because it records the discovered route and embeds
the reviewed configuration and memory-map contents for drift detection.

## Run the example

From the repository root:

```bash
cd examples/system_verification_axil/xilinx/verification
make run VIVADO=/path/to/Vivado/2024.2/bin/vivado
```

When `vivado` is on `PATH`, omit the `VIVADO` assignment. A successful run ends
with:

```text
IPCraft system verification passed
```

To run from VS Code, right-click `system-verification.yml` and select
**IPCraft: Run System Testbench**. Use `make run WAVES=1` to retain an XSim
waveform in the run directory.

Direct Make runs retain output under `xilinx/verification/.run/`. Run
`make clean` to remove that owned directory. IPCraft-launched runs are retained
under the workspace `.ipcraft/system-verification/` directory.

## Expected checks

The generated testbench confirms:

- `STATUS` reads as `0x00000001` after reset;
- `CONTROL` resets to zero and supports full-word and byte-strobe writes; and
- `IDENTITY` reads as `0x49504352`.

The SystemVerilog neighbor proves that unrelated IP remains part of the
recreated mixed-language design without receiving automatic traffic.
