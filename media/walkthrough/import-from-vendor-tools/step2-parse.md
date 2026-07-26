## Converting to an editable .ip.yml

The parse commands normalise supported parts of a vendor descriptor into an
`.ip.yml`. Review the result before generating for Vivado, Quartus, or both,
because vendor-specific conditions and unsupported interface types do not
transfer automatically.

### Parse Platform Designer _hw.tcl

Run **IPCraft: Import from Altera Platform Designer (Experimental)** with a `*_hw.tcl` file open.

**What the parser handles:**

- `set_module_property` — name, version, display name, description
- `add_interface` — bus interface type and direction
- `add_interface_port` — port-to-interface mapping (physical prefix auto-detected)
- `add_parameter` — generics/parameters with types and defaults
- `source other_file.tcl` — recursive following of sourced files

**Known limitation:** The parser reads supported commands into a new YAML
document. TCL comments, conditional execution such as `SYNTHESIS`, and
simulation-only intent are not represented in `.ip.yml`; review those parts
manually before conversion.

### Parse Xilinx component.xml

Run **IPCraft: Import from Xilinx Component XML (Experimental)** with a `component.xml` file open.

**What the parser handles:**

- The IP-XACT 1685-2009 namespace
- `<busInterface>` elements — maps to IPCraft bus interface definitions
- `<model><ports>` — all port declarations with directions and widths
- `<parameters>` — parameter names, types, and defaults
- `<fileSet>` references — file set paths are preserved

Known AXI interfaces are normalised to IPCraft's built-in bus definitions.
Other IP-XACT bus VLNVs and their raw port maps are preserved without requiring
a Vivado catalog scan. Review an unknown interface in the Inspector before
re-exporting it.
