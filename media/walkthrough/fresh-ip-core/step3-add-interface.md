## Adding a bus interface

A bus interface groups related signals (address, data, handshake) into a single named connector. IPCraft knows the signal maps for all common bus standards, so you describe _what_ the interface is — not _every wire_.

### How to add one

**Method 1 — Drag from the Library Palette**

1. Open the Library Palette (left sidebar of the canvas)
2. Find the bus type you need (e.g. AXI4-Lite Slave)
3. Drag it onto the right edge of the canvas block

**Method 2 — Bus Interfaces tab**

1. Click **Bus Interfaces** in the left navigation
2. Click the **+** button
3. Select the bus type from the dropdown

### Which bus type should I use?

| You want… | Use |
|-----------|-----|
| Register access (control/status) | AXI4-Lite Slave or Avalon-MM Slave |
| Burst DMA from the core | AXI4 Master |
| Simple memory-mapped I/O | APB Slave |
| Custom/proprietary bus | Define a bus library YAML |

> **Tip:** The `physicalPrefix` field in the Bus Interfaces tab sets the HDL signal prefix, e.g. `s_axi_` → `s_axi_awaddr`, `s_axi_awvalid`, etc.
