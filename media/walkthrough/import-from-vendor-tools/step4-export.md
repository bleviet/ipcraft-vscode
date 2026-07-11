## Generating for the other platform

Once your `.ip.yml` is correct, generating a cross-vendor descriptor is a single command.

### Xilinx → Intel: generate _hw.tcl

Start with a `component.xml`, parsed to `.ip.yml`. Now run **IPCraft: Generate Altera Platform Designer Component (_hw.tcl)**.

The output `*_hw.tcl` includes:
- `set_module_property` statements derived from VLNV
- `add_interface` for every bus interface (AXI interfaces mapped to `altera_axi4`)
- `add_interface_port` with port maps from physicalPrefix
- `add_parameter` with Quartus-compatible type annotations

### Intel → Xilinx: generate component.xml

Start with a `_hw.tcl`, parsed to `.ip.yml`. Now run **IPCraft: Generate Xilinx Vivado Component (component.xml)**.

The output `component.xml` follows IP-XACT 2014 and includes:
- `<spirit:component>` with VLNV identification
- `<busInterface>` elements from your canvas
- Full `<model><ports>` section
- `<parameters>` with Vivado-compatible display names and ranges

### Generating both at once

Set both targets in your `.ip.yml` and run **IPCraft: Scaffold Project**:

```yaml
targets: [vivado, quartus]
```

Both descriptors are staged together for review and accepted in one go.

### What does not transfer automatically

- **Validation TCL** — Vivado GUI customisation scripts (`xgui/*.tcl`) have no Quartus equivalent
- **Avalon-MM ↔ AXI** — protocol is different; you may need different RTL for each vendor
- **Vendor-specific IP references** — subcores that reference Vivado primitives or Altera IP will not resolve on the other platform
