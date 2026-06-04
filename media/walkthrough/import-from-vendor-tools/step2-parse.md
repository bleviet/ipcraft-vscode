## Converting to a portable .ip.yml

The parse commands transform a vendor-specific descriptor into an `.ip.yml` that works with any toolchain — you can then generate for Vivado, Quartus, or both, from the same spec.

### Parse Platform Designer _hw.tcl

Run **IPCraft: Parse Platform Designer (_hw.tcl) to .ip.yml** with a `*_hw.tcl` file open.

**What the parser handles:**

- `set_module_property` — name, version, display name, description
- `add_interface` — bus interface type and direction
- `add_interface_port` — port-to-interface mapping (physical prefix auto-detected)
- `add_parameter` — generics/parameters with types and defaults
- `source other_file.tcl` — recursive following of sourced files

**Known limitation:** Synthesisability conditions (`SYNTHESIS`) and simulation-only ports are preserved as comments but may need manual review.

### Parse Xilinx component.xml

Run **IPCraft: Parse Xilinx component.xml to .ip.yml** with a `component.xml` file open.

**What the parser handles:**

- IP-XACT 2009 and 2014 schemas
- `<busInterface>` elements — maps to IPCraft bus interface definitions
- `<model><ports>` — all port declarations with directions and widths
- `<parameters>` — parameter names, types, and defaults
- `<fileSet>` references — file set paths are preserved

**Note:** Vivado bus definition resolution requires the Vivado IP catalog to be available. Run **IPCraft: Scan Vivado IP Catalog** first if bus types are not recognised.
