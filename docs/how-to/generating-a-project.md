# Generating a Project

How to scaffold a complete RTL project from an IP Core specification.

## Prerequisites

- An IP Core file (`.ip.yml`) with at least one bus interface that has a `memoryMapRef`
- A corresponding memory map file (`.mm.yml`) with registers defined

## From the IP Core Editor

1. Open your `.ip.yml` file in the IP Core visual editor
2. Click **Generator** in the navigation sidebar
3. Configure the generation options:

| Option | Description |
|--------|-------------|
| **Vendor** | Which vendor integration files to generate (`None`, `Altera`, `AMD`, `Both`) |
| **Include VHDL** | Generate RTL source files (package, top, core, bus wrapper, register file) |
| **Include Registers** | Generate the register file with decode logic |
| **Include Testbench** | Generate cocotb Python test and GHDL Makefile |

4. Click **Generate Files**
5. Select the output directory (defaults to `generated/` next to the spec file)

## From the Command Palette

1. Open your `.ip.yml` file in any editor
2. Open the command palette (`Ctrl+Shift+P`)
3. Type `IPCraft: Generate VHDL`
4. Select the output directory

## Generated Output

The scaffolder produces a structured project:

```text
<ip_name>/
  rtl/
    <ip_name>_pkg.vhd        # Package with register constants and types
    <ip_name>.vhd             # Top-level entity (instantiates core + bus)
    <ip_name>_core.vhd        # User logic skeleton (edit this)
    <ip_name>_<bus>.vhd       # Bus wrapper (axil or avmm)
    <ip_name>_regs.vhd        # Register file with field decode
  altera/
    <ip_name>_hw.tcl          # Platform Designer component
  amd/
    component.xml             # Vivado IP-XACT descriptor
    xgui/<ip_name>_v*.tcl     # Vivado GUI customization
  tb/
    <ip_name>_test.py         # cocotb test skeleton
    Makefile                  # GHDL simulation Makefile
```

## Bus Type Detection

The generator automatically selects the bus wrapper template based on your bus interface type:

| Bus Type in Spec | Generated Wrapper |
|------------------|-------------------|
| `AXI4L`, `axi4lite`, `axi*` | AXI-Lite (`bus_axil.vhdl.j2`) |
| `Avalon-MM`, `avmm`, `avalon*` | Avalon-MM (`bus_avmm.vhdl.j2`) |

If no bus interface with a memory map reference is found, the generator defaults to AXI-Lite.

## After Generation

1. The IP Core's `fileSets` section is automatically updated with the generated file paths
2. Edit `<ip_name>_core.vhd` to add your custom logic
3. Use the generated testbench as a starting point for verification
4. Import the vendor files into Quartus Platform Designer or Vivado IP Packager

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Generator produces empty files | Verify the IP Core has a bus interface with a `memoryMapRef` pointing to an existing memory map |
| Missing register file | Ensure `Include Registers` is enabled and the memory map has at least one register |
| Wrong bus type | Check the `type` field of your bus interface in the IP Core spec |
