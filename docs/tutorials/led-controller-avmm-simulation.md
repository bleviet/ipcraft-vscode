# Simulating Before Hardware: cocotb, GHDL, and Four Real Bugs

Part 2 of the [LED Controller on Real Hardware](led-controller-avmm-authoring.md)
series. This is the first HDL simulation testbench in the entire
[cvsoc](https://github.com/bleviet/cvsoc) repository — closing the gap its own
`docs/review.md` calls out as cvsoc's #1 issue ("not a single testbench
exists") — and, in the process of adding *real* assertions instead of the
generated smoke test's bare logging, it surfaced four confirmed, previously
invisible bugs in IPCraft's own cocotb generation path.

!!! info "What you will learn"
    - Extending a generated cocotb test with real assertions, protected from
      re-scaffold via `fileSets`/`managed: false`.
    - Why "the generated test passed" and "the generated test proved
      anything" are different claims — and how to close that gap.
    - Four real bugs this exercise found in IPCraft's cocotb generation path,
      all now fixed with regression tests.

---

## The three assertions

Extending `tb/led_controller_avmm_test.py`'s generated
`test_register_access` (which only logs read-back values) with three real
`@cocotb.test()` functions:

1. **`test_version_register`** — `VERSION` reads back `0x00000100` after
   reset.
2. **`test_led_pattern_passthrough`** — writing `LED_PATTERN` is visible both
   in the register readback *and* on the `led` output port (proves the core
   stub's passthrough wiring, not just the register bank).
3. **`test_heartbeat_event_w1c`** — fast-forwarding
   `u_core.heartbeat_counter` (a cocotb backdoor signal poke, avoiding a real
   2²⁴-cycle wait) to just before rollover, then checking
   `EVENTS.HEARTBEAT_TOGGLED` sets on the transition and clears on a
   write-1-to-clear.

Both new test files (`led_controller_avmm_test.py` and its pytest wrapper,
`test_led_controller_avmm_sim.py`) are marked `managed: false` in
`led_controller_avmm.ip.yml`'s `fileSets`, so a future `IPCraft: Scaffold
Project` re-run never overwrites them.

## Running it and what broke

`make -C tb SIM=ghdl WAVES=0` — and immediately, all three new assertions
failed. Not because the peripheral was wrong: because the generated cocotb
*infrastructure itself* had never been exercised end-to-end with real
assertions on any IPCraft-generated Avalon-MM core, by anyone, ever. Four
compounding bugs, each hiding the next:

### Bug 1 — `mm_loader.py`'s `address_blocks` vs. `addressBlocks`

`mm_loader.py.j2` (the generated helper that reads a `.mm.yml` at test-time
so registers can be iterated without regenerating anything) looked up
`(mm or {}).get("address_blocks", [])` and `block.get("base_address", 0)` —
**snake_case**. The memory-map schema defines these fields exclusively in
**camelCase** (`addressBlocks`, `baseAddress` — this repo's own stated
convention: "Strict camelCase, no dual-state fallbacks"). Every lookup
silently returned nothing, so `load_regmap()` returned an **empty register
list** for every generated cocotb test in the project — invisible because
the generated smoke test's `for reg in regmap: ...` loop just never ran its
body, and nothing complained.

### Bug 2 — `_parse_bits` never stripped `[`/`]`

Once bug 1 was fixed and registers started flowing through, the very first
bit field hit `ValueError: invalid literal for int() with base 10: '[7'`.
`_parse_bits` split a `bits` string on `":"` without stripping the schema's
literal brackets (`bits: '[7:0]'` is the documented, universal format across
every real `.mm.yml` in `ipcraft-spec`) — so `"[7:0]".split(":")` produced
`["[7", "0]"]`, and `int("[7")` always raised. **This function had never
successfully parsed a single real bit field.**

### Bug 3 — `cocotb_test.py.j2`'s address shift

With both of the above fixed, registers finally read back — but the wrong
values, at the wrong offsets. `cocotb_test.py.j2`'s Avalon-MM
`_write_reg`/`_read_reg` helpers wrote `addr >> 2` (assuming a word-indexed
Avalon-MM convention), but the generated register file
(`register_file.vhdl.j2`/`bus_avmm.vhdl.j2`) decodes **raw byte offsets**
directly, with no word-to-byte shift anywhere in the RTL. Every access in
every generated Avalon-MM cocotb test landed at the wrong address. The
AXI-Lite branch of the same template was correct (`cocotbext-axi` already
expects byte addresses) — only the hand-rolled `avmm` branch had this
mismatch.

### Bug 4 — one cycle short on a fixed-latency read

With addressing fixed, register values still came back — but each read
returned the *previous* bus access's result, exactly one transaction behind.
The generated register file's read path is **registered**
(`rd_data_int <= ...` inside a clocked process), so for a slave with no
`readdatavalid` handshake, `readdata` only becomes valid **one cycle after**
`read` is sampled — not in the same cycle `_read_reg` deasserts it. Confirmed
empirically (not just by inspection) by adding one extra `await
RisingEdge(dut.clk)` and re-running: all four tests went from 1/4 to 4/4
passing.

All four fixes are in `ipcraft-vscode` (`mm_loader.py.j2`,
`cocotb_test.py.j2`), each with its own regression test in
`IpCoreScaffolder.test.ts` / `CocotbFramework.test.ts` — verified to fail
without the fix and pass with it before being accepted.

## Why this happened

Every one of these four bugs shares the same root cause, stated plainly in
the generated test's own docstring before this tutorial: *"Test register
read/write access... `dut._log.info(...)`"* — **the generated cocotb test
logs, it never asserts.** A test that cannot fail cannot catch a bug. This is
exactly why "prove it on real hardware, not just a CI fixture" is the premise
of this whole series: `ipcraft-spec`'s own CI-exercised examples
(`comprehensive_avalon`, `daq_controller`) have been generating this same
broken cocotb path on every run, for as long as it's existed, without a
single failure — because nothing was ever asked to fail.

## Verification

`make -C tb SIM=ghdl WAVES=0` — 4/4 tests pass:

```
** led_controller_avmm_test.test_register_access           PASS
** led_controller_avmm_test.test_version_register          PASS
** led_controller_avmm_test.test_led_pattern_passthrough    PASS
** led_controller_avmm_test.test_heartbeat_event_w1c        PASS
** TESTS=4 PASS=4 FAIL=0 SKIP=0
```

Next: [Part 3](importing-avalon-mm-peripherals.md) turns to IPCraft's
importers, validating them against `ddr3_test_master.vhd` — cvsoc's one
existing hand-written Avalon-MM peripheral.
