# 18_ipcraft_regmap_conformance_axil — Hardware Validation Results

## Status: all 24 register access-type conformance checks PASS on DE10-Nano (Quartus 23.1std, Cyclone V), Variant B (AXI4-Lite)

This is the AXI4-Lite implementation of
[docs/hardware-conformance-test-plan.md](https://github.com/bleviet/ipcraft-vscode/blob/main/docs/hardware-conformance-test-plan.md)
(ipcraft-vscode repo), "Variant B". It proves the AXI4-Lite bus wrapper on
real silicon using the **same register map and STIMULUS loopback design**
as `17_ipcraft_regmap_conformance` (Avalon-MM) -- only the bus wrapper and
test-host drivers differ.

## Key simplification over the plan's original Variant B design

The plan originally proposed hanging the AXI4-Lite IP off the HPS
lightweight HPS-to-FPGA bridge and driving it from the ARM (bare-metal or
Linux). This project instead uses an **FPGA-fabric-only system**: a
JTAG-to-Avalon-MM debug master (`altera_jtag_avalon_master`) connects
**directly** to the AXI4-Lite conformance IP's `S_AXI_LITE` slave interface.
Platform Designer auto-inserts the Avalon-MM<->AXI4 protocol bridge:

```
Info: Interconnect is inserted between master jtag_debug_master.master and
      slave regmap_axil.S_AXI_LITE because the master is of type avalon
      and the slave is of type axi4lite.
...instantiated altera_merlin_axi_slave_ni "regmap_axil_S_AXI_LITE_agent"
```

This avoids all HPS bring-up complexity (U-Boot/Linux boot flow, bridge
enable, device tree) entirely, reuses the exact same System Console
register-access pattern already proven on `17_ipcraft_regmap_conformance`,
and still proves the thing that actually needed proving: the generated
AXI4-Lite bus wrapper (`bus_axil.vhdl.j2`) is correct on real silicon,
including its SLVERR response path (no Avalon-MM equivalent).

## Result summary

| Stage | Result |
|---|---|
| cocotb scoreboard on GHDL (pre-hardware gate) | **PASS** — 13/13 tests, including the AXI4-Lite-specific SLVERR negative test |
| Quartus full compile (qsys + synthesis + fit + timing) | **PASS** — 0 errors |
| Board program (JTAG, DE10-Nano) | **PASS** — configuration succeeded |
| System Console conformance host (`conformance_sysconsole.tcl`) | **PASS** — 24/24 checks, reproducible from a freshly-programmed board |

### Full System Console run (fresh board, `make test`)

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
@@PASS unmapped_read_returns_zero
@@RESULT CONFORMANCE: ALL PASS
```

This exercises, on real hardware: all 7 field access types, change-of-state
(`monitorChangeOf`), a register array, a mixed register, an enumerated field
with a non-zero reset value, byte-strobe partial writes, and (AXI4-Lite
specific) the SLVERR response for an unmapped address.

## Findings

1. **Platform Designer auto-bridges Avalon-MM <-> AXI4-Lite with no manual
   bridge component.** Confirmed empirically (see the qsys-generate log
   excerpt above) -- worth documenting since it wasn't obvious in advance
   whether `add_connection <avalon-master> <axi4lite-slave>` would validate
   at all. It does, and `qsys-generate` instantiates
   `altera_merlin_axi_slave_ni` automatically.

2. **A qsys instance label colliding with the component name breaks Tcl
   parsing differently than expected.** Reusing
   `17_ipcraft_regmap_conformance`'s lesson (distinct instance label vs.
   component name), this project used `regmap_axil` from the start -- no
   repeat of that specific bug.

3. **Unescaped double quotes in an `.ip.yml` `description:` field corrupt
   the generated `_hw.tcl` silently.** The first draft of this IP's
   description contained the literal phrase `"Variant B"` (quoted). The
   generator's `altera_hw_tcl.j2` template embeds the description directly
   into a `set_module_property DESCRIPTION "..."` Tcl string without
   escaping embedded quotes, so the string terminated early and corrupted
   the rest of the file's Tcl syntax. Platform Designer's component scanner
   doesn't surface a parse error for this -- it just silently reports
   `No module type named regmap_conformance_axil`, `No interface named
   regmap_axil.clk`, etc. for every reference to the broken component,
   which looks exactly like "the component wasn't found" rather than "the
   component definition is corrupt." Root-caused by diffing byte-for-byte
   against a known-working `_hw.tcl`. **Worked around here** by removing the
   embedded quotes from the description (not fixed in the generator --
   `altera_hw_tcl.j2` should Tcl-escape `description` before embedding it).

4. **cocotbext.axi's `AxiLiteMaster.write()` computes WSTRB from address
   alignment, and can therefore issue an *unaligned* AWADDR for a sub-word
   write that starts mid-word** (e.g. `write(offset+1, bytes([0xFF]))` sends
   `AWADDR = offset+1`, not the word-aligned `offset`). This generator's
   AXI4-Lite address decode (`bus_axil.vhdl.j2`, via `wr_addr <=
   awaddr(C_ADDR_WIDTH-1 downto 0);`) does not word-align AWADDR before
   comparing against register offsets, so an unaligned single-byte write
   silently falls through to `when others => null` instead of landing in the
   target register. This is arguably AXI4-protocol-legal master behavior
   (narrow transfers may present a non-word-aligned address with WSTRB
   indicating the active lane), and real compliant AXI4-Lite slaves
   typically decode registers at word granularity with WSTRB doing all the
   byte-masking. **Not fixed here** -- worked around by testing the
   byte-strobe path with a write that starts exactly at the register's
   (already word-aligned) base offset instead of mid-word, which this
   generator's current decode handles correctly. Not confirmed to matter on
   real hardware: this project's only real master (Platform Designer's
   auto-inserted `altera_merlin_axi_slave_ni` bridge, driven by System
   Console's `master_write_32`) always presents word-aligned, full-word
   writes, so the gap was never exercised outside simulation. Documented as
   a lower-confidence finding rather than fixed, unlike the two bugs fixed
   in the Avalon-MM phase.

## What differs from the Avalon-MM cocotb gate

`tb/regmap_conformance_axil_test.py` omits the two same-cycle HW-priority
race tests present in `17_ipcraft_regmap_conformance`'s scoreboard
(`test_int_status_hw_set_beats_sw_clear`, `test_busy_hw_clear_beats_sw_set`).
Avalon-MM's single-cycle, no-waitstate transactions let two "adjacent" bus
calls land on genuinely adjacent clock edges, so the test can observe the
register file's `elsif` priority (HW pulse checked before the SW-write case)
directly. AXI4-Lite's multi-cycle address/data/response handshake means a
second `AxiLiteMaster` transaction's write reaches the register file several
cycles after the first, by which point the HW-set pulse has already been
consumed -- the "race" always resolves to whichever write landed last, which
isn't the property under test. The priority logic itself is bus-agnostic RTL
(the same `regs.vhd` generation is shared between `bus_avmm.vhdl.j2` and
`bus_axil.vhdl.j2`) and is already proven by the Avalon-MM gate.

## Reproducing

```bash
cd 18_ipcraft_regmap_conformance_axil/tb && make SIM=ghdl WAVES=0   # pre-hardware gate
cd ../quartus
make qsys project compile      # or: make all
make test                      # reprograms + runs System Console conformance, 24/24 PASS
```
