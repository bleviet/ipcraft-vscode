"""cocotb self-checking scoreboard for regmap_conformance.

Asserts every access-type idiom the register access-type conformance IP
exercises (docs/hardware-conformance-test-plan.md, "Component 1"). This is
the pre-hardware gate: it must be green before any board step.

Unlike the generator's default cocotb_test.py.j2 output (which only logs
read-backs), every test here is assert-based -- a silent pass is a real
pass, not just "didn't crash".

Hand-written; managed: false in regmap_conformance.ip.yml so a re-scaffold
never overwrites these assertions.
"""
import os
import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer
from mm_loader import load_regmap

_MM_YML = os.path.join(os.path.dirname(__file__), "../regmap_conformance.mm.yml")
regmap = load_regmap(_MM_YML)


async def _write_reg(dut, byte_addr: int, value: int) -> None:
    """Write a 32-bit register over Avalon-MM.

    avs_address is WORD-addressed (addressUnits WORDS in
    regmap_conformance_hw.tcl -- see the RTL_Sources note in
    regmap_conformance.ip.yml): Platform Designer's interconnect generator
    cannot build a translator between a BYTES custom slave and
    altera_nios2_gen2's data_master, confirmed on 16_ipcraft_led_avmm
    hardware bring-up. This driver must shift the byte offset down by 2
    to match, exactly as the fabric does.
    """
    dut.avs_address.value = byte_addr >> 2
    dut.avs_writedata.value = value
    dut.avs_byteenable.value = 0xF
    dut.avs_write.value = 1
    await RisingEdge(dut.clk)
    dut.avs_write.value = 0


async def _write_reg_strobe(dut, byte_addr: int, value: int, byteenable: int) -> None:
    """Write with an explicit byte-strobe mask (partial-write test)."""
    dut.avs_address.value = byte_addr >> 2
    dut.avs_writedata.value = value
    dut.avs_byteenable.value = byteenable
    dut.avs_write.value = 1
    await RisingEdge(dut.clk)
    dut.avs_write.value = 0
    dut.avs_byteenable.value = 0xF


async def _read_reg(dut, byte_addr: int) -> int:
    """Read a 32-bit register over Avalon-MM.

    The generated register file's read path is registered (rd_data_int is
    set inside a clocked process), so readdata is valid one cycle after
    `read` is sampled, not in the same cycle it is deasserted.
    """
    dut.avs_address.value = byte_addr >> 2
    dut.avs_read.value = 1
    await RisingEdge(dut.clk)
    dut.avs_read.value = 0
    await RisingEdge(dut.clk)
    return int(dut.avs_readdata.value)


async def _reset_dut(dut) -> None:
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.avs_write.value = 0
    dut.avs_read.value = 0
    dut.avs_byteenable.value = 0xF
    dut.reset.value = 1
    await Timer(100, unit="ns")
    dut.reset.value = 0
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


# ---------------------------------------------------------------------------
# ID -- read-only constant readback
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_id_readonly(dut):
    await _reset_dut(dut)
    val = await _read_reg(dut, regmap["ID"].offset)
    assert val == 0xC0FFEE01, f"ID: expected 0xC0FFEE01, got 0x{val:08X}"

    # Writes to a read-only register must have no effect.
    await _write_reg(dut, regmap["ID"].offset, 0xFFFFFFFF)
    await _settle(dut)
    val = await _read_reg(dut, regmap["ID"].offset)
    assert val == 0xC0FFEE01, f"ID: expected unchanged 0xC0FFEE01 after write, got 0x{val:08X}"


# ---------------------------------------------------------------------------
# SCRATCH -- plain RW round-trip + byte-strobe partial write
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_scratch_rw_roundtrip(dut):
    await _reset_dut(dut)
    await _write_reg(dut, regmap["SCRATCH"].offset, 0xA5A5A5A5)
    val = await _read_reg(dut, regmap["SCRATCH"].offset)
    assert val == 0xA5A5A5A5, f"SCRATCH: expected 0xA5A5A5A5, got 0x{val:08X}"


@cocotb.test()
async def test_scratch_byte_strobe(dut):
    await _reset_dut(dut)
    await _write_reg(dut, regmap["SCRATCH"].offset, 0x11223344)
    val = await _read_reg(dut, regmap["SCRATCH"].offset)
    assert val == 0x11223344, f"SCRATCH: expected 0x11223344, got 0x{val:08X}"

    # Strobe only byte lane 1 (bits [15:8]) -- other lanes must be untouched.
    await _write_reg_strobe(dut, regmap["SCRATCH"].offset, 0x0000FF00, 0x2)
    val = await _read_reg(dut, regmap["SCRATCH"].offset)
    assert val == 0x1122FF44, (
        f"SCRATCH byte strobe: expected 0x1122FF44 (only lane 1 changed), got 0x{val:08X}"
    )


# ---------------------------------------------------------------------------
# STATUS -- RO live value sourced from STIMULUS via the loopback core
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_status_tracks_stimulus(dut):
    await _reset_dut(dut)
    val = await _read_reg(dut, regmap["STATUS"].offset)
    assert val == 0, f"STATUS: expected 0 after reset, got 0x{val:08X}"

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(STATUS_VAL=0xA))
    await _settle(dut)
    val = await _read_reg(dut, regmap["STATUS"].offset)
    assert val == 0xA, f"STATUS: expected to track STIMULUS.STATUS_VAL=0xA, got 0x{val:08X}"


# ---------------------------------------------------------------------------
# INT_STATUS -- read-write-1-to-clear, multi-bit, HW pulse-set
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_int_status_hw_set_sw_clear(dut):
    await _reset_dut(dut)
    val = await _read_reg(dut, regmap["INT_STATUS"].offset)
    assert val == 0, f"INT_STATUS: expected 0 after reset, got 0x{val:08X}"

    # Rising edge on SAMPLE_EVT_TRIG -> INT_STATUS.SAMPLE_EVT sets.
    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(SAMPLE_EVT_TRIG=1))
    await _settle(dut)
    val = await _read_reg(dut, regmap["INT_STATUS"].offset)
    assert val & 0x1, f"INT_STATUS.SAMPLE_EVT: expected set, got 0x{val:08X}"

    # A held trigger (no new rising edge) must not re-pulse; SW W1C clears it.
    await _write_reg(dut, regmap["INT_STATUS"].offset, 0x1)
    await _settle(dut)
    val = await _read_reg(dut, regmap["INT_STATUS"].offset)
    assert not (val & 0x1), f"INT_STATUS.SAMPLE_EVT: expected cleared, got 0x{val:08X}"

    # ERROR_EVT is an independent bit.
    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(ERROR_EVT_TRIG=1))
    await _settle(dut)
    val = await _read_reg(dut, regmap["INT_STATUS"].offset)
    assert val == 0x2, f"INT_STATUS.ERROR_EVT: expected 0x2, got 0x{val:08X}"
    await _write_reg(dut, regmap["INT_STATUS"].offset, 0x2)
    await _settle(dut)
    val = await _read_reg(dut, regmap["INT_STATUS"].offset)
    assert val == 0, f"INT_STATUS: expected fully cleared, got 0x{val:08X}"


@cocotb.test()
async def test_int_status_hw_set_beats_sw_clear(dut):
    """Fire the HW-set trigger and an SW W1C-clear on adjacent bus cycles
    with no settle gap -- the ground-truth register file's `elsif` priority
    (regs_in.*_pulse checked before the SW-write case) means an HW set that
    lands the same cycle a clear is attempted wins. Back-to-back issue with
    no wait between them is the tightest race a bus master can construct."""
    await _reset_dut(dut)

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(SAMPLE_EVT_TRIG=1))
    await _write_reg(dut, regmap["INT_STATUS"].offset, 0x1)  # clear attempt, no gap
    await _settle(dut)
    val = await _read_reg(dut, regmap["INT_STATUS"].offset)
    assert val & 0x1, f"INT_STATUS.SAMPLE_EVT: expected HW-set to win the race, got 0x{val:08X}"

    # Clean up: drop the trigger and clear for the next test.
    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(SAMPLE_EVT_TRIG=0))
    await _write_reg(dut, regmap["INT_STATUS"].offset, 0x1)
    await _settle(dut)


# ---------------------------------------------------------------------------
# IRQ_LEGACY -- plain (non-readable) write-1-to-clear
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_irq_legacy_not_readable(dut):
    await _reset_dut(dut)
    val = await _read_reg(dut, regmap["IRQ_LEGACY"].offset)
    assert val == 0, f"IRQ_LEGACY: expected 0 (not readable), got 0x{val:08X}"

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(LEGACY_TRIG=1))
    await _settle(dut)
    val = await _read_reg(dut, regmap["IRQ_LEGACY"].offset)
    assert val == 0, f"IRQ_LEGACY: expected 0 even after HW set (not readable), got 0x{val:08X}"

    await _write_reg(dut, regmap["IRQ_LEGACY"].offset, 0x1)
    await _settle(dut)
    val = await _read_reg(dut, regmap["IRQ_LEGACY"].offset)
    assert val == 0, f"IRQ_LEGACY: expected 0 after W1C, got 0x{val:08X}"


# ---------------------------------------------------------------------------
# COMMAND -- write-self-clearing, non-readable
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_command_not_readable(dut):
    await _reset_dut(dut)
    await _write_reg(dut, regmap["COMMAND"].offset, 0x1)
    val = await _read_reg(dut, regmap["COMMAND"].offset)
    assert val == 0, f"COMMAND: expected 0 (write-self-clearing, not readable), got 0x{val:08X}"


# ---------------------------------------------------------------------------
# BUSY -- read-write-self-clearing (readable while set)
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_busy_self_clearing_readable(dut):
    await _reset_dut(dut)
    val = await _read_reg(dut, regmap["BUSY"].offset)
    assert val == 0, f"BUSY: expected 0 after reset, got 0x{val:08X}"

    await _write_reg(dut, regmap["BUSY"].offset, 0x1)
    val = await _read_reg(dut, regmap["BUSY"].offset)
    assert val == 1, f"BUSY: expected readable while set (1), got 0x{val:08X}"

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(BUSY_DONE_TRIG=1))
    await _settle(dut)
    val = await _read_reg(dut, regmap["BUSY"].offset)
    assert val == 0, f"BUSY: expected HW self-clear, got 0x{val:08X}"

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(BUSY_DONE_TRIG=0))
    await _settle(dut)


@cocotb.test()
async def test_busy_hw_clear_beats_sw_set(dut):
    """As test_int_status_hw_set_beats_sw_clear, but for the SC-clear path:
    an SW set and the HW-clear trigger issued with no settle gap -- the
    ground-truth priority (regs_in.busy_clear.active_clear checked before
    the SW-set case) means HW clear wins."""
    await _reset_dut(dut)

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(BUSY_DONE_TRIG=1))
    await _write_reg(dut, regmap["BUSY"].offset, 0x1)  # set attempt, no gap
    await _settle(dut)
    val = await _read_reg(dut, regmap["BUSY"].offset)
    assert val == 0, f"BUSY: expected HW-clear to win the race, got 0x{val:08X}"

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(BUSY_DONE_TRIG=0))
    await _settle(dut)


# ---------------------------------------------------------------------------
# DIAG / WO_MIRROR -- write-only value reaches hardware, confirmed via RO echo
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_write_only_reaches_hardware(dut):
    await _reset_dut(dut)
    await _write_reg(dut, regmap["DIAG"].offset, 0xAB)
    val = await _read_reg(dut, regmap["DIAG"].offset)
    assert val == 0, f"DIAG: expected 0 (write-only), got 0x{val:08X}"

    await _settle(dut)
    val = await _read_reg(dut, regmap["WO_MIRROR"].offset)
    assert val == 0xAB, f"WO_MIRROR: expected 0xAB (echo of DIAG), got 0x{val:08X}"


# ---------------------------------------------------------------------------
# LINK -- mixed register: RO live SPEED + change-of-state W1C SPEED_CHANGED
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_link_change_of_state(dut):
    await _reset_dut(dut)

    # No spurious event at reset: SPEED_CHANGED must be 0 even though the
    # shadow register and the live value both start at 0 (a match, not a
    # change).
    val = await _read_reg(dut, regmap["LINK"].offset)
    assert val == 0, f"LINK: expected 0 at reset (no spurious CoS event), got 0x{val:08X}"

    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(LINK_SPEED=5))
    await _settle(dut)
    val = await _read_reg(dut, regmap["LINK"].offset)
    speed = val & 0xF
    changed = (val >> 8) & 0x1
    assert speed == 5, f"LINK.SPEED: expected 5, got {speed}"
    assert changed == 1, f"LINK.SPEED_CHANGED: expected set after a change, got {changed}"

    # W1C clear.
    await _write_reg(dut, regmap["LINK"].offset, 0x1 << 8)
    await _settle(dut)
    val = await _read_reg(dut, regmap["LINK"].offset)
    assert (val >> 8) & 0x1 == 0, f"LINK.SPEED_CHANGED: expected cleared, got 0x{val:08X}"
    assert val & 0xF == 5, f"LINK.SPEED: expected unchanged 5, got {val & 0xF}"

    # Re-writing the SAME speed must not raise a new event.
    await _write_reg(dut, regmap["STIMULUS"].offset, _stim(LINK_SPEED=5))
    await _settle(dut)
    val = await _read_reg(dut, regmap["LINK"].offset)
    assert (val >> 8) & 0x1 == 0, (
        f"LINK.SPEED_CHANGED: expected no event on an unchanged value, got 0x{val:08X}"
    )


# ---------------------------------------------------------------------------
# CONTROL -- RW with an enumerated field and a non-zero reset value
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_control_enum_and_nonzero_reset(dut):
    await _reset_dut(dut)
    val = await _read_reg(dut, regmap["CONTROL"].offset)
    assert val == 1, f"CONTROL.MODE: expected reset value 1 (READY), got {val}"

    await _write_reg(dut, regmap["CONTROL"].offset, 3)
    val = await _read_reg(dut, regmap["CONTROL"].offset)
    assert val == 3, f"CONTROL.MODE: expected 3 (FAULT), got {val}"


# ---------------------------------------------------------------------------
# CHANNEL array -- addressing + no-aliasing
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_channel_array_no_aliasing(dut):
    await _reset_dut(dut)

    config_0 = regmap["CHANNEL_0_CONFIG"].offset
    config_1 = regmap["CHANNEL_1_CONFIG"].offset
    count_0 = regmap["CHANNEL_0_COUNT"].offset
    count_1 = regmap["CHANNEL_1_COUNT"].offset

    # Distinct RO constants per index -- proves the read side isn't aliased.
    val0 = await _read_reg(dut, count_0)
    val1 = await _read_reg(dut, count_1)
    assert val0 == 0x11, f"CHANNEL[0].COUNT: expected 0x11, got 0x{val0:08X}"
    assert val1 == 0x22, f"CHANNEL[1].COUNT: expected 0x22, got 0x{val1:08X}"
    assert val0 != val1, "CHANNEL[0].COUNT and CHANNEL[1].COUNT must not alias"

    # Independent RW storage per index.
    await _write_reg(dut, config_0, 0x55)
    await _write_reg(dut, config_1, 0xAA)
    r0 = await _read_reg(dut, config_0)
    r1 = await _read_reg(dut, config_1)
    assert r0 == 0x55, f"CHANNEL[0].CONFIG: expected 0x55, got 0x{r0:08X}"
    assert r1 == 0xAA, f"CHANNEL[1].CONFIG: expected 0xAA (not aliased to element 0), got 0x{r1:08X}"

    # An untouched element (re-check element 1 unaffected by element 0's later write).
    await _write_reg(dut, config_0, 0x00)
    r0 = await _read_reg(dut, config_0)
    r1 = await _read_reg(dut, config_1)
    assert r0 == 0x00, f"CHANNEL[0].CONFIG: expected 0x00, got 0x{r0:08X}"
    assert r1 == 0xAA, f"CHANNEL[1].CONFIG: expected untouched 0xAA, got 0x{r1:08X}"
