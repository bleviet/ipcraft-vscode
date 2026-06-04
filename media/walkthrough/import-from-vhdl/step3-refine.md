## Refining the import

Auto-detection is a starting point. Use the canvas and section editors to fill in anything the parser could not infer.

### Adding a missing bus interface

**From the canvas:**

1. Open the Library Palette (left side of canvas)
2. Find the correct bus type (e.g. AXI4-Lite Slave)
3. Drag it onto the right edge of the block
4. Set the `physicalPrefix` in the Inspector to match your HDL signals

**From the Bus Interfaces tab:**

1. Open **Bus Interfaces** in the left navigation
2. Click **+** to add a new interface
3. Set type, mode, and physicalPrefix

### Setting clock frequencies

Clock frequency is used when generating vendor packaging (Vivado `component.xml` and Quartus `_hw.tcl`) to populate timing constraints. If you skip it, IPCraft will omit frequency constraints from the descriptor.

Open **Clocks** and set the `frequency` field (e.g. `100MHz`, `250000000`).

### Removing incorrectly imported ports

If the parser created plain ports for signals that belong to a bus interface, delete them from the Ports section after you have added the bus interface — they will be generated as part of the bus interface port map instead.

### Updating the VLNV

The parser fills in a default VLNV from your settings. Open the **Metadata** section to set:
- `vendor` — your company identifier
- `name` — the IP core name (defaults to the entity name)
- `version` — increment this when your interface changes
