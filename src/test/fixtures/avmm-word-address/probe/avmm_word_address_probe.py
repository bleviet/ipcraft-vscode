"""Hand-written cocotb probe for the Avalon-MM wrapper address decode.

Independent of the generated testbench: it drives the Avalon address port
directly, converting each register byte offset with the shift in
PROBE_ADDR_SHIFT (log2 of bytes per word for a word-addressed port, 0 for a
byte-addressed port), so it checks the RTL wrapper on its own.
"""

import os

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

ADDR_SHIFT = int(os.environ["PROBE_ADDR_SHIFT"])
REG_COUNT = int(os.environ["PROBE_REG_COUNT"])
WORD_BYTES = int(os.environ["PROBE_WORD_BYTES"])

# Registers are one data word apart: byte offsets 0, 4, 8 for 32-bit data, 0, 8, 16 for 64-bit.
VERSION = 0 * WORD_BYTES
LED_PATTERN = 1 * WORD_BYTES
SCRATCH = 2 * WORD_BYTES


async def _reset(dut):
    dut.reset.value = 1
    dut.avs_read.value = 0
    dut.avs_write.value = 0
    dut.avs_address.value = 0
    dut.avs_writedata.value = 0
    dut.avs_byteenable.value = (1 << WORD_BYTES) - 1
    await Timer(100, unit="ns")
    dut.reset.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)


async def _write(dut, byte_offset, value):
    dut.avs_address.value = byte_offset >> ADDR_SHIFT
    dut.avs_writedata.value = value
    dut.avs_write.value = 1
    await RisingEdge(dut.clk)
    dut.avs_write.value = 0


async def _read(dut, byte_offset):
    dut.avs_address.value = byte_offset >> ADDR_SHIFT
    dut.avs_read.value = 1
    await RisingEdge(dut.clk)
    dut.avs_read.value = 0
    await RisingEdge(dut.clk)
    return int(dut.avs_readdata.value)


@cocotb.test()
async def test_registers_decode_at_their_byte_offsets(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await _reset(dut)

    assert await _read(dut, VERSION) == 0x0100

    await _write(dut, LED_PATTERN, 0x5A)
    assert await _read(dut, LED_PATTERN) == 0x5A, "LED_PATTERN (byte offset 4) did not decode"
    assert await _read(dut, VERSION) == 0x0100, "LED_PATTERN write aliased onto VERSION"

    if REG_COUNT > 2:
        await _write(dut, SCRATCH, 0xCAFEF00D)
        assert await _read(dut, SCRATCH) == 0xCAFEF00D, "SCRATCH (byte offset 8) did not decode"
        assert await _read(dut, LED_PATTERN) == 0x5A, "SCRATCH write aliased onto LED_PATTERN"
