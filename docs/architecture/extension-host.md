# Extension Host

The extension host runs in Node.js within VS Code. It manages file I/O, commands, and the bridge to webviews.

## Entry Point

`src/extension.ts` registers providers and commands on activation:

```typescript
export function activate(context: ExtensionContext): void {
  // Register custom editor providers
  // Register file creation commands
  // Register generator commands
}
```

## Providers

Custom editor providers connect VS Code documents to webview panels.

| Provider | File | View Type | Selector |
|----------|------|-----------|----------|
| `MemoryMapEditorProvider` | `src/providers/MemoryMapEditorProvider.ts` | `fpgaMemoryMap.editor` | `*.mm.yml` |
| `IpCoreEditorProvider` | `src/providers/IpCoreEditorProvider.ts` | `fpgaIpCore.editor` | `*.ip.yml` |

Both use `retainContextWhenHidden: true` for state persistence and share the same service architecture.

## Services

| Service | File | Role |
|---------|------|------|
| `MessageHandler` | `src/services/MessageHandler.ts` | Routes messages from webview to appropriate handlers |
| `DocumentManager` | `src/services/DocumentManager.ts` | Applies text edits to VS Code documents |
| `HtmlGenerator` | `src/services/HtmlGenerator.ts` | Generates webview HTML with CSP headers |
| `YamlValidator` | `src/services/YamlValidator.ts` | Validates YAML against schemas |
| `ImportResolver` | `src/services/ImportResolver.ts` | Resolves `$ref` imports in IP Core files |
| `BusLibraryService` | `src/services/BusLibraryService.ts` | Loads bus interface definitions |
| `FileSetUpdater` | `src/services/FileSetUpdater.ts` | Updates related file sets |

## Commands

| Module | Commands |
|--------|----------|
| `FileCreationCommands.ts` | Create IP Core, Memory Map, or combined files |
| `GenerateCommands.ts` | Generate VHDL, parse VHDL, view bus definitions |

## Generator

Located in `src/generator/`:

| File | Purpose |
|------|---------|
| `IpCoreScaffolder.ts` | Generates VHDL from IP Core specifications |
| `registerProcessor.ts` | Processes register definitions for code generation |
| `TemplateLoader.ts` | Loads Nunjucks templates |
| `templates/` | Nunjucks template files for VHDL output |

## Parser

`src/parser/VhdlParser.ts` -- parses existing VHDL files into IP Core/Memory Map YAML specifications. Accessible via the `Import from VHDL` command or right-click context menu on `.vhd`/`.vhdl` files.

## Utilities

| File | Purpose |
|------|---------|
| `src/utils/Logger.ts` | Structured logging with levels |
| `src/utils/ErrorHandler.ts` | Centralized error handling |
| `src/utils/vscodeHelpers.ts` | Safe command registration helpers |
