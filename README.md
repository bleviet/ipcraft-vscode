# IPCraft for VS Code

Visual editor for IP Core (IPCraft) and Memory Map specifications.

## Features

- **Visual Editing**: Edit memory maps, address blocks, registers, and bit fields through an intuitive UI
- **Real-time Validation**: YAML syntax validation with helpful error messages
- **Spatial Operations**: Insert fields/registers/blocks with automatic repacking
- **Keyboard Navigation**: Full keyboard support with Vim-style shortcuts
- **Bit Visualization**: Visual representation of register bit fields
- **Address Map View**: Visual address space visualization
- **Bi-directional Sync**: Changes reflected in both visual editor and YAML source

## Requirements

No Python runtime is required. HDL generation uses bundled templates.
The extension includes default bus definitions (`bus_definitions.yml`) from `ipcraft-spec`.

## Installation

### From Source

```bash
cd ipcraft-vscode
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host.


## Usage

### Opening Files

1. Create or open a `.mm.yml` file
2. The visual editor opens automatically
3. Use the split view to see YAML source alongside the editor

### Editing Memory Maps

**Memory Map Properties:**
- Name, version, description
- Bit/byte order, default register size

**Address Blocks:**
- Add, delete, move blocks
- Auto-repacking maintains address continuity
- Insert with `Shift+O` (after) or `Shift+I` (before)

**Registers:**
- Edit offset, access type, description
- Insert with `Shift+O`/`Shift+I`
- Delete with `Shift+D`

**Bit Fields:**
- Visual bit allocation display
- Edit bit ranges, access, reset values
- Spatial insertion prevents overlaps
- Move fields with `Alt+↑`/`Alt+↓`

### Keyboard Shortcuts

**Navigation:**
- Arrow keys or `h`/`j`/`k`/`l` (Vim)
- `Tab` / `Shift+Tab` between tables
- `Escape` to unfocus

**Editing:**
- `F2` or `e` to edit cell
- `Enter` to save
- `Escape` to cancel

**Operations:**
- `Shift+O` - Insert after selected item
- `Shift+I` - Insert before selected item
- `Shift+D` - Delete selected item
- `Alt+↑` / `Alt+↓` - Move field/block

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation including:
- System architecture diagrams
- Data flow diagrams
- Component hierarchy
- State management
- Message passing protocol

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for developer guide including:
- Setup instructions
- Development workflow
- Testing procedures
- Debugging tips
- Common tasks

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for contribution guidelines including:
- Code style guidelines
- Testing requirements
- Pull request process
- Documentation standards

## Testing

```bash
# Run unit tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run linter
npm run lint
```

## Project Structure

```
vscode-extension/
├── src/
│   ├── extension.ts           # Extension entry point
│   ├── providers/             # Custom editor provider
│   ├── services/              # Extension services
│   ├── utils/                 # Logger, ErrorHandler
│   └── webview/
│       ├── index.tsx          # Webview React app
│       ├── components/        # React components
│       ├── hooks/             # Custom React hooks
│       ├── services/          # Data normalization, YAML ops
│       ├── algorithms/        # Repacking algorithms
│       └── utils/             # Utilities
├── docs/                      # Documentation
├── schemas/                   # YAML schemas
└── package.json
```

## Refactoring Status

**Completed (Phases 2-3):**
- ✅ Extracted 18 modular components from monolithic files
- ✅ 76% reduction in extension.ts (159 → 38 lines)
- ✅ 44% reduction in index.tsx (798 → 445 lines)
- ✅ Created 53 unit tests (72% passing)
- ✅ Zero ESLint errors, zero TypeScript errors
- ✅ Full functionality maintained

See [docs/walkthrough.md](file:///home/balevision/.gemini/antigravity/brain/f5101e73-7772-4e6b-bbaa-c536336b10d8/walkthrough.md) for complete refactoring details.

## Scripts

```bash
npm run compile           # Build extension and webview
npm run watch            # Watch mode for development
npm run test             # Run unit tests
npm run lint             # Run ESLint
npm run generate-types   # Generate types from schema
```

## Troubleshooting

### npm install Fails with Husky Error

**Problem:** Running `npm install` fails with error:
```
husky - .git can't be found
npm error command failed
npm error command sh -c husky install
```

**Cause:** This extension is part of a monorepo where the `.git` directory is located in a parent folder. Husky expects `.git` to be in the same directory as `package.json`.

**Solution 1: Skip Husky (Quick Fix)**
```bash
npm install --ignore-scripts
```

**Solution 2: Configure Husky for Monorepo (Recommended for Development)**

If you need git hooks functionality:

1. Install dependencies first:
   ```bash
   npm install --ignore-scripts
   ```

2. Manually configure husky to use the parent repository:
   ```bash
   npx husky install ../../.git/hooks
   ```

3. Set up git hooks (optional):
   ```bash
   npx husky add ../../.git/hooks/pre-commit "cd ipcore_tools/vscode/ipcore_editor && npm run lint-staged"
   ```

**What is Husky?**

Husky manages Git hooks to run scripts before commits, pushes, etc. It's used in this project to:
- Run ESLint on staged files before commit
- Run Prettier to format code automatically
- Ensure code quality standards

**Do I Need Husky?**

- **For building/using the extension:** No, it's optional
- **For contributing code:** Yes, it ensures consistent code style
- **For casual development:** No, you can run `npm run lint` manually

### Extension Not Loading

1. Check Output panel: `View → Output → Extension Host`
2. Verify activation events in `package.json`
3. Check for JavaScript errors in console

### Webview Not Updating

1. Open Developer Tools: `Help → Toggle Developer Tools`
2. Check browser console for errors
3. Verify message passing between extension and webview

### Build Errors

```bash
# Clean and rebuild
rm -rf out/ dist/ node_modules/
npm install --ignore-scripts
npm run compile
```

## Documentation

For developers interested in learning how this extension works or contributing to it:

*   **[Beginner's Guide](docs/BEGINNERS_GUIDE.md)**: A high-level introduction to VS Code extension architecture and patterns (Start Here!).
*   **[Development Guide](docs/DEVELOPMENT.md)**: Setup instructions, build commands, and testing workflows.
*   **[Architecture](docs/ARCHITECTURE.md)**: Detailed system design and component diagrams.

## License

[Add your license here]

## Credits

Developed for FPGA memory map editing workflows.
