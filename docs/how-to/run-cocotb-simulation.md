# Running a Cocotb Simulation

Cocotb lets you test generated HDL with Python. IPCraft can generate the HDL,
a Python test, and the files needed to start a simulator.

## Quick start

You need:

- Python 3.10 or newer
- `pytest` and `cocotb`
- GHDL for VHDL, or Icarus Verilog for SystemVerilog

Install the Python packages:

```bash
python3 -m pip install cocotb pytest
```

Generate the project in IPCraft, open a terminal in the generated project, and
run:

```bash
pytest -v tb/
```

![Flow diagram: IP core and memory map, Generate project, HDL and Python test, pytest starts simulator, Test result and waveform](../images/diagrams/how-to-run-cocotb-simulation-1.drawio.svg)

## Generated files

The built-in packs write the tests to `tb/`:

```text
generated-project/
├── rtl/                          # Generated VHDL or SystemVerilog
├── tb/
│   ├── <name>_test.py            # cocotb tests; extend this file
│   ├── test_<name>_sim.py        # one pytest function per cocotb test
│   ├── conftest.py               # compiles the HDL once per run
│   ├── register_model.py         # register model for memory-mapped cores
│   ├── verification_manifest.json
│   └── Makefile                  # make-based alternative to pytest
└── .vscode/settings.json         # points the Testing view at tb/
```

The register-map helper gives tests named access to registers and fields. This
is clearer than repeating numeric addresses and masks throughout a test.

## Run tests

Run every test:

```bash
pytest -v tb/
```

Run one test:

```bash
pytest -v tb/ -k test_register_access
```

You can also run the cocotb Makefile directly:

```bash
make -C tb
```

## Choose a simulator

Cocotb reads the `SIM` environment variable. The default is the simulator
selected when the testbench was generated. Examples:

```bash
SIM=ghdl pytest -v tb/
SIM=icarus pytest -v tb/
```

Use GHDL for generated VHDL and Icarus Verilog for generated SystemVerilog
unless your scaffold pack documents another simulator.

## Read the result

A successful run reports each test as `PASSED`. A failed assertion includes
the Python file and line number. Start with the first failure because later
failures may be a consequence of it.

Generated tests may also produce a waveform file. Open it with a waveform
viewer such as GTKWave to inspect signal changes over time.

## Use the VS Code Testing view

With the Python extension installed, VS Code can discover the generated
`pytest` tests:

1. Open the generated project folder.
2. Open the **Testing** view.
3. Choose **Configure Python Tests** if discovery has not run.
4. Select `pytest` and the `tb` directory. The generated
   `.vscode/settings.json` already does this when you open the generated
   project as the workspace folder.
5. Run or debug a test from the test tree.

The terminal command remains the best way to confirm the same tests work in
automation.

## Write a custom register test

Generated memory-mapped testbenches expose a `model` (`RegisterModel`), a
`manifest`, and an `AxiTransport` or `AvalonTransport` in
`tb/<ip_name>_test.py`. Extend that file and look up registers and fields by
name instead of repeating raw offsets and masks.

```python
def test_register_layout():
    control = next(reg for reg in model.registers if reg["name"] == "CONTROL")
    assert control["offset"] == 0

    enable = next(field for field in control["fields"] if field["name"] == "ENABLE")
    assert enable["mask"] == 0x1
```

To extract or update a field in a register word:

```python
enable_value = (register_value & enable["mask"]) >> enable["bitOffset"]
updated_value = (register_value & ~enable["mask"]) | (1 << enable["bitOffset"])
```

Keep layout checks separate from bus transactions. A layout test validates the
generated register description; a cocotb coroutine validates the behavior of
the simulated hardware.

## Troubleshooting

### RTL sources are not found

Run the test from the generated project root. Check that the paths in the
generated Makefile or Python runner match the `rtl/` directory.

### The simulator is not found

Confirm it is on `PATH`:

```bash
ghdl --version
iverilog -V
```

### Pytest finds no tests

Pass the `tb/` directory to `pytest` and run it from the generated project
root. Only `test_<name>_sim.py` holds pytest functions; `<name>_test.py` holds
the cocotb tests they start.

### GHDL rejects VHDL syntax

Generated VHDL uses VHDL-2008. Make sure the generated runner passes
`--std=08` and that your GHDL version supports it.

### `cocotb.runner` cannot be imported

Check the installed version:

```bash
python3 -m pip show cocotb
```

Install the version required by the generated project or its requirements
file.

## Related pages

- [Generating a project](generating-a-project.md)
- [Memory-mapped registers](../tutorials/memory-mapped-registers.md)
- [Generator reference](../reference/generator.md#cocotb-verification-source-of-truth)
