#!/usr/bin/env python3
"""Verify AXI4-Lite and busless interrupt metadata after Qsys generation."""

import argparse
import pathlib
import sys
import xml.etree.ElementTree as ET


def _parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sopcinfo", required=True, type=pathlib.Path)
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
            return parameter.findtext("./value") or ""
    raise AssertionError(
        "interface '{}' has no parameter named '{}'".format(interface.get("name"), name)
    )


def main():
    args = _parse_args()
    root = ET.parse(str(args.sopcinfo)).getroot()
    regmap = _module(root, "regmap_axil")

    associated = _interface(regmap, "irq_associated")
    assert _parameter(associated, "associatedAddressablePoint") == "regmap_axil.S_AXI_LITE"
    assert _parameter(associated, "associatedClock") == "clk"

    busless = _interface(regmap, "irq_no_bus")
    assert _parameter(busless, "associatedAddressablePoint") == ""
    assert _parameter(busless, "associatedClock") == "clk"

    print("IRQ metadata PASS: associated=S_AXI_LITE, busless=empty")
    return 0


if __name__ == "__main__":
    sys.exit(main())
