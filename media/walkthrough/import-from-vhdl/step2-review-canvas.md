## Reviewing the imported canvas

After parsing, IPCraft opens the generated `.ip.yml` in the canvas editor. Walk through each section and verify the result.

### What to check

**Clocks and resets**

Click each clock on the canvas and confirm in the Inspector:
- The frequency is set (or estimate it — used for vendor timing constraints)
- The associated reset is correctly linked

**Bus interfaces**

If your entity has AXI signals, click each bus interface on the canvas and check in the Inspector:
- The `physicalPrefix` matches your HDL signal prefix exactly (e.g. `s_axi_`)
- The bus type is correct (AXI4-Lite Slave vs AXI4 Slave)
- The port count matches — expand the bus bundle on the canvas by clicking it

**Ports**

Check each scalar port on the canvas edge for direction and width. The parser infers width from `std_logic_vector` bounds, but expressions like `DATA_WIDTH-1 downto 0` may resolve to the generic's default value.

**Parameters**

Generics from your entity become parameters on the canvas. Check that their types and default values came through.

### Common issues

| Symptom | Fix |
|---------|-----|
| Clock not detected | Port name doesn't contain `clk`/`clock` — rename in VHDL or add manually |
| Bus signals listed as plain ports | Signal prefix doesn't match known AXI patterns — add bus interface manually |
| Wrong port width | Generic expression in bounds — set the concrete default in Parameters |
