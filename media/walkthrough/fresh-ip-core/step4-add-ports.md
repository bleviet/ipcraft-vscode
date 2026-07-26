## Clocks, resets, and ports

Drag each element from the Library Palette's **Infrastructure** category onto the canvas. Clocks, resets, and input ports belong on the left; output ports belong on the right; bidirectional ports appear on the bottom. Click any placed element to edit its fields in the Inspector panel.

### Clocks

Each clock entry has:

- **Name** — the HDL port name (e.g. `clk`, `axi_clk`)
- **Frequency** — optional value used to generate project timing constraints such as Vivado XDC and Quartus SDC (e.g. `100MHz`)
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

Under **Generics**, drag an **Integer Generic**, **Boolean Generic**, or **String Generic** onto the canvas. It becomes a VHDL generic or SystemVerilog parameter that can be set at integration time — useful for data width, FIFO depth, and similar configuration.

> **Tip:** The canvas colours each clock domain differently. With two clocks, all ports associated with `clk_a` appear in one colour and `clk_b` ports in another — making clock-domain crossings visible at a glance.
