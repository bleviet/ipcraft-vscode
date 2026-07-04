# Importing a Real Peripheral: Cross-Checking Against `ddr3_test_master`

Part 3 of the [LED Controller on Real Hardware](led-controller-avmm-authoring.md)
series. Parts 1 and 2 built a new peripheral from scratch. This part runs
IPCraft's importers — `IPCraft: Import from VHDL` and `IPCraft: Import from
Platform Designer _hw.tcl` — against
[`ddr3_test_master.vhd`](https://github.com/bleviet/cvsoc/blob/main/15_ddr3_fpga_hps/hdl/ddr3_test_master.vhd),
the one hand-written, in-production Avalon-MM peripheral that already exists
in cvsoc: a component with **two** Avalon-MM interfaces in opposite roles
(a slave for control/status registers, a master for DDR3 access) — a
genuinely non-trivial disambiguation case, not a synthetic fixture.

!!! info "What you will learn"
    - What IPCraft's VHDL/`_hw.tcl` importers actually reconstruct — and
      what they don't.
    - How to cross-check two independent imports of the same component
      against each other and against hand-written documentation.
    - A real usability gap the cross-check surfaced in the VHDL importer.

## Scope: bus-interface detection, not register-map reconstruction

`src/parser/VhdlParser.ts` and `src/parser/HwTclParser.ts` reconstruct a
`.ip.yml`'s structural layer — clocks, resets, bus interfaces, parameters,
ports — via pattern matching. Neither reads FSM/case-statement logic to
produce register offsets, field bit ranges, or access types. So this part
proves *bus-interface detection* correctness on a real production core, not
automatic register-map import — the `.mm.yml` is hand-authored from the
VHDL's own comment block, the same exercise a real integration would need.

## Two independent imports, cross-checked

1. **`IPCraft: Import from VHDL`** against `hdl/ddr3_test_master.vhd`.
2. **`IPCraft: Import from Platform Designer _hw.tcl`** against the
   already-existing, hand-written
   `qsys/ddr3_test_master_hw.tcl` — an independent, human-authored ground
   truth for the same component.

Both agree on the essentials: `clk`/`reset_n` (active-low, correctly
inferred from the `_n` suffix), and **two** Avalon-MM `busInterfaces` —
`avs` (slave, `avs_` prefix) and `avm` (master, `avm_` prefix, correctly
disambiguated by role despite sharing a bus type) — with matching
`associatedClock`/`associatedReset`.

## A real gap the cross-check found

The two imports **disagree** on `useOptionalPorts`. `HwTclParser`'s import
lists the complete, correct port sets for both interfaces (matching a direct
reading of the VHDL port list). `VhdlParser`'s import lists **none** of the
core signals (`address`/`read`/`write`/`writedata`/`readdata`) for either
interface — only genuinely-extra ports beyond its detection baseline
(`byteenable`/`readdatavalid`/`waitrequest` for `avm`).

This matters because of what Part 1 already established: every port in
`avalon_mm.yml`'s bus definition is `presence: optional`, with no true
"required" set, and the generator only includes ports explicitly listed in
`useOptionalPorts`. `VhdlParser`'s output, used as-is, would reproduce
Part 1's Bug 1 — an Avalon-MM interface with no usable ports — via a
completely different path (import, not authoring). This is a real, confirmed
usability gap in the VHDL importer: **its output is not directly
scaffold-ready for Avalon-MM interfaces** without manually adding the core
ports to `useOptionalPorts` first. Fixing the importer itself would mean
teaching it to serialize the ports it actually matched against the bus
template, for every bus type it supports — a larger, riskier change than
this tutorial's scope. Flagged here as a known limitation, not silently
worked around.

## Hand-authoring the register map

`ddr3_test_master.mm.yml` transcribes the VHDL's own comment block
faithfully:

| Offset | Register | Access | Notes |
|--------|----------|--------|-------|
| `0x00` | CTRL | mixed | `START[0]` write-self-clearing, `MODE[1]` read-write, `RUNNING[2]` read-only |
| `0x04` | BASE_ADDR | read-write | 32-bit |
| `0x08` | LENGTH | read-write | 32-bit |
| `0x0C` | STATUS | read-only | `DONE[0]`, `ERROR[1]`, `ERROR_COUNT[31:16]` (saturates in hardware) |
| `0x10` | PATTERN | read-write | 32-bit |

Two things worth calling out precisely:

- **`START`'s auto-clear is structurally identical to IPCraft's own
  `write-self-clearing` codegen.** The VHDL does
  `if running = '1' then reg_ctrl(0) <= '0'; end if;` — a hardware-gated
  clear, not a blind one-cycle pulse. `register_file.vhdl.j2` generates
  exactly this shape (`if regs_in.<reg>_clear.<field>_clear = '1' then
  <bit> <= '0' ...`). A point in IPCraft's favor: the schema's
  `write-self-clearing` access type describes this real-world pattern
  correctly, not a simplified approximation of it.
- **`ERROR_COUNT`'s saturating increment is outside what `.mm.yml`
  describes.** The VHDL saturates at `0xFFFF` in hardware
  (`if error_count /= x"FFFF" then error_count <= error_count + 1`) — a
  piece of internal update logic with no dedicated access-type keyword.
  `.mm.yml` describes a register's *interface contract* (read-only, 16
  bits) — not its internal update rule. Stated explicitly rather than
  overclaimed.

An interesting aside on addressing conventions: `ddr3_test_master.vhd`
decodes `avs_address` as a **word** index (`when "000" => -- CTRL (0x00)`,
3 bits covering word offsets 0–4) — the classical Avalon-MM convention,
and the one the *original* (pre-fix) `cocotb_test.py.j2` template's
`addr >> 2` actually matched. IPCraft's own generated register file
(`register_file.vhdl.j2`) instead decodes raw **byte** offsets directly, with
no shift. Neither convention is wrong on its own terms; the Part 2 bug was
specifically that the generated test assumed the *former* while testing RTL
built on the *latter*.

## Verification

- Both imports run without error and produce schema-valid `.ip.yml` (checked
  via a dry-run scaffold — `dryRun: true` validates against the JSON schema
  without writing files).
- The two imported `busInterfaces` blocks agree on interface roles, prefixes,
  and clock/reset wiring (disagreeing only on `useOptionalPorts`, as above).
- The hand-authored `.mm.yml`'s offsets and fields match both the VHDL header
  comment and the markdown table in `15_ddr3_fpga_hps/doc/README.md` — a
  human-verified side-by-side diff, documented as such rather than
  overclaimed as automated (the ground truth is prose, not executable).

Next: [Part 4](headless-quartus-build.md) runs a real headless Quartus build
of the Part 1 peripheral.
