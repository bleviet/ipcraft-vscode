## Clocks, resets, and ports

Drag each element from the Library Palette's **Infrastructure** category onto the canvas — clocks and resets go on the left edge, ports on the right edge. Click any placed element to edit its fields in the Inspector panel.

### Clocks

Each clock entry has:

- **Name** — the HDL port name (e.g. `clk`, `axi_clk`)
- **Frequency** — optional hint used for timing-aware vendor packaging (e.g. `100MHz`)
- **Associated reset** — links the clock to its reset for synchronous reset generation

### Resets

Key fields:

- **Polarity** — `activeLow` (the default, `rst_n`) or `activeHigh` (`rst`)
- **Associated clock** — which clock domain this reset belongs to

### Ports

Scalar signals. Each port has a name, direction (`in` / `out` / `inout`), and width.

```
Example ports:
  o_data_valid    out  1
  o_data          out  32
  i_threshold     in   16
```

### Parameters

Drag a **Parameter** item onto the canvas to expose a generic (VHDL) or parameter (SV) that can be set at integration time — useful for data width, FIFO depth, etc. Pick the integer, boolean, or string variant from the palette.

> **Tip:** The canvas colours each clock domain differently. With two clocks, all ports associated with `clk_a` appear in one colour and `clk_b` ports in another — making clock-domain crossings visible at a glance.
