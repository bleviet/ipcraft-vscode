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

MIT License

Copyright (c) 2026 Le Viet Bach

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.