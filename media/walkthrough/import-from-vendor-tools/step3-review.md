## Verifying the imported spec

After parsing, check three areas before generating output for the other vendor.

### 1. Bus interface port maps

Click each bus interface on the canvas and check its fields in the Inspector:

- **physicalPrefix** — the HDL signal prefix (e.g. `s_axi_`, `avmm_`). IPCraft auto-detects this from the port mapping, but verify it matches your RTL exactly.
- **Port count** — expand the bus bundle on the canvas to see individual signals. Compare against the source file.
- **Interface mode** — slave vs. master.

### 2. Parameters

Click each parameter on the canvas and check in the Inspector:

- Data types (`int`, `string`, `boolean`, `std_logic_vector`)
- Default values — especially for parameters that control port widths
- Range constraints (used by Vivado IP Packager to validate instantiation)

### 3. Cross-vendor bus type mapping

Some bus types do not have a 1:1 equivalent across vendors:

| Quartus (hw.tcl) | Vivado (component.xml) | Notes |
|-----------------|----------------------|-------|
| `avalon_slave` | No direct equivalent | Map manually to `axi4_lite_slave` if converting |
| `altera_axi4` | `axi4` | Compatible |
| `clock` | `clock` | Direct |
| `reset` | `reset` | Direct |

If your design uses Avalon-MM and you are targeting Vivado, you will need to either keep Avalon interfaces for Quartus and add separate AXI interfaces for Vivado, or replace Avalon with AXI across both.

> **Tip:** IPCraft can hold both Avalon-MM and AXI interfaces in the same `.ip.yml`. Use the `targets` field to control which packaging files each interface appears in.
