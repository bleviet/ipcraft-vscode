# Quick Start

## Two Runtimes

This project runs in two separate processes that communicate via `postMessage`:

```mermaid
graph LR
    A["Extension Host<br/>(Node.js in VS Code)"] -- "postMessage" --> B["Webview<br/>(embedded browser, React)"]
    B -- "postMessage" --> A
```

**Extension Host** -- reads/writes files, registers commands, opens editors, generates VHDL. Cannot render complex UI.

**Webview** -- renders React UI for Memory Map and IP Core editors. Cannot access user files directly.

## Key Files to Start With

### Extension Host

| File | Purpose |
|------|---------|
| `src/extension.ts` | Activation + provider registration |
| `src/providers/MemoryMapEditorProvider.ts` | Custom editor for `*.mm.yml` |
| `src/providers/IpCoreEditorProvider.ts` | Custom editor for `*.ip.yml` |
| `src/providers/IpCoreGenerateHandler.ts` | VHDL generation message handler |
| `src/services/WebviewRouter.ts` | Routes messages from webview, revisioned sync protocol |
| `src/generator/IpCoreScaffolder.ts` | VHDL + vendor file generation |
| `src/parser/VhdlParser.ts` | Import VHDL into specs |

### Memory Map Webview

| File | Purpose |
|------|---------|
| `src/webview/index.tsx` | Main app shell |
| `src/webview/components/OutlinePanel.tsx` | Sidebar tree navigation |
| `src/webview/components/DetailsPanel.tsx` | Routes to sub-editors |
| `src/webview/components/register/RegisterEditor.tsx` | Register editing UI |
| `src/webview/components/BitFieldVisualizer.tsx` | Visual bit field diagram |

### IP Core Webview

| File | Purpose |
|------|---------|
| `src/webview/ipcore/IpCoreApp.tsx` | App shell — toolbar (undo/redo, target picker, generate) and VHDL generation UI |
| `src/webview/ipcore/components/layout/EditorPanel.tsx` | Renders the canvas |
| `src/webview/ipcore/components/canvas/IpBlockCanvas.tsx` | Block-diagram canvas (the editor's main surface) |
| `src/webview/ipcore/components/canvas/CanvasInspector.tsx` | Property panel for the selected canvas element |

`layout/NavigationSidebar.tsx` and every file under `ipcore/components/sections/` (including the old
`GeneratorPanel.tsx`) still exist but are dead code — not imported by `IpCoreApp.tsx` or
`EditorPanel.tsx`. See [IP Core Editor Reference](../reference/ip-core-editor.md).

### Shared Behavior

| File | Purpose |
|------|---------|
| `src/webview/hooks/useMemoryMapState.ts` | Parsed memory map state |
| `src/webview/hooks/useSelection.ts` | Selection tracking |
| `src/webview/hooks/useYamlSync.ts` | Bi-directional YAML sync |
| `src/webview/services/SpatialInsertionService.ts` | Insert with repacking |

## Setup

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host. Open a `*.mm.yml` or `*.ip.yml` file.

## Typical Edit Loop

1. Start watch build: `npm run watch`
2. Make code changes
3. Reload the Extension Development Host window (`Ctrl+Shift+F5`)
4. Validate with focused tests: `npm run test:unit -- <test-file>`

## First Good Tasks

- Add or update unit tests in `src/test/suite/**`
- Fix UI behavior in a focused component
- Improve validation or error text in services/hooks
- Add a new generator template or vendor integration
- Improve documentation in `docs/`
