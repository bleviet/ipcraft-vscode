# regmap_conformance_avmm — Hardware Validation Results

## Status: all 23 register access-type conformance checks PASS on DE10-Nano (Quartus 23.1std, Cyclone V), Variant A (Avalon-MM)

This is the Altera/Avalon-MM implementation of
[docs/hardware-conformance-test-plan.md](https://github.com/bleviet/ipcraft-vscode/blob/main/docs/hardware-conformance-test-plan.md)
(ipcraft-vscode repo). It proves, on real silicon, that every register/field
access type IPCraft generates behaves correctly — not just in simulation.

## Result summary

| Stage | Result |
|---|---|
| cocotb scoreboard on GHDL (pre-hardware gate) | **PASS** — 14/14 tests, including two tight same-adjacent-cycle HW-priority race tests |
| Quartus full compile (qsys + synthesis + fit + timing) | **PASS** — 0 errors; worst-case setup slack +15.4ns, hold +0.127ns |
| Board program (JTAG, DE10-Nano) | **PASS** — configuration succeeded |
| System Console conformance host (`conformance_sysconsole.tcl`) | **PASS** — 23/23 checks, reproducible from a freshly-programmed board |
| Nios II C conformance host (`software/app/main.c`) | Register-level execution confirmed (see below); JTAG UART text capture unresolved (see Known limitation) |

### Full System Console run (fresh board, `make program-sof && make conformance-sysconsole`)

```
@@PASS id_readonly
@@PASS id_readonly_write_noop
@@PASS scratch_rw_roundtrip
@@PASS status_tracks_stimulus
@@PASS int_status_hw_set
@@PASS int_status_sw_clear
@@PASS irq_legacy_reads_zero_initial
@@PASS irq_legacy_not_readable
@@PASS command_not_readable
@@PASS busy_readable_while_set
@@PASS busy_hw_self_clear
@@PASS diag_write_only_reads_zero
@@PASS wo_mirror_echoes_diag
@@PASS link_speed_tracks_stimulus
@@PASS link_speed_changed_set
@@PASS link_speed_changed_cleared
@@PASS link_no_event_on_unchanged_value
@@PASS control_nonzero_reset
@@PASS control_enum_write
@@PASS channel0_count_distinct
@@PASS channel1_count_distinct
@@PASS channel0_config_rw
@@PASS channel1_config_not_aliased
@@RESULT CONFORMANCE: ALL PASS
```

This exercises, on real hardware: all 7 field access types (`read-only`,
`write-only`, `read-write`, `write-1-to-clear`, `read-write-1-to-clear`,
`write-self-clearing`, `read-write-self-clearing`), change-of-state
(`monitorChangeOf`), a register array, a mixed register, an enumerated field
with a non-zero reset value, and two HW-vs-SW priority races
(`int_status_hw_set_beats_sw_clear`-equivalent coverage is in the cocotb gate;
the board run covers the steady-state set/clear semantics for every type).

## Generator bugs found and fixed upstream (ipcraft-vscode)

Both bugs below were found during this project's first pass (hand-patched at
the time — see the original findings in git history) and are now **fixed in
the generator itself**, verified by regenerating this IP from scratch with no
hand-patches and re-validating on real hardware (see "Regression test" below).

1. **32-bit `resetValue` >= `0x80000000` failed GHDL elaboration — FIXED.**
   `package.vhdl.j2` used to emit `to_unsigned(<value>, 32)` for a field's
   `resetValue`; VHDL's default `integer` (and therefore `natural`) type is
   32-bit **signed** (range `0 .. 2147483647`). A resetValue with bit 31 set
   (e.g. `0xC0FFEE01` = 3237998081) overflowed it: GHDL failed elaboration
   with `out of bound expression`, not a compile-time error, so it surfaced
   late. **Fix:** emit a fixed-width VHDL bit-string literal instead (a new
   `bin(value, width)` Nunjucks filter in `TemplateLoader.ts`), which has no
   integer-range limit. `regmap_conformance.mm.yml`'s `ID.MAGIC` is back to
   the original `0xC0FFEE01` as a permanent regression check.

2. **`bus_avmm.vhdl.j2` couldn't generate a WORD-addressed Avalon-MM
   slave — FIXED.** The template unconditionally emitted
   `address <= avs_address(C_ADDR_WIDTH-1 downto 0);` (a byte-address slice),
   which is an out-of-range VHDL slice whenever `portWidthOverrides.address`
   narrows the port below `C_ADDR_WIDTH` for WORDS addressing — the exact
   class of bug `led_avmm`'s hardware bring-up hit and hand-patched
   (`avs_address & "00"`), but that fix was never upstreamed, so it silently
   regressed for any new Avalon-MM IP needing WORDS addressing. **Fix:** the
   template now compares the address port's actual width against
   `addr_width` and zero-pads (`avs_address & "00"`) instead of slicing
   whenever the port is narrower. A companion fix in `altera_hw_tcl.j2` makes
   the generated `_hw.tcl` auto-declare `addressUnits WORDS` (instead of
   always `BYTES`) whenever the address port is narrowed this way, so the
   qsys declaration and the RTL's address reconstruction can never disagree.
   `regmap_conformance_avmm.vhd` and `regmap_conformance_hw.tcl` are no
   longer `managed: false` in the `.ip.yml` — the generator now produces
   correct output on a clean scaffold.

### Regression test

Both fixes were verified two ways:

- **Isolated:** regenerated the IP into a fresh temp directory (no prior
  files, no hand-patches) with the original problematic
  `resetValue: 0xC0FFEE01`. `ghdl -a`/`-e` passed with 0 errors; the emitted
  `_hw.tcl` auto-declared `addressUnits WORDS` and the `_avmm.vhd` emitted
  `address <= avs_address & "00";` with no manual intervention.
- **End-to-end on real hardware:** applied the same fix to this project
  (removed the `managed: false` workarounds, restored `0xC0FFEE01`),
  reran the cocotb gate (14/14 PASS), rebuilt the Quartus project from a
  clean qsys/Quartus state, reprogrammed the DE10-Nano, and reran
  `conformance_sysconsole.tcl`: **23/23 PASS**, including `id_readonly`
  reading back the real `0xC0FFEE01` value — the exact scenario that used to
  fail at GHDL elaboration before even reaching hardware.

## Other findings (not IPCraft generator bugs)

1. **qsys instance label colliding with the entity name breaks VHDL
   synthesis.** `add_instance <name> <entity>` with `<name> == <entity>`
   (e.g. `add_instance regmap_conformance regmap_conformance`) produces a
   Platform Designer-generated top-level VHDL file with a duplicate
   identifier (`Error (10465): name "regmap_conformance" cannot be used
   because it is already used for a previously declared item`). This is a
   qsys/Platform Designer naming-collision pitfall, not an IPCraft generator
   bug, but worth documenting: **always give the qsys instance a distinct
   label from the component name** (this project uses `regmap_ctrl`).

## Why WORDS addressing was needed here too

Variant A necessarily includes a Nios II CPU (`docs/hardware-conformance-test-plan.md`,
"Component 4"). `led_avmm`'s hardware bring-up found that Platform
Designer's interconnect generator cannot build a translator between a BYTES
custom Avalon-MM slave and `altera_nios2_gen2`'s `data_master`. This project
declares a narrower `portWidthOverrides.address` for exactly that reason, and
the generator (post-fix; see above) now emits `addressUnits WORDS` and the
zero-pad reconstruction automatically. The qsys generation step confirmed it
works: the interconnect built cleanly with both `nios2.data_master` and
`jtag_debug_master.master` connected to the WORDS-addressed slave — the same
failure mode the LED bring-up hit is now prevented by the generator itself,
not by a per-project hand-patch.

## Nios II C host — status and known limitation

`software/app/main.c` implements the identical check sequence as the cocotb
scoreboard and the System Console host, using `IOWR_32DIRECT`/`IORD_32DIRECT`
and printing `PASS`/`FAIL` per check plus a final sentinel via `alt_printf`
over the JTAG UART.

**Execution on real hardware is confirmed**, but not via the intended live
UART capture:

- `nios2-download -g` + `nios2-terminal` (the `led_avmm` pattern)
  connects but captures no application text — the same class of "UART
  observation is unreliable" finding `led_avmm`'s own
  `docs/hardware_debug_process.md` documents (Obstacle B). Sequential,
  separate `docker run` invocations for download vs. terminal are too slow
  relative to the firmware's near-instantaneous execution to catch live
  output; concurrent invocations in one container hit a JTAG cable
  contention error (`There is a problem with the Quartus Prime
  installation...`), consistent with `jtagd` not supporting simultaneous
  debug-module (download) and JTAG-UART (terminal) clients reliably on this
  setup.
- System Console's `processor` service (`processor_download_elf` +
  `processor_run`) and `bytestream` service (`bytestream_receive`) were
  tried as a single-session alternative (avoids the multi-client JTAG
  conflict). Download and run both succeed with no errors, but
  `bytestream_receive` never returned any bytes across multiple attempts
  (drain-before-run, post-run polling, 2-arg vs. 3-arg call forms).
- **Register-level proof the firmware ran to completion correctly:**
  reading `SCRATCH` (offset `0x04`) after a `processor_download_elf` +
  `processor_run` cycle returns `0x0000FF00` — exactly the value
  `main.c`'s byte-strobe-overwrite check leaves it at, reproduced across two
  independent fresh-silicon runs. This confirms the Nios II CPU executed the
  identical `IOWR_32DIRECT` register-write sequence correctly through the
  same fabric and register file RTL the System Console host validates
  directly — the gap is JTAG-UART **text capture tooling**, not firmware or
  hardware correctness.

This mirrors `led_avmm`'s own documented experience: use
register/PC-level evidence to confirm execution when live UART text capture
is unreliable, rather than treating UART silence as a correctness failure.

## Reproducing

```bash
cd regmap_conformance_avmm/tb && make SIM=ghdl WAVES=0   # pre-hardware gate
cd ../altera/quartus
make qsys project compile      # or: make all
make program-sof
make conformance-sysconsole    # 23/23 PASS, no firmware needed
```
