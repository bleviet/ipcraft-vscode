## Two files, one spec

A register-mapped IP core in IPCraft uses two linked files:

| File | Purpose |
|------|---------|
| `my_core.ip.yml` | IP core definition — clocks, resets, ports, bus interfaces, metadata |
| `my_core.mm.yml` | Memory map — address blocks, registers, and bit fields |

The **New IP Core + Register Map** command creates both files and imports the
memory-map file from the IP-core specification:

```yaml
# my_core.ip.yml (excerpt)
memoryMaps:
  import: my_core.mm.yml   # ← IPCraft links these at generation time
```

The command opens `my_core.ip.yml`. Open `my_core.mm.yml` separately when you
are ready to edit its registers.

### Attach the map to a slave interface

The file import alone does not create a bus interface. Before scaffolding:

1. Drag an AXI4-Lite, AXI4-Full, or Avalon-MM interface onto the **left** half
   of the canvas so its mode is `slave`.
2. Select the interface and set `memoryMapRef` in the Inspector to the map name
   declared inside `my_core.mm.yml` (the generated default is
   `MY_CORE_MEMMAP`).
3. Confirm the clock, reset, physical prefix, and data/address widths.

Once that slave is attached, the `builtin-ipcraft` scaffold pack can generate
the matching bus wrapper and register decoder. You describe the bus as one
canvas interface; IPCraft expands its individual HDL signals from the bus
definition.

> **Tip:** You can import multiple `.mm.yml` files or define maps inline. Each memory-mapped slave selects its map by name through `memoryMapRef`.
