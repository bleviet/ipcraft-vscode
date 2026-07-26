## Inside the generated register file

Open `rtl/my_core_regs.vhd` (or `*_regs.sv`) to see the auto-generated register logic. Understanding this file helps you debug register behaviour and write targeted tests.

### Constants package

```vhdl
-- my_core_pkg.vhd
constant C_REG_CTRL_ADDR      : natural := 0;   -- addr 0x00
constant C_REG_STATUS_ADDR    : natural := 4;   -- addr 0x04
constant C_REG_THRESHOLD_ADDR : natural := 8;   -- addr 0x08
```

Import this package in your test infrastructure to avoid hard-coded offsets.

### Decoder structure

The register file implements:

1. **Write path** — bus-neutral `wr_en`, `wr_addr`, `wr_data`, and `wr_strb` inputs update register shadows
2. **Read path** — `rd_en` and `rd_addr` select register content for `rd_data` / `rd_valid`
3. **Hardware override** — read-only fields ignore software writes and reflect hardware inputs
4. **write-1-to-clear fields** — cleared by the combination of a software write-1 and the hardware not asserting the flag

Protocol-specific handshaking (`wvalid` / `wready`, `arvalid` / `arready`, or
the Avalon-MM equivalents) lives in the generated bus wrapper, which converts
transactions into this neutral register-file interface.

### Synthesisability

The generated register file is fully synthesisable with no black boxes. It targets both Vivado and Quartus without vendor-specific pragmas.

> **Tip:** The register file is a managed file — it is regenerated every scaffold run. Do not edit it directly. Put custom logic in a core file only after protecting that file with `managed: false`, or select a scaffold pack that already protects it.
