#!/usr/bin/env python3
"""Verify both Nios II pending interrupt inputs through JTAG register readback."""

import argparse
import pathlib
import sys
import time


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from hardware_runner import SystemConsoleTransport


IRQ_RESULT_PREFIX = 0x49525100
IRQ_BOTH_SEEN = 0x03
SCRATCH_OFFSET = 0x04


def _parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-address", type=lambda value: int(value, 0), default=0x10000)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--system-console", default="system-console")
    return parser.parse_args()


def main():
    args = _parse_args()
    transport = SystemConsoleTransport(
        args.system_console,
        args.base_address,
        args.timeout,
    )
    transport.connect()

    deadline = time.monotonic() + args.timeout
    value = 0
    while time.monotonic() < deadline:
        value = transport._read(SCRATCH_OFFSET)
        if value & 0xFFFFFF00 == IRQ_RESULT_PREFIX:
            break
        time.sleep(0.05)

    expected = IRQ_RESULT_PREFIX | IRQ_BOTH_SEEN
    if value != expected:
        raise AssertionError(
            "IRQ runtime result 0x{:08X}, expected 0x{:08X}".format(
                value,
                expected,
            )
        )

    print("IRQ hardware PASS: associated=IRQ1, busless=IRQ2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
