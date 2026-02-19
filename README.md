# IPCraft for VS Code

Visual editor for IP Core (IPCraft) and Memory Map specifications.

## Features

- **Visual Editing**: Edit memory maps, address blocks, registers, and bit fields through an intuitive UI
- **Real-time Validation**: YAML syntax validation with helpful error messages
- **Spatial Operations**: Insert fields/registers/blocks with automatic repacking
- **Keyboard Navigation**: Full keyboard support with Vim-style shortcuts
- **Visualization**: Visual representation of register bit fields and address spaces
- **Bi-directional Sync**: Changes reflected in both visual editor and YAML source

## Requirements

No Python runtime is required. HDL generation uses bundled templates.
The extension includes default bus definitions from `ipcraft-spec`.

## Installation

```bash
git init
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

## Usage

1. Create or open a `.mm.yml` or `.ip.yml` file.
2. The visual editor opens automatically.
3. Use the split view to see YAML source alongside the editor.

### Keyboard Shortcuts

- **Navigation**: Arrow keys or `h`/`j`/`k`/`l` (Vim), `Tab` / `Shift+Tab`, `Escape` to unfocus
- **Editing**: `F2` or `e` to edit cell, `Enter` to save, `Escape` to cancel
- **Operations**: `Shift+O` (Insert after), `Shift+I` (Insert before), `Shift+D` (Delete), `Alt+UP`/`Alt+DOWN` (Move item)

## Development and Documentation

- [docs/BEGINNERS_GUIDE.md](docs/BEGINNERS_GUIDE.md): Introduction to the architecture and patterns.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): Setup, workflow, and debugging.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): System design and components.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): Contribution guidelines.

### Available Scripts

```bash
npm run compile           # Build extension and webview
npm run watch             # Watch mode for development
npm run test              # Run unit tests
npm run lint              # Run ESLint
npm run generate-types    # Generate types from schema
```

## License

[Add your license here]
