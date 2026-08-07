# IPCraft examples

IP designs and system-verification examples built with IPCraft, kept in this
repository so they double as regression fixtures and as source material for
tutorials. The board-oriented examples include hardware-validation evidence;
the Vivado system-verification example is simulation-only.

## Directory structure

Board-oriented peripheral examples follow this shape:

```
examples/<name>/
  <name>.ip.yml, <name>.mm.yml   IPCraft spec (memory-mapped IP + register map)
  rtl/                            IPCraft-generated HDL (vendor-neutral)
  tb/                             cocotb testbench (vendor-neutral)
  docs/                           registers doc, hardware validation results
  software/
    app/                          portable application/test logic
    platform/<cpu>/                per-CPU HAL + build glue (e.g. nios2/)
  altera/                          all Quartus/Platform Designer tooling
    <name>_hw.tcl, .sdc, ...       IPCraft-generated Quartus integration
    qsys/ or platforms/<cpu>/qsys/ Platform Designer system script(s)
    quartus/ or platforms/<cpu>/quartus/ board project + Makefile
    hdl/                           board top-level wrapper (e.g. DE10-Nano)
    debug/                         System Console / debug host scripts
  xilinx/                          Vivado project and verification tooling
```

**Why `rtl/`, `tb/`, and `software/app/` sit outside `altera/`:** they don't
depend on Quartus/Platform Designer at all. `rtl/` and `tb/` are plain
VHDL/SystemVerilog and a cocotb testbench that any simulator can run;
`software/app/` is C written only against a small HAL (see below) that any
CPU platform can implement. Only `altera/` (and, later, a `xilinx/` sibling)
holds vendor-specific project files, board wrappers, and debug tooling.
This is deliberate: Vivado/Xilinx integration isn't built yet, and this
layout means adding it later is "add a `xilinx/` folder," not "restructure
every example."

**Why `software/` splits into `app/` + `platform/<cpu>/`:** the actual test
or demo logic (what registers to poke, in what order, what to expect) is
CPU-agnostic -- it's expressed once against a tiny HAL
(`platform_reg_read`/`platform_reg_write`/...) declared in a header in
`app/`. Each CPU platform (for example, `platform/nios2/` and `platform/niosv/`) implements that HAL and nothing else. Porting an example to a new CPU
(an Arm Cortex-A/M target, RISC-V, etc.) means adding a new
`platform/<cpu>/` directory, not rewriting the test sequence. See
`regmap_conformance_avmm/software/app/conformance_checks.h` for the pattern.

## Shared resources

`examples/common/` holds board/tooling helpers shared across examples:

- `common/ip/power_on_reset/power_on_reset_generator.vhd` -- the
  power-on-reset generator every `altera/hdl/de10_nano_top.vhd` instantiates.
- `common/docker/uname_shim.sh` -- makes `nios2-download`/`nios2-terminal`
  behave correctly when run inside Docker on a WSL2 host.

## Examples

| Directory                   | Bus       | What it proves                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `led_avmm/`                 | Avalon-MM | A minimal real peripheral (LED PIO + heartbeat status) end-to-end: IPCraft spec -> generated RTL -> Platform Designer system -> Nios II firmware -> real DE10-Nano hardware. The original reference example this repo's hardware bring-up process was developed against.                                                                                 |
| `regmap_conformance_avmm/`  | Avalon-MM | Every register/field access type IPCraft generates (all 7 access types, change-of-state, register arrays, byte strobes, mixed registers, enumerated/non-zero-reset fields, and heartbeat/watchdog status), driven by one manifest-derived scenario suite in cocotb and through JTAG-to-Avalon on a DE10-Nano. See `docs/hardware_validation_results.md`. |
| `regmap_conformance_axil/`  | AXI4-Lite | The same register map, conformance sequence, and manifest-driven scenario suite as `regmap_conformance_avmm/`, proving the AXI4-Lite bus wrapper instead -- including the SLVERR response path Avalon-MM has no equivalent for. Driven by a JTAG-to-Avalon-MM master with Platform Designer's automatic Avalon<->AXI4 bridging, no HPS/Nios II required. |
| `system_verification_axil/` | AXI4-Lite | A recreatable mixed-language Vivado block design with a tracked IPCraft system-verification scaffold. It runs deterministic register checks through the design's external AXI4-Lite port and interconnect in XSim.                                                                                                                                       |

Each example's `docs/hardware_validation_results.md` (where present) has the
full test results and any generator quirks or bugs found along the way.

The simulation-only `system_verification_axil/` example has a smaller layout
described in its own README.

## Building and testing a board-oriented example

Each board-oriented example exposes the same target convention from
`altera/quartus/`, or from an `altera/` dispatcher when multiple processor
generations are supported:

```bash
cd examples/<name>/altera          # or altera/quartus for single-platform examples

make sim              # cocotb pre-hardware gate (no vendor tools needed)
make qsys project compile   # or: make all
make program-sof      # program the connected board via JTAG
make test             # reprogram + run shared manifest scenarios, emit JSON result
```

The hardware result is written to
`altera/platforms/<cpu>/quartus/output_files/hardware-result.json` (or `altera/quartus/output_files/hardware-result.json` for single-platform examples). It records the Git commit,
generator and Quartus versions, bitstream and manifest hashes, board identity,
random seed, and each named check. A missing tool, JTAG master, or board is a
hard failure.

`REPO_ROOT` in each Makefile resolves to `examples/` (not the whole repo),
so Docker only ever mounts this examples tree plus `examples/common/`.

## What's not here yet

- A board-targeted Xilinx/Vivado build of the reusable peripheral examples.
  `system_verification_axil/` is simulation-only and does not generate a
  bitstream.
- An ARM `software/platform/` port.
- Tutorials walking through building one of these from scratch with
  IPCraft -- these examples are the source material for that, not yet
  written up as guides.
