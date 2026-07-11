## Verifying your register interface

IPCraft generates a cocotb Python test skeleton alongside your RTL so you can start writing tests immediately.

### Generated test files

```
tb/
  my_core_test.py       ← test skeleton with AXI-Lite driver helpers
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

The generated test includes:

```python
@cocotb.test()
async def test_register_write_read(dut):
    # Reset
    await reset_dut(dut)
    # Write to CTRL register
    await axil_write(dut, REG_CTRL_OFFSET, 0x01)
    # Read back and verify
    val = await axil_read(dut, REG_CTRL_OFFSET)
    assert val == 0x01, f"Expected 0x01, got {val:#010x}"
```

Extend this skeleton with your functional test cases.

### Changing the simulation framework

Set `ipcraft.testbench.framework` to `vunit` in IPCraft Settings to switch to **VUnit** instead of cocotb if your team prefers VHDL-native testbenches.

> **Tip:** The `ipcraft.testbench.engine` setting selects the simulator. Set it to `ghdl` for the fastest open-source flow, or `questa` for industry-standard results.
