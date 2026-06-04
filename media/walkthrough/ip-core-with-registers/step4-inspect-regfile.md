## Inside the generated register file

Open `rtl/my_core_regfile.vhd` (or `*_regfile.sv`) to see the auto-generated register logic. Understanding this file helps you debug register behaviour and write targeted tests.

### Constants package

```vhdl
-- my_core_pkg.vhd
constant REG_CTRL_OFFSET    : natural := 16#00#;
constant REG_STATUS_OFFSET  : natural := 16#04#;
constant REG_THRESHOLD_OFFSET : natural := 16#08#;

-- Field masks and positions
constant CTRL_ENABLE_BIT    : natural := 0;
constant CTRL_MODE_LSB      : natural := 4;
constant CTRL_MODE_MSB      : natural := 5;
```

Import this package in your test infrastructure to avoid hard-coded offsets.

### Decoder structure

The register file implements:

1. **Write path** — AXI write data latched into register shadows on `wvalid & wready`
2. **Read path** — multiplexer selects register content by address on `arvalid & arready`
3. **Hardware override** — RO fields ignore software writes and reflect hardware inputs
4. **W1C fields** — cleared by the combination of a software write-1 and the hardware not asserting the flag

### Synthesisability

The generated register file is fully synthesisable with no black boxes. It targets both Vivado and Quartus without vendor-specific pragmas.

> **Tip:** The register file is a managed file — it is regenerated every scaffold run. Do not edit it directly. Put your logic in the `*_core.vhd` file instead.
