## Verifying your register interface

IPCraft generates a cocotb Python test skeleton alongside your RTL so you can start writing tests immediately.

### Generated test files

```
tb/
  my_core_test.py       ← test skeleton with AXI-Lite driver helpers
  verification_manifest.json ← resolved register semantics
  register_model.py     ← software oracle used for expected readback
  conftest.py           ← cocotb/pytest fixtures
  test_my_core_sim.py   ← pytest entry point that drives the simulation
  Makefile               ← one-line simulation launch
```

### Running the simulation

```bash
cd tb
make SIM=ghdl        # GHDL (open-source, fastest)
make SIM=icarus      # Icarus Verilog (SV only)
make SIM=verilator   # Verilator (SV only)
make SIM=questa      # ModelSim / Questa
```

### What the skeleton tests

For a memory-mapped slave, the generated test builds an AXI or Avalon
transport and checks the resolved register manifest:

```python
@cocotb.test()
async def test_register_semantics(dut):
    transport = AxiTransport(dut)
    await _reset_dut(dut)

    directed_value = 0xA5A5A5A5 & model.word_mask
    for reg in model.writable_registers():
        await transport.write(reg["offset"], directed_value)
        model.apply_write(reg["offset"], directed_value)
```

The full generated test also covers reset values, readable and reserved bits,
write-only transactions, write-1-to-clear and self-clearing fields, byte
enables where supported, unmapped reads, and deterministic random traffic.
Extend it with your design-specific functional cases.

### Changing the simulation framework

Set `ipcraft.testbench.framework` to `vunit` in IPCraft Settings to switch to **VUnit** instead of cocotb if your team prefers VHDL-native testbenches.

> **Tip:** The `ipcraft.testbench.engine` setting selects the simulator. Set it to `ghdl` for the fastest open-source flow, or `questa` for industry-standard results.
