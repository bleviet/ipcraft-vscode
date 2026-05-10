# IPCraft for VS Code

Visual editor for IP Core and Memory Map specifications, built as a VS Code extension.

## What It Does

- **Visual Editing** -- edit memory maps, address blocks, registers, and bit fields through an interactive UI
- **IP Core Canvas** -- visual block diagram of the IP Core; drag ports, bus interfaces, generics, clocks, and resets directly onto the schematic from the library palette
- **IP Core Form Editor** -- edit clocks, resets, ports, bus interfaces, parameters, file sets, and metadata through dedicated section editors (toggle between canvas and form view)
- **Canvas Inspector** -- click any canvas element to open a property inspector; configure mode, width, memory map reference, and more without leaving the diagram
- **Custom Interfaces** -- define conduit (custom) bus interfaces with user-named signals, stored as reusable YAML bus definitions
- **Real-time Validation** -- YAML syntax validation with cross-reference error checking
- **Spatial Operations** -- insert fields/registers/blocks with automatic repacking
- **Keyboard Navigation** -- full keyboard support with Vim-style shortcuts in the form editor; Delete, Ctrl+D, Ctrl+Z/Y, and zoom shortcuts in the canvas
- **Bit Field Visualization** -- visual representation of register bit layouts and address spaces with drag interactions
- **Bi-directional Sync** -- changes reflected in both the visual editor and the YAML source
- **VHDL Generation** -- scaffold complete RTL projects from IP Core specs (package, top, core, bus wrapper, register bank)
- **Vendor Integration** -- generate Altera Platform Designer `_hw.tcl` and AMD Vivado `component.xml` files
- **Testbench Scaffolding** -- generate cocotb Python tests and GHDL Makefiles
- **VHDL Import** -- parse existing VHDL files into IP Core specifications
- **Bus Library Viewer** -- inspect available bus interface definitions from the built-in library

## File Types

| Extension | Editor | Purpose |
|-----------|--------|---------|
| `*.mm.yml` | Memory Map Visual Editor | Define address blocks, registers, and bit fields |
| `*.ip.yml` | IP Core Visual Editor | Define IP core metadata, clocks, resets, bus interfaces, and linked memory maps |

## Where to Start

- **New here?** Begin with the [Quick Start](getting-started/quickstart.md)
- **Setting up dev environment?** See [Development Setup](getting-started/development.md)
- **Import existing VHDL?** Follow [Importing from VHDL](how-to/vhdl-import.md)
- **Using the generator?** See [Generating a Project](how-to/generating-a-project.md)
- **Using AI tools?** See the [AI Design Guide](how-to/ai-design-guide.md)
- **Running EDA integration tests?** See [Run the EDA Integration Tests](how-to/run-eda-integration-tests.md)
- **Understanding the design?** Read through [Concepts](concepts/extension-model.md) and [Architecture](architecture/overview.md)
- **Exploring reference docs?** See the [Generator Reference](reference/generator.md), [IP Core Editor](reference/ip-core-editor.md), or [Specification Schemas](reference/specification-schemas.md)
- **Contributing?** Check the [Guidelines](contributing/guidelines.md)
