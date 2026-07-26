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

| `_hw.tcl` interface type | Imported IPCraft interface |
|--------------------------|----------------------------|
| `axi4lite` | AXI4-Lite |
| `axi4` | AXI4-Full |
| `axi4stream` / `axis` | AXI-Stream |
| `avalon` | Avalon-MM |
| `avalon_streaming` / `avalonst` | Avalon-ST |

The `_hw.tcl` importer recognises the bus types above, plus dedicated clock,
reset, conduit, and interrupt interfaces. Other interface types are not
imported as bus interfaces, so compare the result with the original before
continuing.

IPCraft can hold both Avalon-MM and AXI interfaces in the same `.ip.yml`, but
target selection controls which complete packaging descriptors are generated;
it does not filter individual interfaces. If a vendor descriptor must expose
only a subset, maintain separate specs or adjust the staged descriptor.
