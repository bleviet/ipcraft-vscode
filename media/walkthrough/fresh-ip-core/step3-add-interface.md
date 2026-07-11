## Adding a bus interface

A bus interface groups related signals (address, data, handshake) into a single named connector. IPCraft knows the signal maps for all common bus standards, so you describe _what_ the interface is — not _every wire_.

### How to add one

1. Open the Library Palette (left sidebar of the canvas) — bus types are grouped under **Protocols**
2. Find the bus type you need (e.g. AXI4-Lite Slave), or use the search box to filter
3. Drag it onto the right edge of the canvas block
4. Click the new bus interface to select it, then edit its fields in the Inspector panel on the right

### Which bus type should I use?

| You want… | Use |
|-----------|-----|
| Register access (control/status) | AXI4-Lite Slave or Avalon-MM Slave |
| Burst DMA from the core | AXI4 Master |
| Simple memory-mapped I/O | APB Slave |
| Custom/proprietary bus | Define a bus library YAML |

> **Tip:** The `physicalPrefix` field in the Inspector sets the HDL signal prefix, e.g. `s_axi_` → `s_axi_awaddr`, `s_axi_awvalid`, etc.
