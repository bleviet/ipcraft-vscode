## Clocks, resets, and ports

Every element you add in the left navigation panels shows up on the canvas immediately.

### Clocks

Open the **Clocks** section. Each clock entry has:

- **Name** — the HDL port name (e.g. `clk`, `axi_clk`)
- **Frequency** — optional hint used for timing-aware vendor packaging (e.g. `100MHz`)
- **Associated reset** — links the clock to its reset for synchronous reset generation

### Resets

Open the **Resets** section. Key fields:

- **Polarity** — `activeLow` (the default, `rst_n`) or `activeHigh` (`rst`)
- **Associated clock** — which clock domain this reset belongs to

### Ports

Open the **Ports** section for scalar signals. Each port has a name, direction (`in` / `out` / `inout`), and width.

```
Example ports:
  o_data_valid    out  1
  o_data          out  32
  i_threshold     in   16
```

### Parameters

Use the **Parameters** section to expose generics (VHDL) or parameters (SV) that can be set at integration time — useful for data width, FIFO depth, etc.

> **Tip:** The canvas colours each clock domain differently. With two clocks, all ports associated with `clk_a` appear in one colour and `clk_b` ports in another — making clock-domain crossings visible at a glance.
