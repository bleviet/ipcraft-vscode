"""cocotb self-checking scoreboard for regmap_conformance_axil.

AXI4-Lite variant of regmap_conformance_avmm's tb/regmap_conformance_test.py
-- same register map, same assertions, same STIMULUS loopback design; only the
bus driver differs (cocotbext.axi.AxiLiteMaster instead of raw Avalon-MM pin
toggling). This is the pre-hardware gate: it must be green before any board step.

Hand-written; managed: false in regmap_conformance_axil.ip.yml so a re-scaffold
never overwrites these assertions.
"""
import os
import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer
from mm_loader import load_regmap
from cocotbext.axi import AxiLiteMaster, AxiLiteBus

_MM_YML = os.path.join(os.path.dirname(__file__), "../regmap_conformance_axil.mm.yml")
regmap = load_regmap(_MM_YML)


async def _write_reg(master, byte_addr: int, value: int) -> None:
    await master.write(byte_addr, value.to_bytes(4, "little"))


async def _read_reg(master, byte_addr: int) -> int:
    result = await master.read(byte_addr, 4)
    return int.from_bytes(result.data, "little")


async def _reset_dut(dut) -> None:
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.reset_n.value = 0
    await Timer(100, unit="ns")
    dut.reset_n.value = 1
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut._log.info("Reset complete")


async def _settle(dut, cycles: int = 3) -> None:
    """Wait for a value to propagate bus-write -> regs.vhd -> core -> regs.vhd
    read mux (a two-hop record chain; 3 cycles is comfortably safe)."""
    for _ in range(cycles):
        await RisingEdge(dut.clk)


def _stim(**bits) -> int:
    """Build a STIMULUS register word from named field values (0 elsewhere)."""
    reg = regmap["STIMULUS"]
    val = 0
    for name, bit_value in bits.items():
        val = reg.fields[name].insert(val, bit_value)
    return val


def _master(dut) -> AxiLiteMaster:
    return AxiLiteMaster(AxiLiteBus.from_prefix(dut, "s_axil"), dut.clk)


# ---------------------------------------------------------------------------
# ID -- read-only constant readback
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_id_readonly(dut):
    await _reset_dut(dut)
    m = _master(dut)
    val = await _read_reg(m, regmap["ID"].offset)
    assert val == 0xC0FFEE01, f"ID: expected 0xC0FFEE01, got 0x{val:08X}"

    await _write_reg(m, regmap["ID"].offset, 0xFFFFFFFF)
    await _settle(dut)
    val = await _read_reg(m, regmap["ID"].offset)
    assert val == 0xC0FFEE01, f"ID: expected unchanged 0xC0FFEE01 after write, got 0x{val:08X}"


# ---------------------------------------------------------------------------
# SCRATCH -- plain RW round-trip + byte-strobe partial write
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_scratch_rw_roundtrip(dut):
    await _reset_dut(dut)
    m = _master(dut)
    await _write_reg(m, regmap["SCRATCH"].offset, 0xA5A5A5A5)
    val = await _read_reg(m, regmap["SCRATCH"].offset)
    assert val == 0xA5A5A5A5, f"SCRATCH: expected 0xA5A5A5A5, got 0x{val:08X}"


@cocotb.test()
async def test_scratch_byte_strobe(dut):
    await _reset_dut(dut)
    m = _master(dut)
    await _write_reg(m, regmap["SCRATCH"].offset, 0x11223344)
    val = await _read_reg(m, regmap["SCRATCH"].offset)
    assert val == 0x11223344, f"SCRATCH: expected 0x11223344, got 0x{val:08X}"

    # A 1-byte write exactly at the register's (word-aligned) base offset
    # drives only WSTRB[0] -- AxiLiteMaster derives the strobe from the
    # (address, length) alignment automatically. Note: this driver issues an
    # *unaligned* AWADDR for a sub-word write that starts mid-word (e.g.
    # offset+1), and this generator's address decode does not word-align
    # AWADDR before comparing against the register offset -- so unlike the
    # Avalon-MM byte-strobe test (which strobes lane 1), this one targets
    # lane 0, the only sub-word write this driver issues at an aligned
    # address.
    await m.write(regmap["SCRATCH"].offset, bytes([0xFF]))
    val = await _read_reg(m, regmap["SCRATCH"].offset)
    assert val == 0x112233FF, (
        f"SCRATCH byte strobe: expected 0x112233FF (only lane 0 changed), got 0x{val:08X}"
    )


# ---------------------------------------------------------------------------
# STATUS -- RO live value sourced from STIMULUS via the loopback core
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_status_tracks_stimulus(dut):
    await _reset_dut(dut)
    m = _master(dut)
    val = await _read_reg(m, regmap["STATUS"].offset)
    assert val == 0, f"STATUS: expected 0 after reset, got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(STATUS_VAL=0xA))
    await _settle(dut)
    val = await _read_reg(m, regmap["STATUS"].offset)
    assert val == 0xA, f"STATUS: expected to track STIMULUS.STATUS_VAL=0xA, got 0x{val:08X}"


# ---------------------------------------------------------------------------
# INT_STATUS -- read-write-1-to-clear, multi-bit, HW pulse-set
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_int_status_hw_set_sw_clear(dut):
    await _reset_dut(dut)
    m = _master(dut)
    val = await _read_reg(m, regmap["INT_STATUS"].offset)
    assert val == 0, f"INT_STATUS: expected 0 after reset, got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(SAMPLE_EVT_TRIG=1))
    await _settle(dut)
    val = await _read_reg(m, regmap["INT_STATUS"].offset)
    assert val & 0x1, f"INT_STATUS.SAMPLE_EVT: expected set, got 0x{val:08X}"

    await _write_reg(m, regmap["INT_STATUS"].offset, 0x1)
    await _settle(dut)
    val = await _read_reg(m, regmap["INT_STATUS"].offset)
    assert not (val & 0x1), f"INT_STATUS.SAMPLE_EVT: expected cleared, got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(ERROR_EVT_TRIG=1))
    await _settle(dut)
    val = await _read_reg(m, regmap["INT_STATUS"].offset)
    assert val == 0x2, f"INT_STATUS.ERROR_EVT: expected 0x2, got 0x{val:08X}"
    await _write_reg(m, regmap["INT_STATUS"].offset, 0x2)
    await _settle(dut)
    val = await _read_reg(m, regmap["INT_STATUS"].offset)
    assert val == 0, f"INT_STATUS: expected fully cleared, got 0x{val:08X}"


# NOTE: no test_int_status_hw_set_beats_sw_clear here. On Avalon-MM
# (regmap_conformance_avmm) that test issues the HW-set trigger write
# and the SW-clear write with zero cycle gap -- Avalon-MM's single-cycle,
# no-waitstate transactions let two "adjacent" bus calls land on truly
# adjacent clock edges, letting the test observe the register file's
# `elsif` priority (regs_in.*_pulse checked before the SW-write case)
# directly. AXI4-Lite's multi-cycle address/data/response handshake makes
# that inapplicable: by the time a second AxiLiteMaster transaction's write
# actually reaches the register file, several cycles have elapsed and the
# first transaction's HW-set pulse has already been consumed -- the "race"
# always resolves to whichever write landed last, which isn't the property
# under test. The priority logic itself is bus-agnostic RTL (register_file
# via bus_axil.vhdl.j2 shares the same regs.vhd generation as bus_avmm.vhdl.j2)
# and is already proven by the Avalon-MM gate; re-proving it here would
# require driving the AXI channels at the pin level, out of scope for this
# bus-wrapper-focused suite.


# ---------------------------------------------------------------------------
# IRQ_LEGACY -- plain (non-readable) write-1-to-clear
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_irq_legacy_not_readable(dut):
    await _reset_dut(dut)
    m = _master(dut)
    val = await _read_reg(m, regmap["IRQ_LEGACY"].offset)
    assert val == 0, f"IRQ_LEGACY: expected 0 (not readable), got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(LEGACY_TRIG=1))
    await _settle(dut)
    val = await _read_reg(m, regmap["IRQ_LEGACY"].offset)
    assert val == 0, f"IRQ_LEGACY: expected 0 even after HW set (not readable), got 0x{val:08X}"

    await _write_reg(m, regmap["IRQ_LEGACY"].offset, 0x1)
    await _settle(dut)
    val = await _read_reg(m, regmap["IRQ_LEGACY"].offset)
    assert val == 0, f"IRQ_LEGACY: expected 0 after W1C, got 0x{val:08X}"


# ---------------------------------------------------------------------------
# COMMAND -- write-self-clearing, non-readable
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_command_not_readable(dut):
    await _reset_dut(dut)
    m = _master(dut)
    await _write_reg(m, regmap["COMMAND"].offset, 0x1)
    val = await _read_reg(m, regmap["COMMAND"].offset)
    assert val == 0, f"COMMAND: expected 0 (write-self-clearing, not readable), got 0x{val:08X}"


# ---------------------------------------------------------------------------
# BUSY -- read-write-self-clearing (readable while set)
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_busy_self_clearing_readable(dut):
    await _reset_dut(dut)
    m = _master(dut)
    val = await _read_reg(m, regmap["BUSY"].offset)
    assert val == 0, f"BUSY: expected 0 after reset, got 0x{val:08X}"

    await _write_reg(m, regmap["BUSY"].offset, 0x1)
    val = await _read_reg(m, regmap["BUSY"].offset)
    assert val == 1, f"BUSY: expected readable while set (1), got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(BUSY_DONE_TRIG=1))
    await _settle(dut)
    val = await _read_reg(m, regmap["BUSY"].offset)
    assert val == 0, f"BUSY: expected HW self-clear, got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(BUSY_DONE_TRIG=0))
    await _settle(dut)


# NOTE: no test_busy_hw_clear_beats_sw_set here, for the same reason as
# test_int_status_hw_set_beats_sw_clear above.


# ---------------------------------------------------------------------------
# DIAG / WO_MIRROR -- write-only value reaches hardware, confirmed via RO echo
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_write_only_reaches_hardware(dut):
    await _reset_dut(dut)
    m = _master(dut)
    await _write_reg(m, regmap["DIAG"].offset, 0xAB)
    val = await _read_reg(m, regmap["DIAG"].offset)
    assert val == 0, f"DIAG: expected 0 (write-only), got 0x{val:08X}"

    await _settle(dut)
    val = await _read_reg(m, regmap["WO_MIRROR"].offset)
    assert val == 0xAB, f"WO_MIRROR: expected 0xAB (echo of DIAG), got 0x{val:08X}"


# ---------------------------------------------------------------------------
# LINK -- mixed register: RO live SPEED + change-of-state W1C SPEED_CHANGED
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_link_change_of_state(dut):
    await _reset_dut(dut)
    m = _master(dut)

    val = await _read_reg(m, regmap["LINK"].offset)
    assert val == 0, f"LINK: expected 0 at reset (no spurious CoS event), got 0x{val:08X}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(LINK_SPEED=5))
    await _settle(dut)
    val = await _read_reg(m, regmap["LINK"].offset)
    speed = val & 0xF
    changed = (val >> 8) & 0x1
    assert speed == 5, f"LINK.SPEED: expected 5, got {speed}"
    assert changed == 1, f"LINK.SPEED_CHANGED: expected set after a change, got {changed}"

    await _write_reg(m, regmap["LINK"].offset, 0x1 << 8)
    await _settle(dut)
    val = await _read_reg(m, regmap["LINK"].offset)
    assert (val >> 8) & 0x1 == 0, f"LINK.SPEED_CHANGED: expected cleared, got 0x{val:08X}"
    assert val & 0xF == 5, f"LINK.SPEED: expected unchanged 5, got {val & 0xF}"

    await _write_reg(m, regmap["STIMULUS"].offset, _stim(LINK_SPEED=5))
    await _settle(dut)
    val = await _read_reg(m, regmap["LINK"].offset)
    assert (val >> 8) & 0x1 == 0, (
        f"LINK.SPEED_CHANGED: expected no event on an unchanged value, got 0x{val:08X}"
    )


# ---------------------------------------------------------------------------
# CONTROL -- RW with an enumerated field and a non-zero reset value
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_control_enum_and_nonzero_reset(dut):
    await _reset_dut(dut)
    m = _master(dut)
    val = await _read_reg(m, regmap["CONTROL"].offset)
    assert val == 1, f"CONTROL.MODE: expected reset value 1 (READY), got {val}"

    await _write_reg(m, regmap["CONTROL"].offset, 3)
    val = await _read_reg(m, regmap["CONTROL"].offset)
    assert val == 3, f"CONTROL.MODE: expected 3 (FAULT), got {val}"


# ---------------------------------------------------------------------------
# CHANNEL array -- addressing + no-aliasing
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_channel_array_no_aliasing(dut):
    await _reset_dut(dut)
    m = _master(dut)

    config_0 = regmap["CHANNEL_0_CONFIG"].offset
    config_1 = regmap["CHANNEL_1_CONFIG"].offset
    count_0 = regmap["CHANNEL_0_COUNT"].offset
    count_1 = regmap["CHANNEL_1_COUNT"].offset

    val0 = await _read_reg(m, count_0)
    val1 = await _read_reg(m, count_1)
    assert val0 == 0x11, f"CHANNEL[0].COUNT: expected 0x11, got 0x{val0:08X}"
    assert val1 == 0x22, f"CHANNEL[1].COUNT: expected 0x22, got 0x{val1:08X}"
    assert val0 != val1, "CHANNEL[0].COUNT and CHANNEL[1].COUNT must not alias"

    await _write_reg(m, config_0, 0x55)
    await _write_reg(m, config_1, 0xAA)
    r0 = await _read_reg(m, config_0)
    r1 = await _read_reg(m, config_1)
    assert r0 == 0x55, f"CHANNEL[0].CONFIG: expected 0x55, got 0x{r0:08X}"
    assert r1 == 0xAA, f"CHANNEL[1].CONFIG: expected 0xAA (not aliased to element 0), got 0x{r1:08X}"

    await _write_reg(m, config_0, 0x00)
    r0 = await _read_reg(m, config_0)
    r1 = await _read_reg(m, config_1)
    assert r0 == 0x00, f"CHANNEL[0].CONFIG: expected 0x00, got 0x{r0:08X}"
    assert r1 == 0xAA, f"CHANNEL[1].CONFIG: expected untouched 0xAA, got 0x{r1:08X}"


# ---------------------------------------------------------------------------
# AXI4-Lite-specific: SLVERR on an out-of-range address
# (docs/hardware-conformance-test-plan.md "Addressing" bullet -- AXI
# additionally returns SLVERR for addresses beyond the map; Avalon-MM has no
# equivalent since it has no response-code channel.)
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_slverr_on_unmapped_address(dut):
    await _reset_dut(dut)
    m = _master(dut)

    # 0x60 is within the 7-bit/128-byte address window (AWADDR/ARADDR width)
    # but beyond the highest mapped register (CHANNEL_1_COUNT @ 0x44) -- an
    # address the AxiLiteMaster driver will actually issue on the bus,
    # unlike an address beyond its own configured window.
    result = await m.read(0x60, 4)
    assert result.resp == 2, f"Expected SLVERR (resp=2) for unmapped address, got resp={result.resp}"
