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
| `ImportResolver` | `src/services/ImportResolver.ts` | Resolves `$import` directives in IP Core files |
| `BusLibraryService` | `src/services/BusLibraryService.ts` | Loads bus interface definitions from YAML library |
| `FileSetUpdater` | `src/services/FileSetUpdater.ts` | Updates file set entries after generation |
| `SubcoreResolver` | `src/services/SubcoreResolver.ts` | Resolves sub-core references across `.ip.yml` files |
| `VivadoCatalogScanner` | `src/services/VivadoCatalogScanner.ts` | Scans the Vivado IP catalog and caches results |
| `VivadoInterfaceScanner` | `src/services/VivadoInterfaceScanner.ts` | Scans the Vivado *interface* catalog (`data/ip/interfaces/`) and caches bus definitions — see [Vivado Interface Catalog](vivado-interface-catalog.md) |
| `ToolDetector` | `src/services/ToolDetector.ts` | Detects installed vendor toolchains (Vivado, Quartus) |

## Commands

| Module | Commands |
|--------|----------|
| `FileCreationCommands.ts` | Create IP Core, Memory Map, or combined files |
| `GenerateCommands.ts` | Generate HDL, scaffold project, view bus definitions |
| `BuildCommands.ts` | Build, Build: Vivado OOC, Build: Quartus Compile, Show Build Output |
| `editInIpPackager.ts` | Edit in IP Packager (opens Vivado GUI) |
| `editInPlatformDesigner.ts` | Edit in Platform Designer (opens Quartus qsys-edit) |
| `openInVivado.ts` | Open in Vivado (generate project if needed, then launch GUI) |
| `openInQuartus.ts` | Open in Quartus (generate project if needed, then launch GUI) |
| `scanVivadoCatalog.ts` | Scan Vivado IP Catalog |
| `scanVivadoInterfaces.ts` | Scan Vivado Interface Catalog |
| `migrateLegacyIpCore.ts` | Migrate Legacy IP Cores (`vendor:` → `targets:`) |
| `toggleEditorMode.ts` | Open as Text Editor / Open as Visual Editor |
| `toolNotConfigured.ts` | "Tool Not Found — Click to Configure" placeholder commands |
| `projectCreator.ts` | Shared helpers for project creation and board/part selection |

## Generator

Located in `src/generator/`:

| File | Purpose |
|------|---------|
| `IpCoreScaffolder.ts` | Orchestrates generation, builds template context, writes files |
| `registerProcessor.ts` | Processes registers, expands bus interfaces, resolves memory maps |
| `TemplateLoader.ts` | Loads and renders Nunjucks templates |
| `VivadoBusDefInstaller.ts` | Installs bus definitions into the Vivado IP catalog |
| `VivadoComponentXmlGenerator.ts` | Generates IP-XACT `component.xml` for Vivado |
| `types.ts` | Type definitions (`GenerateOptions`, `IpCoreData`, bus types) |
| `testbench/` | Testbench framework × engine abstraction |

### Testbench abstraction (`src/generator/testbench/`)

| File | Purpose |
|------|---------|
| `Framework.ts` / `Engine.ts` | Interfaces for framework and engine implementations |
| `frameworks/CocotbFramework.ts` | CocoTB framework |
| `frameworks/VUnitFramework.ts` | VUnit framework |
| `engines/GhdlEngine.ts` | GHDL simulator settings |
| `engines/IcarusEngine.ts` | Icarus Verilog simulator settings |
| `engines/VerilatorEngine.ts` | Verilator simulator settings |
| `engines/QuestaEngine.ts` | Questa / ModelSim simulator settings |

### Templates

Located in `src/generator/templates/`:

#### VHDL

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

#### SystemVerilog

| Template | Output |
|----------|--------|
| `pkg.sv.j2` | SV package (constants, types) |
| `top.sv.j2` | Top-level module |
| `core.sv.j2` | User logic skeleton |
| `bus_axil.sv.j2` | AXI-Lite bus wrapper |
| `bus_avmm.sv.j2` | Avalon-MM bus wrapper |
| `register_file.sv.j2` | Register file with decode logic |

#### Vendor integration

| Template | Output |
|----------|--------|
| `altera_hw_tcl.j2` | Altera Platform Designer component (`_hw.tcl`) |
| `amd_component_xml.j2` | AMD Vivado IP-XACT descriptor (`component.xml`) |
| `amd_xgui.j2` | AMD Vivado xgui (`.tcl`) |

#### Testbench

| Template | Output |
|----------|--------|
| `cocotb_test.py.j2` | CocoTB Python test skeleton |
| `cocotb_pytest.py.j2` | pytest wrapper functions |
| `cocotb_conftest.py.j2` | pytest session fixture |
| `cocotb_makefile.j2` | VHDL simulation Makefile (GHDL/Questa) |
| `cocotb_makefile.sv.j2` | SV simulation Makefile (Icarus/Verilator) |
| `cocotb_dump.v.j2` | VCD dump module for Icarus/Verilator |
| `mm_loader.py.j2` | Runtime `.mm.yml` reader |
| `vunit_run.py.j2` | VUnit test runner script |
| `vunit_tb.vhd.j2` | VUnit VHDL testbench entity |
| `vscode_settings.json.j2` | `.vscode/settings.json` for pytest discovery |

#### Other

| Template | Output |
|----------|--------|
| `memmap.yml.j2` | Memory map YAML skeleton |

## Toolchain Abstraction

Located in `src/services/toolchains/`:

| File | Purpose |
|------|---------|
| `SynthesisToolchain.ts` | `SynthesisToolchain` interface — common contract for all vendor tools |
| `LaunchableTool.ts` | Base class for tools that can be launched locally or via Docker |
| `VivadoToolchain.ts` | Vivado implementation: `local` (installDir) and `docker` (dockerImage) runners |
| `QuartusToolchain.ts` | Quartus implementation: `local` and `docker` runners |
| `registry.ts` | Toolchain registry — resolves a toolchain ID (e.g. `"vivado"`) to its implementation |

The toolchain abstraction centralises all vendor-tool configuration. Commands such as **Build**, **Open in Vivado**, and **Edit in IP Packager** retrieve their tool via `registry.get('vivado')` rather than reading settings directly.

## Parser

`src/parser/VhdlParser.ts` -- parses existing VHDL files into IP Core/Memory Map YAML specifications. Accessible via the `Import from VHDL` command or right-click context menu on `.vhd`/`.vhdl` files.

`src/parser/VivadoInterfaceXmlParser.ts` -- parses Vivado's own IP-XACT `busDefinition`/`abstractionDefinition` XML files (under `data/ip/interfaces/`) into bus definitions usable by `BusLibraryService`. Used by `VivadoInterfaceScanner`, not exposed as a standalone command — see [Vivado Interface Catalog](vivado-interface-catalog.md).

## Utilities

| File | Purpose |
|------|---------|
| `src/utils/Logger.ts` | Structured logging with levels |
| `src/utils/ErrorHandler.ts` | Centralized error handling |
| `src/utils/vscodeHelpers.ts` | Safe command registration helpers |
| `src/utils/fsHelpers.ts` | File system helpers (`fileExists`, `ensureDir`, etc.) |
| `src/utils/compilationOrder.ts` | Topological sort for VHDL compile order |
| `src/utils/configDir.ts` | IPCraft config directory resolution |
| `src/utils/detectVivadoVersion.ts` | Parses Vivado version string from install directory |
| `src/utils/migrateIpCore.ts` | Migrates legacy `vendor:` fields to `targets:` |
| `src/utils/pickBoard.ts` | Board/part picker QuickPick logic |
| `src/utils/quartusResolver.ts` | Resolves Quartus binary paths from `installDir` |
| `src/utils/vivadoResolver.ts` | Resolves Vivado binary paths from `installDir`; `resolveVivadoInstallDir()` resolves the install directory itself, reused by `VivadoInterfaceScanner` |
| `src/utils/resolveVendor.ts` | Maps `targets[]` entries to vendor toolchain IDs |
| `src/utils/sourceFileMounts.ts` | Builds Docker volume mount arguments for source files |
| `src/utils/vlnv.ts` | VLNV string parsing and comparison |
