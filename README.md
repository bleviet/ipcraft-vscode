# IPCraft for VS Code

Visual editor for FPGA IP Core and Memory Map specifications — design, generate, and build from inside VS Code.

## Screenshots

| IP Core Editor | Memory Map Editor |
|---|---|
| ![IP Core Editor](docs/images/ipcore-editor-dark.png) | ![Memory Map Editor](docs/images/memorymap-editor-dark.png) |

Generated from the real editor UI by `npm run docs:screenshots` — see [Automated Docs Screenshots](docs/concepts/docs-screenshots.md).

## Features

- **Visual Editors** — block-diagram IP Core canvas and tabular Memory Map editor, both with an inline inspector and bit-field visualizer; changes sync instantly to the underlying YAML
- **Custom Interfaces** — define conduit (custom) bus interfaces with user-named signals, stored as reusable `.busdef.yml` files
- **Consistency Check** — cross-references a spec against the generated top-level HDL and vendor artifacts (`component.xml`, `_hw.tcl`), flagging drift in either direction
- **HDL Generation** — scaffolds a full RTL project (package, top entity, user-logic skeleton, bus wrapper, register file, testbench) in VHDL or SystemVerilog, plus Vivado and Quartus vendor project files
- **Headless Build** — runs Vivado or Quartus in batch mode from inside VS Code, with a Build Reports sidebar panel (timing, utilization, CDC) and status bar summary; Docker runner supported
- **Import** — reverse-engineer an existing VHDL entity, Platform Designer `_hw.tcl`, or Vivado `component.xml` into an `.ip.yml` spec

See [Commands & Settings](docs/reference/commands.md) for the full command list and every setting's default and description, and [Keyboard Shortcuts](docs/reference/keyboard-shortcuts.md) for canvas/table navigation.

---

## Quick Start

1. `IPCraft: New IP Core` (or `New IP Core + Register Map`) from the Command Palette
2. Design the core on the visual canvas
3. `IPCraft: Scaffold Project` to generate RTL, testbench, and vendor files
4. `IPCraft: Build` to run a headless Vivado/Quartus compile

Walkthroughs covering these steps (and importing existing VHDL, importing from vendor tools, and synthesizing) are available from **Help → Get Started** or `IPCraft: Open Walkthrough...`.

A CLI (`npx ipcraft generate` / `ipcraft verify`) runs the same generator outside VS Code, for CI and scripting — see [Generator Reference](docs/reference/generator.md#headless-cli).

---

## Documentation

Full documentation — commands, settings, keyboard shortcuts, generator internals, schemas, tutorials — is in the [`docs/`](docs/) directory, built with [MkDocs](https://www.mkdocs.org/):

```bash
pip install mkdocs mkdocs-material
mkdocs serve
```

Then open `http://127.0.0.1:8000`.

---

## Development

`ipcraft-spec` (bus definitions and JSON schemas) is a git submodule — clone with `--recurse-submodules`, or run `git submodule update --init --recursive` after a plain clone.

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host.

```bash
npm run watch        # watch mode
npm run test:unit    # unit tests
npm run lint         # ESLint (zero warnings)
npm run type-check   # TypeScript check
```

See [Development Setup](docs/getting-started/development.md) for the full contributor workflow.

---

## License

[MIT](LICENSE)
