# Run System Verification

System verification recreates a checked-in Vivado block design and tests one
IPCraft register map through the design's real external AXI4-Lite path. The
generated VHDL testbench and AXI4-Lite bus functional model (BFM) run in XSim
against the assembled design, including its interconnect and other IP.

## Prerequisites

You need:

- a trusted VS Code workspace;
- GNU Make;
- Vivado with XSim, configured as a local or Docker toolchain in IPCraft;
- a checked-in Tcl script that recreates the Vivado project and block design;
- a VHDL-target Vivado project with a 32-bit-address, 32-bit-data AXI4-Lite
  slave interface already exposed at the block-design boundary;
- one target instance and its IPCraft `.mm.yml` register map; and
- explicit top-level clock and reset ports.

Vivado must be able to run the recreation Tcl without GUI state or an existing
project directory. The selected clock and reset must be boundary ports; IPCraft
does not infer timing, polarity, or reset duration from connectivity.

## Generate the tracked runner

1. Run **IPCraft: Generate System Testbench from Vivado Tcl** from the Command
   Palette.
2. Select the checked-in recreation Tcl script.
3. Select the discovered block design, external AXI4-Lite interface, target
   instance, and `.mm.yml` register map.
4. Select or enter the absolute Vivado clock and reset port paths.
5. Enter the exact Vivado part, clock period, reset polarity, and reset duration.
6. Review the generated files and select **Confirm & Apply**.

Generation first runs discovery in an isolated temporary directory. The tracked
files are rendered in memory and shown in IPCraft's existing staging review.
See [Review and accept the staged output](create-your-first-ip-core.md#review-and-accept-the-staged-output)
for the review controls. Cancelling at any prompt or in the staging review
writes no tracked project files, and IPCraft removes the temporary discovery
directory.

If the recreation script is `hardware/system/create_system.tcl`, IPCraft stages
this layout beside it:

```text
hardware/system/
├── create_system.tcl
└── verification/
    ├── system-verification.yml
    ├── Makefile
    ├── scripts/
    │   └── run_xsim.tcl
    └── tb/
        ├── axi4lite_master_bfm.vhd
        └── system_verification_tb.vhd
```

Keep this complete scaffold in version control. The `Makefile` is mandatory and
is the supported entry point for local runs, CI, and the VS Code command.

## Configuration reference

The generated `system-verification.yml` records the exact discovered binding:

```yaml
recreateScript: hardware/system/create_system.tcl
part: xc7z020clg484-1
designName: system
clockPath: /sys_clk
clockPeriodNs: 10
resetPath: /sys_rst_n
resetActiveLow: true
resetCycles: 5
target:
  driveInterfacePath: /S_AXI_TEST
  instancePath: /control_0
  memoryMap: ../ip/control.mm.yml
```

The paths are case-sensitive Vivado object paths. `recreateScript` is relative
to the workspace root. `target.memoryMap` is relative to the generated
`system-verification.yml` file.

All five clock/reset fields are required and explicit:

| Field            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `clockPath`      | Absolute boundary clock-port path                              |
| `clockPeriodNs`  | Positive clock period in nanoseconds                           |
| `resetPath`      | Absolute boundary reset-port path                              |
| `resetActiveLow` | `true` for active-low reset, `false` for active-high           |
| `resetCycles`    | Positive integer number of clock cycles to hold reset asserted |

The other fields identify the recreation script, exact part and design, the
external interface driven by the BFM, the target instance, and the register-map
oracle. IPCraft resolves the target's system base address during discovery, so
the testbench uses `base address + register offset`.

## Run the verification

To run from VS Code, right-click the tracked `system-verification.yml` in the
Explorer and select **IPCraft: Run System Testbench**. The System Simulation
view reports the typed lifecycle stages from preflight through completion. Raw
tool output is also written to the **IPCraft System Verification** Output
channel. The resolved route and base address appear only after the generated
runner returns them in its structured result. Version 1 does not publish live
per-scenario metadata, so the view does not show a placeholder scenario.

To use the tracked runner directly:

```bash
cd hardware/system/verification
make run
make run WAVES=1
```

`make run` first confirms that the tracked configuration and memory-map bytes
still match the reviewed scaffold. It then recreates the design and validates
the configured part, active block design, VHDL wrapper language, clock and
reset ports, boundary-interface protocol and physical signals, target address
segment, and base/range. Only after that binding succeeds does it export the
mixed-language simulation, compile and elaborate it with XSim, and run the
self-checking VHDL testbench. `make run WAVES=1` also enables waveform capture.

If the recreation Tcl, configuration, memory map, interface shape, or address
assignment changes, regenerate the system testbench and review the new
scaffold. The runner fails with a drift diagnostic instead of silently using
stale generated vectors or a stale route.

The generated Makefile supports exactly these targets:

| Target       | Effect                               |
| ------------ | ------------------------------------ |
| `make run`   | Run recreation and XSim verification |
| `make clean` | Remove a marked, owned `RUN_DIR`     |
| `make help`  | List the supported targets           |

`VIVADO` defaults to `vivado`. Set it when the executable is not on `PATH`:

```bash
make run VIVADO=/opt/Xilinx/Vivado/2024.2/bin/vivado
```

## Results and retained files

The VS Code command allocates a unique run directory and retains it after a
pass, failure, or cancellation:

```text
.ipcraft/system-verification/<run-id>/
├── system-verification.log
├── result.json
├── vivado/
└── exported-simulation/
```

`result.json` records `passed`, `failed`, or `cancelled`. The resolved target
route and base address appear only after runtime binding validation succeeds;
the first failure is included when the Make/Vivado runner provides one. IPCraft
writes a cancellation result atomically even when cancellation happens before
the external process starts.
`system-verification.log` contains the extension and raw Make/Vivado output.
Vivado/XSim logs and any `.wdb`, `.vcd`, or `.fst` waveform are below the same
run directory. These files are transient run output, not tracked source.

A direct `make run` uses `verification/.run/` by default because no extension
run ID is allocated. Override `RUN_DIR` to retain it under the workspace
`.ipcraft/system-verification/` run root. Each run receives an ownership marker.
`make clean` refuses unmarked paths and paths outside those two owned roots; it
never deletes the tracked configuration, Tcl, Makefile, or VHDL sources.

Cancelling an active VS Code run terminates only the process tree IPCraft
started. It reports a cancelled outcome and keeps the run directory and log for
diagnosis; it does not remove or modify the tracked scaffold.

## Version 1 limits

Version 1 is intentionally narrow:

- Vivado/XSim is the only system runner. The generated testbench is VHDL;
  XSim may elaborate VHDL, Verilog, and SystemVerilog sources in the DUT.
- The Vivado project must generate a VHDL block-design wrapper. The selected
  external AXI4-Lite interface must have 32-bit address and data widths and the
  supported single-beat AXI4-Lite physical signal shape. Clock and reset must
  be scalar input boundary ports with Vivado `clk` and `rst` types.
- One explicitly selected target is verified through one existing external
  AXI4-Lite interface.
- The BFM issues deterministic, ordered, single-word transactions only. It
  does not issue bursts or multiple outstanding transactions.
- IPCraft does not parse or modify `.bd` files, expose internal interfaces, or
  inject AXI VIP.
- AXI VIP, Cocotb, Questa, randomized traffic, and stress testing are not used
  by this workflow.

Other IP remains part of the simulated design but receives no automatic
traffic or assertions.

## Diagnose the first failure

Start with the first failure shown in the System Simulation view or, when
present, `result.json`. Then open `system-verification.log` and the linked tool
output. Check the earliest failing layer:

1. **Preflight:** confirm GNU Make is installed and IPCraft can launch the
   configured Vivado/XSim toolchain and license environment.
2. **Recreation:** run the recreation Tcl in a clean directory and confirm its
   project part matches `part`.
3. **Discovery:** compare `designName`, `clockPath`, `resetPath`,
   `target.driveInterfacePath`, and `target.instancePath` with the exact Vivado
   object paths created by the Tcl script.
4. **Planning:** confirm there is one unambiguous AXI4-Lite route and that its
   address range contains the linked memory map.
5. **Compile or run:** inspect the retained XSim logs. BFM diagnostics name the
   failed read or write phase, absolute address, data, AXI response, or timeout.
   Register assertions also name the register and expected and observed values.

Fix the first invalid layer before interpreting later tool messages. A failed
or cancelled run remains under `.ipcraft/system-verification/<run-id>/`, so its
log and any result or waveform already produced are available after the process
stops.
