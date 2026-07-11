## Two files, one spec

A register-mapped IP core in IPCraft uses two linked files:

| File | Purpose |
|------|---------|
| `my_core.ip.yml` | IP core definition — clocks, resets, ports, bus interfaces, metadata |
| `my_core.mm.yml` | Memory map — address blocks, registers, and bit fields |

The **New IP Core + Register Map** command creates both and wires them together automatically:

```yaml
# my_core.ip.yml (excerpt)
memoryMaps:
  import: my_core.mm.yml   # ← IPCraft links these at generation time
```

### What IPCraft does with the link

When you scaffold, IPCraft reads the memory map, derives the required bus slave interface (AXI-Lite by default), adds it to your IP core automatically, and generates the register file decoder and bus wrapper to match.

You do not need to manually describe the AXI signals in the canvas — the memory map drives them.

> **Tip:** You can link multiple `.mm.yml` files or inline register definitions directly in `.ip.yml` — select the memory-mapped bus interface on the canvas and set its memory map link (`memoryMapRef`) in the Inspector.
