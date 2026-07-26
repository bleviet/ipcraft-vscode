## Refining the import

Auto-detection is a starting point. Use the canvas and section editors to fill in anything the parser could not infer.

### Adding a missing bus interface

1. Open the Library Palette (left side of canvas)
2. Find the correct bus type (e.g. AXI4-Lite)
3. Drag it onto the left half for a slave/sink or the right half for a master/source
4. Set the `physicalPrefix` in the Inspector to match your HDL signals

### Setting clock frequencies

Clock frequency is used when a full scaffold generates project constraints
such as Vivado XDC and Quartus SDC. If you skip it, IPCraft cannot emit a
`create_clock` constraint for that clock.

Click the clock on the canvas and set the `frequency` field in the Inspector
with an explicit unit (e.g. `100MHz` or `250000000Hz`).

The current standalone packaging descriptors do not use this value:
`component.xml` emits a fixed 100 MHz `FREQ_HZ`, while `_hw.tcl` emits
`clockRate 0`. Validate or adjust those properties in the vendor tool.

### Removing incorrectly imported ports

If the parser created plain ports for signals that belong to a bus interface, select them on the canvas and delete them (`Delete` key) after you have added the bus interface — they will be generated as part of the bus interface port map instead.

### Updating the VLNV

The parser fills in a default VLNV from your settings. Click the IP core block on the canvas and set in the Inspector:
- `vendor` — your company identifier
- `name` — the IP core name (defaults to the entity name)
- `version` — increment this when your interface changes
