# Install and First Steps

## Install

Install **IPCraft** from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=bahonavi.ipcraft-vscode),
or search for IPCraft in the Extensions view of VS Code. It needs VS Code 1.80
or later.

The visual editors, the System Viewer, and the Data Inspector need nothing
else. The other tools are optional and only needed for the tasks that use them:

| Tool | Needed for | Configure with |
|---|---|---|
| AMD Vivado | Building, opening projects in Vivado or the IP Packager, scanning the Vivado interface catalog | `ipcraft.vivado.installDirs`, or Docker through `ipcraft.vivado.runner` |
| Intel Quartus | Building, opening projects in Quartus or Platform Designer | `ipcraft.quartus.installDirs`, or Docker through `ipcraft.quartus.runner` |
| Python 3.10+, `cocotb`, `pytest` | Running the generated testbenches | See [Running a cocotb simulation](../how-to/run-cocotb-simulation.md) |
| GHDL, Icarus Verilog, Verilator, or Questa | Simulating generated HDL | `ipcraft.testbench.engine` |

See [Building a project](../how-to/building-a-project.md) for the tool
settings.

## The files IPCraft opens

| File | Opens in |
|---|---|
| `*.ip.yml` | IP Core editor |
| `*.mm.yml` | Memory Map editor |
| `*.ipci.yml` | Data Inspector |
| Vivado block design `.tcl`, Platform Designer `.qsys` or system `.tcl` | Text editor; press `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS) for the System Viewer |
| `_hw.tcl`, `component.xml`, VHDL, Verilog, and SystemVerilog files | Text editor; `Ctrl+Shift+V` shows a read-only IP core preview that you can save as an `.ip.yml` |

To see the YAML behind a visual editor, run **IPCraft: Open as Text Editor**.
**IPCraft: Open as Visual Editor** switches back.

## Take a guided walkthrough

Run **IPCraft: Open Walkthrough...** or open **Help > Get Started**. Each
walkthrough runs the real commands step by step:

| Walkthrough | You learn to |
|---|---|
| Design Your First IP Core | Create a core and add ports and a bus interface |
| IP Core with a Register Map | Add a memory map and link it to the bus |
| Bring Your VHDL into IPCraft | Import an existing entity |
| Import from Xilinx or Intel Tools | Import a `component.xml` or `_hw.tcl` |
| Synthesize and Check Timing | Generate a project and build it |
| Get Started with Scaffold Packs | Change what is generated |

## Your first core in five steps

1. Run **IPCraft: New IP Core + Register Map** and choose a name.
2. Add clocks, resets, ports, and a bus interface on the canvas.
3. Add registers and bit fields in the memory map.
4. Run **IPCraft: Scaffold Project (RTL + EDA packaging + Testbench)** and
   confirm the staged files.
5. Run the generated tests, or **IPCraft: Build** if Vivado or Quartus is
   configured.

[Creating your first IP core](../how-to/create-your-first-ip-core.md) walks
through these steps in detail.

## Workspace Trust

In a workspace you have not trusted, VS Code runs IPCraft in Restricted Mode.
Visual editing and read-only viewing still work. Generation, template
rendering, imports that call Git, builds, vendor scans, and tool launches need a
trusted workspace. See
[Workspace Trust and Restricted Mode](../reference/commands.md#workspace-trust-and-restricted-mode).

## The `ipcraft` command

The extension ships the `ipcraft` command line. It is on `PATH` in every VS Code
integrated terminal. For other terminals on the same machine, run
**IPCraft: Install 'ipcraft' Command in PATH**. See
[Command line](../reference/command-line.md).
