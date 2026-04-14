# Building a VSIX Package

This guide covers how to produce a `.vsix` installable extension package from the source code.

## Prerequisites

- **Node.js 20+** and **npm**
- All dependencies installed (`npm install`)

`@vscode/vsce` is already listed as a dev dependency — no global installation is required.

## Steps

### 1. Install dependencies

```bash
npm install
```

### 2. Run the production build

The `package` script compiles both the extension host and the webview bundles in production mode (minified, no source maps exposed):

```bash
npm run package
```

This runs webpack with `--mode production --devtool hidden-source-map` and outputs artefacts to `dist/`.

### 3. Package as VSIX

```bash
npx vsce package
```

This produces a file named `ipcraft-vscode-<version>.vsix` in the project root (e.g. `ipcraft-vscode-0.1.0.vsix`).

!!! tip
    Steps 2 and 3 can be combined since `vscode:prepublish` automatically runs `npm run package` before `vsce package`:
    ```bash
    npx vsce package   # triggers vscode:prepublish → npm run package first
    ```

## Installing the VSIX

Install directly in VS Code:

=== "VS Code UI"
    1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
    2. Click the **`···`** menu (top-right of the panel).
    3. Choose **Install from VSIX…** and select the generated file.

=== "Command line"
    ```bash
    code --install-extension ipcraft-vscode-0.1.0.vsix
    ```

## Verifying the package contents

Inspect what files are included without installing:

```bash
npx vsce ls
```

Files excluded by `.vscodeignore` (source files, `node_modules`, `docs`, `src`, etc.) will not appear in the output.

## Bumping the version

Update the version in `package.json` before packaging a new release:

```bash
npm version patch   # or minor / major
```

Then re-run `npx vsce package`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ERROR  Missing publisher name` | Ensure `publisher` is set in `package.json` (currently `bleviet`). |
| `ERROR  It seems the README.md still contains template text` | Update `README.md` to remove placeholder content. |
| Build fails before packaging | Run `npm run package` separately first and resolve any webpack errors. |
| VSIX installs but extension does not activate | Check `dist/extension.js` exists. Ensure `"main": "./dist/extension.js"` in `package.json`. |
