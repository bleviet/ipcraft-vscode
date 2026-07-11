# Hardware Register-Conformance Test Plan

A plan for verifying, on real FPGA hardware, that **every** register and
bit-field access type IPCraft generates behaves correctly — i.e. that the code
generation is provably correct end-to-end, not just in simulation.

> **Altera/Avalon-MM (Variant A) implementation status: done, validated on
> DE10-Nano hardware.** Lives at `cvsoc/17_ipcraft_regmap_conformance/`
> (sibling repo, not in this tree). All 23 conformance checks pass via the
> System Console host on real silicon (`make test` in that project's
> `quartus/` dir); the cocotb pre-hardware gate is green (14/14). Found two
> real generator bugs along the way (not yet fixed here): (1)
> `package.vhdl.j2`'s `to_unsigned(<value>, 32)` for a 32-bit `resetValue`
> overflows VHDL's signed `integer` type once bit 31 is set, breaking GHDL
> elaboration; (2) `bus_avmm.vhdl.j2` always slices `avs_address` as a byte
> address, which goes out-of-range whenever `portWidthOverrides.address`
> narrows the port for WORDS addressing (the same class of bug
> `16_ipcraft_led_avmm`'s bring-up hand-patched but never upstreamed — any
> new Avalon-MM IP needing a Nios II-compatible WORDS slave hits it fresh).
> See `cvsoc/17_ipcraft_regmap_conformance/docs/hardware_validation_results.md`
> for full results, including a known JTAG-UART-capture tooling limitation
> on the Nios II host (execution is confirmed via register readback instead).
> AXI4-Lite (Variant B) and the Xilinx/xsdb path remain as designed, not yet
> built.

## Why this plan exists

Today the generator's correctness is verified in **simulation only**:

- `npm run test:integration:hdl` proves the generated HDL *compiles/elaborates*
  (GHDL `-a`/`-e`/`--synth`, `iverilog -g2012`, `verilator --lint-only`) — it
  never simulates behavior.
- `src/test/integration/register-semantics.test.ts` drives the standalone
  `daq_controller_regs` module with a hand-written behavioral testbench
  (`src/test/fixtures/register-semantics/tb_daq_regs.vhd`) that self-checks
  every access-type idiom with `PASS <name>` / `FAIL <name>` report lines. This
  is the strongest existing asset — but it drives the **raw register interface**
  in a simulator, not a real bus on real silicon.

The `cvsoc/16_ipcraft_led_avmm` phase proved the full
`.ip.yml`/`.mm.yml` -> generated RTL -> Quartus -> DE10-Nano board loop works,
and in doing so surfaced **eight real generator bugs** that every synthetic CI
fixture had missed (byte-vs-word address decode, a one-cycle read-latency
sampling error, empty-array-truthy invalid VHDL, an SDC constraint swallowed by
`trimBlocks`, and more). The lesson is blunt:

> A synthetic fixture never has to actually work. A real target does.

But `16_ipcraft_led_avmm` exercises only three access types (read-only,
read-write, write-1-to-clear + change-of-state) on one bus (Avalon-MM). The
generator supports **seven** field access types plus change-of-state, register
arrays, byte strobes, mixed registers, and **two** bus wrappers (AXI4-Lite and
Avalon-MM) — none of which is systematically proven on hardware.

**This plan defines a standard, reusable, automatically-runnable FPGA test
design that closes that gap**, and is deliberately structured as preparation for
[issue #36](https://github.com/bleviet/ipcraft-vscode/issues/36) (register
access by name over a JTAG transport: **System Console** for Altera, **xsdb**
for Xilinx).

## Scope: the full access-type surface to prove

The schema (`ipcraft-spec/schemas/memory_map.schema.json`, `$defs.AccessType`)
defines exactly seven field/register access types, plus change-of-state as a
distinct hardware behavior. The exact generated semantics (ground truth:
`src/generator/templates/register_file.vhdl.j2`; the SystemVerilog template
`register_file.sv.j2` is behaviorally identical):

| Access type | Generated hardware behavior | Ground-truth lines |
|---|---|---|
| `read-write` | Byte-strobe merge into storage; read returns stored value | `register_file.vhdl.j2:232-297` |
| `write-only` | Same write storage (reaches core via `regs_out`); **read returns 0** | `:235-252` (write), not in read mux |
| `read-only` | No storage; read sourced live from hardware (`regs_in`); writes ignored | `:284-290` |
| `write-1-to-clear` | HW pulse sets sticky bit; CPU write-1 clears; **HW-set beats CPU-clear**; clear needs data bit=1 AND its byte strobe; write-only variant reads 0 | `:153-179` |
| `read-write-1-to-clear` | As W1C but readable (read returns stored sticky value) | `:153-179`, read `:291-297` |
| `write-self-clearing` | CPU write-1 sets; HW `_clear` pulse auto-clears; **HW-clear beats CPU-set**; **reads 0** | `:180-206` |
| `read-write-self-clearing` | As SC but **readable while set** | `:180-206`, read `:291-297` |
| change-of-state (`monitorChangeOf`) | Shadow register + comparator auto-sets a W1C flag when the monitored field changes; shadow resets to the monitored field's reset value (no spurious event at reset) | `:61-110, 207-231` |

Plus the cross-cutting cases every real bus must honor:

- **Byte strobes / partial writes** — `apply_wstrb` merges per byte lane
  (`:77-92`); a sub-word write must only alter strobed lanes.
- **Register arrays** — `count`/`stride` expand to independent physical
  registers; elements must not alias, and an untouched element keeps its reset.
- **Mixed registers** — a SW-writable register that also carries RO fields reads
  bit-by-bit from the correct source (`:301-326`).
- **Reset values** — synchronous, active-high internal `rst`
  (`package.vhdl.j2:48-56`); non-zero resets (e.g. an enumerated field) must read
  back correctly.
- **Addressing** — byte-offset exact match; undecoded addresses read 0, and AXI
  additionally returns **`SLVERR`** for addresses beyond the map
  (`bus_axil.vhdl.j2`) — a negative test.
- **Reads are 1-cycle registered** with a `rd_valid`/`readdatavalid` strobe.

Bus coverage is **AXI4-Lite and Avalon-MM only** — these are the only two bus
wrappers the generator emits (`bus_axil.*.j2`, `bus_avmm.*.j2`; no APB, no
AXI4-full wrapper).

## The core idea: one loopback IP, one register model, three test hosts

A CPU or JTAG master can only issue bus reads and writes. But read-only status,
W1C hardware-set, self-clearing hardware-clear, and change-of-state all depend on
**hardware-side stimulus** a bus master cannot drive directly. The
purpose-built conformance IP solves this with a **software-writable `STIMULUS`
register whose bits the hand-written core wires back into the register file's
hardware-side inputs (`regs_in`)**. Every access type's hardware-dependent
behavior thereby becomes **triggerable and observable from the bus alone** — no
external stimulus, no logic analyzer. A single bus master (Nios II C, ARM, or a
JTAG-to-bus master) can self-check the entire matrix.

The **same `.mm.yml`** is then consumed by three independent test hosts — the
"split by consumer, single register model" principle of issue #36:

| Host | Transport | Role | Needs a board? |
|---|---|---|---|
| cocotb (Python) | signal toggling / `cocotbext.axi` | Pre-hardware sim gate | No (CI) |
| Nios II bare-metal C | `IOWR/IORD_32DIRECT` over Avalon-MM | **Primary on-board self-test** (PASS/FAIL over JTAG UART) | Yes |
| System Console Tcl (Altera) / xsdb (Xilinx) | JTAG-to-Avalon / JTAG-to-AXI master | CPU-less host-driven self-test = **issue #36 preparation** | Yes |

All three run the **identical conformance sequence**, mirroring the assertion
list already proven in `tb_daq_regs.vhd`.

## Component 1 — the conformance register map

`regmap_conformance.mm.yml` / `regmap_conformance.ip.yml`, modeled on the
CI-verified `ipcraft-spec/examples/daq_controller/`, but made **self-contained**
(loopback stimulus) and **contiguous from base 0**. (Issue #36 records that
sparse `baseAddress`/`offset` maps can diverge sim-vs-hardware; a dense map keeps
simulation and silicon in agreement.)

| Offset | Register | Access | Verifies |
|---|---|---|---|
| `0x00` | `ID` | read-only | RO constant readback (magic/version self-test) |
| `0x04` | `SCRATCH` | read-write | RW round-trip + partial byte-strobe write |
| `0x08` | `STIMULUS` | read-write | Loopback control (core wires its bits into `regs_in`) |
| `0x0C` | `STATUS` | read-only (multi-field) | RO fields sourced live from `STIMULUS` |
| `0x10` | `INT_STATUS` | read-write-1-to-clear (multi-bit) | W1C hw-set, sw-clear, hw-set-beats-sw-clear, per-bit clear |
| `0x14` | `IRQ_LEGACY` | write-1-to-clear (not readable) | Plain W1C reads back 0 |
| `0x18` | `COMMAND` | write-self-clearing | SC sw-set, hw-clear, reads 0, hw-clear-beats-sw-set |
| `0x1C` | `BUSY` | read-write-self-clearing | RWSC sw-set readable while set, hw-clear |
| `0x20` | `DIAG` | write-only | WO reads 0 but reaches hardware |
| `0x24` | `WO_MIRROR` | read-only | Readable echo of `DIAG` — confirms the WO value landed |
| `0x28` | `LINK` | mixed: RO `SPEED` + RW1C `SPEED_CHANGED` (`monitorChangeOf: SPEED`) | Change-of-state set/clear, no reset event, mixed read composition |
| `0x2C` | `CONTROL` | read-write with `enumeratedValues` | Enum field + non-zero reset |
| `0x30`.. | `CHANNEL` array `count:4 stride:16` (RW `CONFIG`, RO `COUNT`, RW1C `FLAGS`) | Register-array addressing; no aliasing; untouched element keeps reset |

This exercises all 7 access types + change-of-state + register array + byte
strobe + mixed register + wide/enum fields + non-zero reset values — the complete
generator surface.

## Component 2 — the loopback core (hand-written, `managed: false`)

The only hand-written file, protected via `fileSets` `managed: false` (like
`16_ipcraft_led_avmm`'s `_core.vhd`, so it survives re-scaffold). It wires
`STIMULUS` into the register file's hardware inputs:

| `regs_in` target (hardware input) | Driven by core from | Bus master observes |
|---|---|---|
| `status.*` (RO field values) | `regs_out.stimulus` bits | Write `STIMULUS`, read `STATUS` -> value tracks |
| `int_status_pulse.*_pulse` (W1C set) | rising-edge on `STIMULUS` trigger bits | Pulse `STIMULUS` -> `INT_STATUS` sticky sets |
| `command_clear.*_clear` (SC clear) | rising-edge on `STIMULUS` clear bits | Pulse `STIMULUS` -> `COMMAND`/`BUSY` auto-clears |
| `link_val.speed` (CoS monitored) | `regs_out.stimulus` speed bits | Change `STIMULUS` speed -> `SPEED_CHANGED` sets |
| `wo_mirror_val` (RO echo) | `regs_out.diag.scratch` | Read `WO_MIRROR` -> confirms WO write reached hw |
| `channel_N_count.samples` (RO array) | derived counter / `STIMULUS` | Per-element RO readback |

Edge detection uses a registered previous value of `STIMULUS`, so a held bit
yields exactly one pulse — deterministic, and true to how a real peripheral
raises an event. The exact `regs_in`/`regs_out` record field names come from the
generated `regmap_conformance_pkg.vhd` (see `package.vhdl.j2`); the wiring mirrors
how `tb_daq_regs.vhd` drives `regs_in.*` directly in simulation.

## Component 3 — the three test hosts (one sequence, `.mm.yml`-driven)

Define the conformance sequence **once** as an ordered check list (name,
address/field, stimulus, expected value) mirroring `tb_daq_regs.vhd`'s `chk(...)`
calls. Each host implements it:

1. **cocotb sim gate (pre-hardware, CI).** Extend the generated
   `tb/regmap_conformance_test.py` into a self-checking **scoreboard** — the
   generated `cocotb_test.py.j2` only *logs* read-backs, so it must be turned
   into `assert`s. Reuse `mm_loader.py` (parses `.mm.yml`) and the existing bus
   drivers (AXI via `cocotbext.axi`, hand-rolled Avalon). Run on GHDL:
   `make -C tb SIM=ghdl`. **This gate must be green before any board step.**

2. **Nios II bare-metal C self-test (primary on-board).** Clone
   `16_ipcraft_led_avmm/software/app/main.c`. Use `alt_printf` (not `printf` —
   newlib overflows the 32 KB on-chip RAM; this was bug #8 of the LED series).
   Walk the sequence with `IOWR/IORD_32DIRECT` by byte offset, print
   `PASS <name>` / `FAIL <name>` and a final sentinel
   `==== CONFORMANCE: ALL PASS ====` (or `N FAIL`) over the JTAG UART.

3. **System Console Tcl host self-test (Altera, issue #36 preparation).** A
   `conformance_sysconsole.tcl` doing `get_service_paths master` ->
   `claim_service master` -> `master_read_32` / `master_write_32` against the
   conformance IP over a **JTAG-to-Avalon-MM Master** in the fabric. Same
   sequence, prints PASS/FAIL, exits nonzero on failure. It needs **no firmware
   or BSP** — just program the `.sof` and run
   `system-console --script=conformance_sysconsole.tcl`. (The xsdb equivalent for
   the Xilinx path is below.)

## Component 4 — the standard test FPGA design (DE10-Nano), two bus variants

A new `cvsoc` phase (e.g. `17_ipcraft_regmap_conformance/`) that clones
`16_ipcraft_led_avmm`'s layout (`rtl/ tb/ altera/ qsys/ hdl/ quartus/
software/`), with **real pin assignments** and a `.sof` (the generated `altera/`
project is `VIRTUAL_PIN ON`, for timing/utilization only).

- **Variant A — Avalon-MM (primary).** A Platform Designer system with **Nios
  II/e + on-chip RAM + JTAG UART + the conformance IP (Avalon slave) + a
  JTAG-to-Avalon-MM Master**. Nios II drives host 2; the JTAG master drives host
  3 (System Console). Both masters coexist on the interconnect.
- **Variant B — AXI4-Lite (second phase).** Regenerate the conformance IP with
  the AXI wrapper (`bus_axil`), hang it off the **HPS lightweight HPS-to-FPGA
  bridge at `0xFF200000`**, and drive it from the ARM — bare-metal (reuse
  `cvsoc/05_hps_led`'s bridge-enable + `volatile uint32_t *`) or Linux
  `/dev/mem` mmap (reuse `cvsoc/10_linux_led/software/fpga_led.py`). This proves
  the AXI wrapper and the CPU-to-FPGA AXI path, including the **`SLVERR`
  out-of-range** negative test.
- **Xilinx / xsdb (designed now, validated on a Zynq board later).** `xsdb` is
  the **Xilinx** System Debugger and targets AMD/Xilinx parts, not the Altera
  DE10-Nano. Design the xsdb harness (`conformance_xsdb.tcl` using
  `create_hw_axi_txn`/`run_hw_axi` or `mrd`/`mwr`) and the **JTAG-to-AXI Master**
  block-design snippet so it is ready for issue #36, and document that it runs
  against a Xilinx target when hardware is available. The DE10-Nano work
  validates the Altera System Console path concretely today.

## Component 5 — board-in-the-loop automation (full loop)

A top-level `Makefile` in the new phase orchestrates one command, runnable
locally and on a **self-hosted CI runner with a DE10-Nano + USB-Blaster
attached**:

| Target | Tool | Action |
|---|---|---|
| `generate` | `IpCoreScaffolder.generateAll` via a Node script that mocks `vscode` (as `scripts/validate-examples-qsys.js` does) | Regenerate `rtl/` + `tb/` from the two YAMLs (there is no standalone CLI binary) |
| `sim` | GHDL + cocotb | Run the self-checking scoreboard; **abort on any FAIL** |
| `qsys` + `compile` | `qsys-script`/`qsys-generate`, `quartus_sh --flow compile` | Build the `.sof` (inside `cvsoc/quartus:23.1`; Nios II Gen2 needs the 23.1 image) |
| `program` | `quartus_pgm` | JTAG-program the `.sof` (SRAM config) |
| `run` | `nios2-download` + `nios2-terminal`, and/or `system-console --script=...` | Run the self-test(s), capture output, grep for `ALL PASS` -> exit code |
| `test` | — | Aggregate exit code (nonzero if any host reports a FAIL) |

The firmware/host PASS is the single source of truth; the runner just greps the
sentinel. This is the "test the IP core automatically" deliverable.

`_core.vhd` and the cocotb test are `managed: false`, so `generate` never
overwrites the hand-written loopback logic or the scoreboard assertions.

## Coverage matrix and issue #36 alignment

The **coverage matrix** (the "Scope" table above, expanded during
implementation) maps each access type + special case -> the exact generated HDL
behavior (with `register_file.vhdl.j2` line ranges) -> the specific conformance
check(s). Because both language templates are behaviorally identical, the same
design covers VHDL and SystemVerilog.

**Issue #36 preparation.** This design builds the exact seam #36 formalizes:

- The **register model** (names, offsets, fields, masks, enums) lives once in
  the `.mm.yml` and is consumed by all hosts via `mm_loader.py` — the same
  single-source model #36 splits by consumer.
- The **JTAG-master transport** (`master_read_32`/`master_write_32` for System
  Console; JTAG-to-AXI for xsdb) is Part D of #36, plus the fabric plumbing (the
  optional JTAG master in the test system that #36's
  `altera_test_system.qsys.j2` change will add).
- The dense-map + explicit base-address choices bake in #36's documented
  bring-up caveats (sparse maps can diverge; sim bypasses the interconnect, so
  green sim is necessary but not sufficient).

## Reused assets (do not reinvent)

- **Hardware scaffold template:** `cvsoc/16_ipcraft_led_avmm/` (qsys, quartus
  `Makefile`, `software/app/main.c`, `tb/`, `hdl/de10_nano_top.vhd`).
- **Conformance register model + assertion list:**
  `ipcraft-spec/examples/daq_controller/daq_controller.{ip,mm}.yml` and
  `src/test/fixtures/register-semantics/tb_daq_regs.vhd` (every access-type
  `chk`), driven by `src/test/integration/register-semantics.test.ts`.
- **Headless generation:** `src/generator/IpCoreScaffolder.ts` `generateAll`,
  invoked as in `src/test/integration/generator.ts` and
  `scripts/validate-examples-qsys.js`.
- **`.mm.yml`-driven host seam:** `src/generator/templates/mm_loader.py.j2`,
  `cocotb_test.py.j2` (bus drivers to extend into a scoreboard).
- **HDL semantics ground truth:** `register_file.vhdl.j2`, `package.vhdl.j2`,
  `bus_axil.vhdl.j2`, `bus_avmm.vhdl.j2`.
- **CPU-to-FPGA paths:** `cvsoc/05_hps_led` (ARM bare-metal bridge enable),
  `cvsoc/10_linux_led/software/fpga_led.py` (`/dev/mem` mmap).

## What is genuinely new

The conformance `.mm.yml`/`.ip.yml`; the loopback `_core`; the pin-assigned
Variant A/B board projects; the JTAG-to-Avalon (and JTAG-to-AXI) master in the
test system; the three host self-tests (cocotb scoreboard, Nios II C, System
Console / xsdb Tcl); the board-in-the-loop `Makefile`; and this document.

## Verification

1. **Design is executable, not hand-wavy.** The loopback wiring table maps to
   real `regs_in`/`regs_out` record fields (verify against a generated
   `regmap_conformance_pkg.vhd`); the Nios II offsets match the `.mm.yml`; the
   System Console `master_*_32` addresses match the byte offsets.
2. **Pre-hardware gate is real.** The cocotb scoreboard, run headlessly on GHDL
   against freshly generated RTL, passes — the CI-runnable acceptance test for
   the design before any silicon.
3. **On-hardware (board-in-the-loop, self-hosted runner).** `make test` returns
   0 and the JTAG UART / System Console log shows `CONFORMANCE: ALL PASS`.
4. **The harness actually catches regressions.** Reintroducing a known generator
   bug (e.g. the `>> 2` address shift) makes `make test` return nonzero —
   proving the loop detects generator faults, not just that a good design passes.

## Open items to confirm during implementation

- Whether Variant A puts Nios II **and** the JTAG-to-Avalon master in one system
  (recommended) or two separate `.sof`s.
- Whether to add a **sparse/gap** conformance map as a documented
  known-divergence case (issue #36 caveat) — a stretch goal; the primary map
  stays dense.
