# IPCraft for VS Code

Visual editor for IP Core and Memory Map specifications.

## Features

- **Visual Editing**: Edit memory maps, address blocks, registers, and bit fields through an intuitive UI
- **Real-time Validation**: YAML syntax validation with helpful error messages
- **Spatial Operations**: Insert fields/registers/blocks with automatic repacking
- **Keyboard Navigation**: Full keyboard support with Vim-style shortcuts
- **Visualization**: Visual representation of register bit fields and address spaces
- **Bi-directional Sync**: Changes reflected in both visual editor and YAML source

## Installation

```bash
npm install
npm run compile
```

## Usage

1. Create or open a `.mm.yml` or `.ip.yml` file.
2. The visual editor opens automatically.
3. Use the split view to see YAML source alongside the editor.

### Available Commands (`Ctrl+Shift+P`)

| Command | Description |
|---------|-------------|
| `IPCraft: New IP Core` | Create a new IP Core specification file |
| `IPCraft: New Memory Map` | Create a new Memory Map specification file |
| `IPCraft: New IP Core + Memory Map` | Create a new IP Core linked to a new Memory Map |
| `IPCraft: Generate VHDL` | Scaffold an RTL project from the current IP Core |
| `IPCraft: Import from VHDL` | Parse a VHDL file to generate an IP Core spec |
| `IPCraft: View Bus Definitions` | Browse the built-in library of bus interfaces |

### Keyboard Shortcuts

- **Navigation**: Arrow keys or `h`/`j`/`k`/`l` (Vim), `Tab` / `Shift+Tab`, `Escape` to unfocus
- **Editing**: `F2` or `e` to edit cell, `Enter` to save, `Escape` to cancel
- **Operations**: `Shift+O` (Insert after), `Shift+I` (Insert before), `Shift+D` (Delete), `Alt+UP`/`Alt+DOWN` (Move item)

## Documentation

Full documentation is in the `docs/` directory, built with [MkDocs](https://www.mkdocs.org/):

```bash
pip install mkdocs mkdocs-material
mkdocs serve
```

Then open `http://127.0.0.1:8000`. See [docs/index.md](docs/index.md) for an overview.

### Available Scripts

```bash
npm run compile           # Build extension and webview
npm run watch             # Watch mode for development
npm run test              # Run unit tests
npm run lint              # Run ESLint
npm run generate-types    # Generate types from schema
```

## License

[MIT License](LICENSE)