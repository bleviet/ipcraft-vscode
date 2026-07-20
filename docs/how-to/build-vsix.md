# Building a VSIX Package

A VSIX file is an installable VS Code extension package. This guide builds one
from the repository source.

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

This produces a file named `ipcraft-vscode-<version>.vsix` in the project root (e.g. `ipcraft-vscode-0.8.6.vsix`).

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
    code --install-extension ipcraft-vscode-0.8.6.vsix
    ```

## Verifying the package contents

Inspect what files are included without installing:

```bash
npx vsce ls
```

Files excluded by `.vscodeignore` (source files, `node_modules`, `docs`, `src`, etc.) will not appear in the output.

## Bumping the version

Update the version in the extension and CLI package manifests before packaging
a new release:

```bash
npm version patch   # or minor / major
```

Then update `packages/ipcraft/package.json` to the same version. The CLI
packaging and release checks reject mismatched versions.

Then re-run `npx vsce package`.

## Releasing the standalone CLI

The VSIX and npm CLI are separate artifacts. Installing the extension does not
add `ipcraft` to the user's shell `PATH`.

Build and test the npm archive locally without publishing it:

```bash
npm run package:cli
npm run test:cli-package
```

After the matching extension version has been tested and published, run the
`Publish CLI to npm` GitHub Actions workflow manually. Enter the matching
version and confirm that the extension is already published. The workflow
checks the versions, rebuilds the production bundle, installs the tarball in a
clean temporary project, and only then runs `npm publish`. The protected `npm`
environment must provide `NPM_TOKEN`.

Direct publication is locked unless `IPCRAFT_PUBLISH=confirmed` is supplied,
so normal builds, tests, and `npm pack` cannot publish the package.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ERROR  Missing publisher name` | Ensure `publisher` is set in `package.json` (currently `bleviet`). |
| `ERROR  It seems the README.md still contains template text` | Update `README.md` to remove placeholder content. |
| Build fails before packaging | Run `npm run package` separately first and resolve any webpack errors. |
| VSIX installs but extension does not activate | Check `dist/extension.js` exists. Ensure `"main": "./dist/extension.js"` in `package.json`. |
