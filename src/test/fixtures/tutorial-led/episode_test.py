"""Episode behaviour of the LED tutorial checkpoints (06-10), driven over Avalon-MM.

Run by src/test/integration/tutorialCheckpoints.test.ts against the generated
RTL and the committed core. Environment:
  ADDR_SHIFT  bits to shift a byte offset right to get the avs_address value
              (the bus wrapper pads the word address with this many zero bits)
  HAS_EVENTS  "1" from checkpoint 08 on (EVENTS register and heartbeat present)
"""
import os
import cocotb
from cocotb.clock import Clock
from cocotb.handle import Force, Release
from cocotb.triggers import RisingEdge, Timer

SHIFT = int(os.environ["ADDR_SHIFT"])
HAS_EVENTS = os.environ["HAS_EVENTS"] == "1"


async def write(dut, byte, val):
    dut.avs_address.value = byte >> SHIFT
    dut.avs_writedata.value = val
    dut.avs_byteenable.value = 0xF
    dut.avs_write.value = 1
    await RisingEdge(dut.clk)
    dut.avs_write.value = 0


async def read(dut, byte):
    dut.avs_address.value = byte >> SHIFT
    dut.avs_read.value = 1
    await RisingEdge(dut.clk)
    dut.avs_read.value = 0
    await RisingEdge(dut.clk)
    return int(dut.avs_readdata.value)


async def force_counter(dut, v):
    dut.u_core.heartbeat_counter.set(Force(v))
    await RisingEdge(dut.clk)
    dut.u_core.heartbeat_counter.set(Release())


async def setup(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.avs_read.value = 0
    dut.avs_write.value = 0
    dut.reset.value = 1
    await Timer(100, unit="ns")
    dut.reset.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)


@cocotb.test()
async def test_version(dut):
    await setup(dut)
    v = await read(dut, 0)
    assert v == 0x100, hex(v)


@cocotb.test()
async def test_led_pattern_drives_led(dut):
    await setup(dut)
    for pat in (0xA5, 0x5A, 0xFF, 0x00, 0x01):
        await write(dut, 4, pat)
        rb = await read(dut, 4)
        assert rb == pat, f"readback {rb:#x} != {pat:#x}"
        assert int(dut.led.value) == pat, f"led {int(dut.led.value):#x} != {pat:#x}"


@cocotb.test(skip=not HAS_EVENTS)
async def test_heartbeat(dut):
    await setup(dut)
    ev = await read(dut, 8)
    assert ev == 0, f"after reset EVENTS={ev:#x}"
    await force_counter(dut, (1 << 24) - 2)
    for _ in range(8):
        await RisingEdge(dut.clk)
    ev = await read(dut, 8)
    assert ev == 0b11, f"after rising toggle expected ACTIVE=1 TOGGLED=1, got {ev:#x}"
    await write(dut, 8, 0b10)
    ev = await read(dut, 8)
    assert ev == 0b01, f"after W1C expected ACTIVE=1 TOGGLED=0, got {ev:#x}"
    await write(dut, 8, 0b01)         # W1C on read-only ACTIVE must do nothing
    ev = await read(dut, 8)
    assert ev == 0b01, f"W1C on ACTIVE changed it: {ev:#x}"
    await force_counter(dut, (1 << 25) - 2)
    for _ in range(8):
        await RisingEdge(dut.clk)
    ev = await read(dut, 8)
    assert ev == 0b10, f"after falling toggle expected ACTIVE=0 TOGGLED=1, got {ev:#x}"
    await write(dut, 8, 0b10)
    ev = await read(dut, 8)
    assert ev == 0, f"after W1C expected 0, got {ev:#x}"
