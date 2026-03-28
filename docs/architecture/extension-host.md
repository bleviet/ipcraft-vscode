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

### Supporting Modules

| File | Purpose |
|------|---------|
| `IpCoreGenerateHandler.ts` | Handles `type: 'generate'` messages, invokes scaffolder, returns results |
| `providerServices.ts` | Shared service factory for providers |
| `ipCoreErrorHtml.ts` | Error page HTML for IP Core parse failures |

## Services

| Service | File | Role |
|---------|------|------|
| `MessageHandler` | `src/services/MessageHandler.ts` | Routes messages from webview to appropriate handlers |
| `DocumentManager` | `src/services/DocumentManager.ts` | Applies text edits to VS Code documents |
| `HtmlGenerator` | `src/services/HtmlGenerator.ts` | Generates webview HTML with CSP headers |
| `YamlValidator` | `src/services/YamlValidator.ts` | Validates YAML against schemas |
| `ImportResolver` | `src/services/ImportResolver.ts` | Resolves `$ref` imports in IP Core files |
| `BusLibraryService` | `src/services/BusLibraryService.ts` | Loads bus interface definitions from YAML library |
| `FileSetUpdater` | `src/services/FileSetUpdater.ts` | Updates file set entries after generation |

## Commands

| Module | Commands |
|--------|----------|
| `FileCreationCommands.ts` | Create IP Core, Memory Map, or combined files |
| `GenerateCommands.ts` | Generate VHDL, parse VHDL, view bus definitions |

## Generator

Located in `src/generator/`:

| File | Purpose |
|------|---------|
| `IpCoreScaffolder.ts` | Orchestrates generation, builds template context, writes files |
| `registerProcessor.ts` | Processes registers, expands bus interfaces, resolves memory maps |
| `TemplateLoader.ts` | Loads and renders Nunjucks templates |
| `types.ts` | Type definitions (`VendorOption`, `GenerateOptions`, `IpCoreData`, bus types) |

### Templates

Located in `src/generator/templates/`:

| Template | Output |
|----------|--------|
| `package.vhdl.j2` | VHDL package (constants, types) |
| `top.vhdl.j2` | Top-level entity |
| `core.vhdl.j2` | User logic skeleton |
| `bus_axil.vhdl.j2` | AXI-Lite bus wrapper |
| `bus_avmm.vhdl.j2` | Avalon-MM bus wrapper |
| `register_file.vhdl.j2` | Register file with decode logic |
| `entity.vhdl.j2` | Entity declaration helper |
| `architecture.vhdl.j2` | Architecture stub |
| `altera_hw_tcl.j2` | Altera Platform Designer component (`_hw.tcl`) |
| `amd_component_xml.j2` | AMD Vivado IP-XACT descriptor (`component.xml`) |
| `amd_xgui.j2` | AMD Vivado xgui (`.tcl`) |
| `cocotb_test.py.j2` | cocotb Python test skeleton |
| `cocotb_makefile.j2` | GHDL simulation Makefile |
| `memmap.yml.j2` | Memory map YAML template |

## Parser

`src/parser/VhdlParser.ts` -- parses existing VHDL files into IP Core/Memory Map YAML specifications. Accessible via the `Import from VHDL` command or right-click context menu on `.vhd`/`.vhdl` files.

## Utilities

| File | Purpose |
|------|---------|
| `src/utils/Logger.ts` | Structured logging with levels |
| `src/utils/ErrorHandler.ts` | Centralized error handling |
| `src/utils/vscodeHelpers.ts` | Safe command registration helpers |
