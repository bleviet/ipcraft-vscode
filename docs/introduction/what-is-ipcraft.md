# What IPCraft Does

IPCraft is a VS Code extension for FPGA IP cores. It keeps the description of a
core in two readable YAML files and builds everything else from them: HDL,
register logic, testbenches, documentation, and the packaging and projects that
Vivado and Quartus expect. Around that core it adds a viewer for whole systems
and a tool for decoding data captured from hardware.

This page explains the idea from the inside out. Each section links to the
guide that covers it in detail.

![IPCraft capability map: designs are read into the IP core specification (.ip.yml and .mm.yml), which generates RTL, testbenches, documentation, and Altera and AMD packaging and projects; the System Viewer, Data Inspector, builds, and the command line work in the same workspace](../images/diagrams/introduction-capabilities.drawio.svg)

## 1. The core: one specification

An IP core in IPCraft is two files:

| File | Describes |
|---|---|
| `<name>.ip.yml` | Identity (vendor, library, name, version), clocks, resets, ports, bus interfaces, parameters, and the files that belong to the core |
| `<name>.mm.yml` | The memory map: address blocks, registers, register arrays, and bit fields with their access behavior |

Both files are plain YAML that you can review in a pull request. You edit them
in visual editors: a block-diagram canvas for the IP core and tables with a bit
layout for the memory map. Every visual edit is written back to the YAML and
keeps your comments and number formats, such as hexadecimal addresses.

Read more:

- [Creating your first IP core](../how-to/create-your-first-ip-core.md)
- [Memory-mapped registers](../tutorials/memory-mapped-registers.md)
- [IP Core editor](../reference/ip-core-editor.md)

## 2. Formats: in and out of the specification

From the specification, IPCraft generates:

| Output | Contents |
|---|---|
| RTL | VHDL or SystemVerilog: package, top level, user-logic core, bus wrapper (AXI4-Lite or Avalon-MM), register file |
| Testbench | cocotb tests driven by a register model |
| Documentation | A Markdown datasheet of the core and its registers |
| Altera packaging | The Platform Designer component `<name>_hw.tcl` |
| AMD packaging | The Vivado IP-XACT `component.xml` with its XGUI files |

Writing `_hw.tcl` or `component.xml` by hand takes long and the two drift apart.
IPCraft writes both from the same specification, so a core is ready for either
vendor.

The way in works too. IPCraft can create the specification from an existing
VHDL entity, a Platform Designer `_hw.tcl`, or a Vivado `component.xml`. Porting
a core between Altera and AMD then means importing the packaging of one vendor,
reviewing the result in the editor, and generating the packaging of the other.
The importers are marked experimental: always review what they produce.

Read more:

- [Importing an existing design](../how-to/importing-an-existing-design.md)
- [Generating a project](../how-to/generating-a-project.md)
- [Custom interfaces](../how-to/defining-a-custom-interface.md)

## 3. Projects and tests

The same generation run can add Quartus and Vivado project scripts and the
cocotb test environment. All generated files are shown in a review before
anything is written. Files you edited by hand are detected and merged when the
merge is clean; IPCraft never overwrites them silently.

You stay in the workspace where you edit and write code. From there you can
run a simulation, build the project in batch mode and read timing and
utilization results, open the core in Vivado, Quartus, IP Packager, or Platform
Designer, and check that the specification, the HDL, and the vendor files still
agree.

Read more:

- [Running a cocotb simulation](../how-to/run-cocotb-simulation.md)
- [Building a project](../how-to/building-a-project.md)
- [Checking consistency](../how-to/check-consistency.md)
- [Scaffold packs](../how-to/customizing-generated-files-with-scaffold-packs.md), to change what is generated

## 4. The system: how cores connect

The System Viewer opens a Vivado block design script or a Platform Designer
system as a read-only diagram. It reads the files as text, so it needs no
vendor tool or license. You can walk the hierarchy, isolate a few blocks, find
unconnected pins, and see clock and reset domains with their crossings.
Definitions from your `.ip.yml` and HDL files fill in the pins of the blocks.

Read more: [Viewing a system design](../how-to/view-a-system-design.md)

## 5. Debug: values from hardware

The Data Inspector decodes values against register definitions. Paste a
literal, or load a waveform or a CSV capture from Vivado ILA or SignalTap, and
read the fields. Operators such as concat, slice, shift, and byte swap combine
values on a canvas, and the setup can be saved and shared.

Read more: [Using the Data Inspector](../how-to/use-data-inspector.md)

## The command line

The `ipcraft` command runs the same engine without the editor. It generates
and verifies projects, packages a core with everything it references, upgrades
older files, and renders diagrams for documentation. A continuous-integration
job therefore produces the same files as the editor.

Read more: [Command line](../reference/command-line.md)

## Where to start

| You want to | Start with |
|---|---|
| Design a new core | [Install and first steps](install.md), then [Creating your first IP core](../how-to/create-your-first-ip-core.md) |
| Bring an existing core into IPCraft | [Importing an existing design](../how-to/importing-an-existing-design.md) |
| Port a core between Altera and AMD | [Importing an existing design](../how-to/importing-an-existing-design.md), then [Generating a project](../how-to/generating-a-project.md) |
| Understand a block design | [Viewing a system design](../how-to/view-a-system-design.md) |
| Decode captured register values | [Using the Data Inspector](../how-to/use-data-inspector.md) |
| Generate in CI | [Command line](../reference/command-line.md) |
| Contribute to IPCraft | [Development setup](../getting-started/development.md) |
