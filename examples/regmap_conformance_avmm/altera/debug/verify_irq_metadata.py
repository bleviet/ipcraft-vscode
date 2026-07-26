#!/usr/bin/env python3
"""Verify explicit and busless interrupt metadata after Platform Designer generation."""

import argparse
import pathlib
import re
import sys
import xml.etree.ElementTree as ET


def _parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sopcinfo", required=True, type=pathlib.Path)
    parser.add_argument("--system-header", required=True, type=pathlib.Path)
    return parser.parse_args()


def _module(root, name):
    for module in root.findall("./module"):
        if module.get("name") == name:
            return module
    raise AssertionError("SOPCINFO has no module named '{}'".format(name))


def _interface(module, name):
    for interface in module.findall("./interface"):
        if interface.get("name") == name:
            return interface
    raise AssertionError(
        "module '{}' has no interface named '{}'".format(module.get("name"), name)
    )


def _parameter(interface, name):
    for parameter in interface.findall("./parameter"):
        if parameter.get("name") == name:
            value = parameter.findtext("./value")
            return value or ""
    raise AssertionError(
        "interface '{}' has no parameter named '{}'".format(interface.get("name"), name)
    )


def _interrupt_number(receiver, module_name, interface_name):
    expected_name = "{}.{}".format(module_name, interface_name)
    for interrupt in receiver.findall("./interrupt"):
        if interrupt.findtext("./name") == expected_name:
            return int(interrupt.findtext("./interruptNumber"))
    raise AssertionError("CPU interrupt receiver has no source '{}'".format(expected_name))


def _macro(header, name):
    match = re.search(
        r"^#define[ \t]+{}[ \t]+(-?[0-9]+)[ \t]*$".format(re.escape(name)),
        header,
        re.MULTILINE,
    )
    if not match:
        raise AssertionError("system.h has no numeric macro '{}'".format(name))
    return int(match.group(1))


def main():
    args = _parse_args()
    root = ET.parse(str(args.sopcinfo)).getroot()

    associated = _interface(_module(root, "regmap_ctrl"), "irq_associated")
    assert _parameter(associated, "associatedAddressablePoint") == "regmap_ctrl.S_AVMM"
    assert _parameter(associated, "associatedClock") == "clk"

    busless = _interface(_module(root, "regmap_ctrl"), "irq_no_bus")
    assert _parameter(busless, "associatedAddressablePoint") == ""
    assert _parameter(busless, "associatedClock") == "clk"

    cpu_irq = _interface(_module(root, "nios2"), "irq")
    assert _interrupt_number(cpu_irq, "regmap_ctrl", "irq_associated") == 1
    assert _interrupt_number(cpu_irq, "regmap_ctrl", "irq_no_bus") == 2

    header = args.system_header.read_text(encoding="utf-8")
    assert _macro(header, "REGMAP_CTRL_IRQ") == 1

    print("IRQ metadata PASS: associated=S_AVMM/IRQ1, busless=empty/IRQ2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
