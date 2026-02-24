# IPCraft for VS Code

Visual editor for IP Core and Memory Map specifications, built as a VS Code extension.

## What It Does

- **Visual Editing** -- edit memory maps, address blocks, registers, and bit fields through an interactive UI
- **Real-time Validation** -- YAML syntax validation with error messages
- **Spatial Operations** -- insert fields/registers/blocks with automatic repacking
- **Keyboard Navigation** -- full keyboard support with Vim-style shortcuts
- **Bit Field Visualization** -- visual representation of register bit layouts and address spaces
- **Bi-directional Sync** -- changes reflected in both the visual editor and the YAML source
- **VHDL Generation** -- generate VHDL code from specifications
- **VHDL Import** -- parse existing VHDL files into specifications

## File Types

| Extension | Editor | Purpose |
|-----------|--------|---------|
| `*.mm.yml` | Memory Map Visual Editor | Define address blocks, registers, and bit fields |
| `*.ip.yml` | IP Core Visual Editor | Define IP core metadata, clocks, resets, bus interfaces, and linked memory maps |

## Where to Start

- **New here?** Begin with the [Quick Start](getting-started/quickstart.md)
- **Setting up dev environment?** See [Development Setup](getting-started/development.md)
- **Understanding the design?** Read through [Concepts](concepts/extension-model.md) and [Architecture](architecture/overview.md)
- **Contributing?** Check the [Guidelines](contributing/guidelines.md)
