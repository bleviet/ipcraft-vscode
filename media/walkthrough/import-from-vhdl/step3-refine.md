## Refining the import

Auto-detection is a starting point. Use the canvas and section editors to fill in anything the parser could not infer.

### Adding a missing bus interface

1. Open the Library Palette (left side of canvas)
2. Find the correct bus type (e.g. AXI4-Lite Slave)
3. Drag it onto the right edge of the block
4. Set the `physicalPrefix` in the Inspector to match your HDL signals

### Setting clock frequencies

Clock frequency is used when generating vendor packaging (Vivado `component.xml` and Quartus `_hw.tcl`) to populate timing constraints. If you skip it, IPCraft will omit frequency constraints from the descriptor.

Click the clock on the canvas and set the `frequency` field in the Inspector (e.g. `100MHz`, `250000000`).

### Removing incorrectly imported ports

If the parser created plain ports for signals that belong to a bus interface, select them on the canvas and delete them (`Delete` key) after you have added the bus interface — they will be generated as part of the bus interface port map instead.

### Updating the VLNV

The parser fills in a default VLNV from your settings. Click the IP core block on the canvas and set in the Inspector:
- `vendor` — your company identifier
- `name` — the IP core name (defaults to the entity name)
- `version` — increment this when your interface changes
