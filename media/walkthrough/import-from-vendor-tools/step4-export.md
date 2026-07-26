## Generating for the other platform

Once your `.ip.yml` is correct, generating a cross-vendor descriptor is a single command.

### Xilinx → Intel: generate _hw.tcl

Start with a `component.xml`, parsed to `.ip.yml`. Now run **IPCraft: Generate Altera Platform Designer Component (_hw.tcl)**.

The output `*_hw.tcl` includes:
- `set_module_property` statements derived from VLNV
- `add_interface` for every bus interface (`axi4lite`, `axi4`, and
  `axi4stream` for supported AXI variants; unsupported types fall back to
  `conduit`)
- `add_interface_port` with port maps from physicalPrefix
- `add_parameter` with Quartus-compatible type annotations

### Intel → Xilinx: generate component.xml

Start with a `_hw.tcl`, parsed to `.ip.yml`. Now run **IPCraft: Generate Xilinx Vivado Component (component.xml)**.

The output `component.xml` follows IP-XACT 1685-2009 and includes:
- `<spirit:component>` with VLNV identification
- `<busInterface>` elements from your canvas
- Full `<model><ports>` section
- `<parameters>` with Vivado-compatible display names and ranges

### Generating both at once

Enable both the **XILINX** and **ALTERA** target pills in the IP-core editor
toolbar, then run **IPCraft: Scaffold Project**. Both descriptors are staged
together for review and accepted in one operation.

The Scaffold command currently reads `ipcraft.toolbar.targets`; changing only
the root `.ip.yml` `targets` field or `ipcraft.generate.targets` does not change
this selection.

### What does not transfer automatically

- **Validation TCL** — Vivado GUI customisation scripts (`xgui/*.tcl`) have no Quartus equivalent
- **Avalon-MM ↔ AXI** — protocol is different; you may need different RTL for each vendor
- **Vendor-specific IP references** — subcores that reference Vivado primitives or Altera IP will not resolve on the other platform
