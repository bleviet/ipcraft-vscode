# IPCraft examples

Full, hardware-validated IP designs built with IPCraft, kept in this repo so
they double as regression fixtures for the generator and as source material
for tutorials.

## Directory structure

Each example follows the same shape:

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
    qsys/                          Platform Designer system script(s)
    quartus/                       board-level Quartus project + Makefile
    hdl/                           board top-level wrapper (e.g. DE10-Nano)
    debug/                         System Console / debug host scripts
  xilinx/                          (future) Vivado tooling, once that
                                   toolchain integration exists
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
`app/`. Each CPU platform (today: `platform/nios2/`, a bare-metal Nios II
port) implements that HAL and nothing else. Porting an example to a new CPU
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

| Directory | Bus | What it proves |
|---|---|---|
| `led_avmm/` | Avalon-MM | A minimal real peripheral (LED PIO + heartbeat status) end-to-end: IPCraft spec -> generated RTL -> Platform Designer system -> Nios II firmware -> real DE10-Nano hardware. The original reference example this repo's hardware bring-up process was developed against. |
| `regmap_conformance_avmm/` | Avalon-MM | Every register/field access type IPCraft generates (all 7 access types, change-of-state, register arrays, byte strobes, mixed registers, enumerated/non-zero-reset fields), self-checked via a software-writable STIMULUS loopback register. See `docs/hardware_validation_results.md`. |
| `regmap_conformance_axil/` | AXI4-Lite | The same register map and conformance sequence as `regmap_conformance_avmm/`, proving the AXI4-Lite bus wrapper instead -- including the SLVERR response path Avalon-MM has no equivalent for. Driven by a JTAG-to-Avalon-MM master with Platform Designer's automatic Avalon<->AXI4 bridging, no HPS/Nios II required. |

Each example's `docs/hardware_validation_results.md` (where present) has the
full test results and any generator quirks or bugs found along the way.

## Building and testing an example

Every example's `altera/quartus/Makefile` follows the same target
convention:

```bash
cd examples/<name>/altera/quartus

make sim              # cocotb pre-hardware gate (no vendor tools needed)
make qsys project compile   # or: make all
make program-sof      # program the connected board via JTAG
make test             # reprogram + run the conformance/debug self-test, aggregate PASS/FAIL
```

`REPO_ROOT` in each Makefile resolves to `examples/` (not the whole repo),
so Docker only ever mounts this examples tree plus `examples/common/`.

## What's not here yet

- A Xilinx/Vivado build of any of these examples (the `altera/`-only
  structure above is designed so this can be added as a `xilinx/` sibling
  without touching `rtl/`, `tb/`, or `software/app/`).
- An ARM (or other non-Nios-II) `software/platform/` port.
- Tutorials walking through building one of these from scratch with
  IPCraft -- these examples are the source material for that, not yet
  written up as guides.
