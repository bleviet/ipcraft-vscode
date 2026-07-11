import os
import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer
from mm_loader import load_regmap


async def _write_reg(dut, addr: int, value: int) -> None:
    """Write a 32-bit register over Avalon-MM.

    NOTE: `addr` is the raw byte offset from the .mm.yml. avs_address is now a
    WORDS-addressed port (addressUnits WORDS in led_controller_avmm_hw.tcl) --
    Quartus/Platform Designer's Avalon-MM interconnect generator fails to
    build the translator between a BYTES custom slave and
    altera_nios2_gen2's data_master, confirmed empirically on real hardware
    bring-up. led_controller_avmm_regs.vhd still decodes wr_addr/rd_addr as
    byte offsets (matching C_REG_*_ADDR constants, e.g. EVENTS at 8);
    bus_avmm.vhdl.j2's wrapper reconstructs the byte address by zero-padding
    the word address's low 2 bits. This driver must do the inverse -- shift
    the byte offset down by 2 before writing avs_address -- matching what
    cocotb_test.py.j2 now generates.
    """
    dut.avs_address.value = addr >> 2
    dut.avs_writedata.value = value
    if hasattr(dut, "avs_byteenable"):
        dut.avs_byteenable.value = 0xF
    dut.avs_write.value = 1
    await RisingEdge(dut.clk)
    if hasattr(dut, "avs_waitrequest"):
        while dut.avs_waitrequest.value:
            await RisingEdge(dut.clk)
    dut.avs_write.value = 0


async def _read_reg(dut, addr: int) -> int:
    """Read a 32-bit register over Avalon-MM (see _write_reg for addr note)."""
    dut.avs_address.value = addr >> 2
    dut.avs_read.value = 1
    await RisingEdge(dut.clk)
    if hasattr(dut, "avs_waitrequest"):
        while dut.avs_waitrequest.value:
            await RisingEdge(dut.clk)
    dut.avs_read.value = 0
    if hasattr(dut, "avs_readdatavalid"):
        while not dut.avs_readdatavalid.value:
            await RisingEdge(dut.clk)
    else:
        # Fixed-latency slave (no readdatavalid): led_controller_avmm_regs.vhd's
        # read path is registered, so readdata is valid one cycle after `read`
        # is sampled, not in the same cycle it is deasserted.
        await RisingEdge(dut.clk)
    return int(dut.avs_readdata.value)


_MM_YML = os.path.join(os.path.dirname(__file__), "../led_controller_avmm.mm.yml")
regmap = load_regmap(_MM_YML)


async def _reset_dut(dut) -> None:
    """Apply and release reset for led_controller_avmm."""
    dut.reset.value = 1
    await Timer(100, unit="ns")
    dut.reset.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut._log.info("Reset complete")


@cocotb.test()
async def test_register_access(dut):
    """Smoke test: read/write every register and log the result."""
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await _reset_dut(dut)

    for reg in regmap:
        if "write" in reg.access:
            await _write_reg(dut, reg.offset, 0xA5A5A5A5)
            if "read" in reg.access:
                val = await _read_reg(dut, reg.offset)
                dut._log.info(f"{reg.name}: wrote 0xA5A5A5A5, read back 0x{val:08X}")
        elif "read" in reg.access:
            val = await _read_reg(dut, reg.offset)
            dut._log.info(f"{reg.name}: 0x{val:08X}")

    dut._log.info("Register access test passed!")


@cocotb.test()
async def test_version_register(dut):
    """VERSION reads back its fixed reset value (MAJOR=1, MINOR=0)."""
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await _reset_dut(dut)

    val = await _read_reg(dut, 0x00)
    assert val == 0x00000100, f"VERSION: expected 0x00000100, got 0x{val:08X}"


@cocotb.test()
async def test_led_pattern_passthrough(dut):
    """Writing LED_PATTERN drives both the register readback and the led port."""
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await _reset_dut(dut)

    await _write_reg(dut, 0x04, 0xA5)
    val = await _read_reg(dut, 0x04)
    assert val == 0xA5, f"LED_PATTERN: expected 0xA5, got 0x{val:08X}"

    await RisingEdge(dut.clk)
    led_val = int(dut.led.value)
    assert led_val == 0xA5, f"led port: expected 0xA5, got 0x{led_val:02X}"


@cocotb.test()
async def test_heartbeat_event_w1c(dut):
    """EVENTS.HEARTBEAT_TOGGLED sets on a heartbeat transition and clears on W1C.

    Fast-forwards the free-running heartbeat divider (u_core.heartbeat_counter,
    a 25-bit counter that takes 2**24 real cycles to flip its top bit) to just
    before rollover instead of simulating all 2**24 cycles.
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await _reset_dut(dut)

    dut.u_core.heartbeat_counter.value = (1 << 24) - 2
    for _ in range(10):
        await RisingEdge(dut.clk)

    events = await _read_reg(dut, 0x08)
    assert events & 0x2, f"EVENTS.HEARTBEAT_TOGGLED: expected set, got 0x{events:08X}"

    await _write_reg(dut, 0x08, 0x2)  # write-1-to-clear HEARTBEAT_TOGGLED
    events_after = await _read_reg(dut, 0x08)
    assert not (events_after & 0x2), (
        f"EVENTS.HEARTBEAT_TOGGLED: expected cleared after W1C, got 0x{events_after:08X}"
    )
