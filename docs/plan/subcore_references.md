# IP Core Dependencies (Subcore References) -- Implementation Plan

## 1. Overview

Add dependency management to IPCraft so an IP core can declare references to other IP cores it depends on. Dependencies come from three sources:

1. **Workspace IPs** -- other `.ip.yml` files in the VS Code workspace
2. **User IP repositories** -- custom paths configured via VS Code settings (e.g. shared team IP libraries)
3. **Vivado catalog IPs** -- IPs from an installed AMD Vivado (detected via manual scan command)

Dependencies are stored in the `.ip.yml` file as `subcores`, emitted as `<xilinx:subCoreRef>` in `component.xml`, and managed via a "Dependencies" section in the webview editor.

## 2. VLNV Format

Use **colon-separated** strings: `vendor:library:name:version`

Examples: `xilinx.com:ip:fifo_generator:13.2`, `ipcraft:examples:my_fifo:1.0`

Colons are unambiguous because vendor names contain dots but never colons. This matches Vivado's own `get_ipdefs` output format. Parsing is a simple `vlnv.split(':')` yielding exactly 4 parts.

## 3. YAML Schema

### 3.1 Simple form (string shorthand)

```yaml
subcores:
  - xilinx.com:ip:fifo_generator:13.2
  - xilinx.com:ip:axi_interconnect:2.1
```

### 3.2 Object form (with optional path override)

```yaml
subcores:
  - vlnv: mycompany.com:dsp:custom_fir:2.0
    path: ../custom_fir
```

Both forms can be mixed in the same array.

## 4. IP Discovery Sources

### 4.1 Workspace scan

On activation and on `.ip.yml` file changes, scan all `**/*.ip.yml` files in the workspace. For each file, quick-parse the `vlnv:` header (read first ~20 lines with regex, no full YAML parse) and build a `Map<string, string>` of `vlnv -> fsPath`.

### 4.2 User IP repository paths (new setting)

Add a new VS Code setting `ipcraft.ipRepositoryPaths` (array of strings). These are absolute paths or paths relative to the workspace root pointing to directories containing IP cores. The extension scans these recursively for `.ip.yml` files and also for `component.xml` files (Vivado-packaged IPs). This covers shared team IP libraries and third-party IP.

Scanning logic is the same as workspace scan but rooted at the configured paths.

### 4.3 Vivado catalog scan (manual command)

A new command `IPCraft: Scan Vivado IP Catalog` that:

1. Reads `ipcraft.vivadoPath` setting (default: `vivado`)
2. Writes a temp Tcl script that creates an in-memory project and dumps `get_ipdefs *`
3. Runs `vivado -mode batch -source <script> -nojournal -nolog`
4. Parses the colon-separated VLNVs from stdout
5. Writes results to `<configDir>/vivado/catalog.json` (using existing `getIpcraftConfigDir()`)
6. Shows info notification with count

Falls back to a built-in curated list of ~20 common Xilinx IPs when no catalog file exists.

## 5. File-by-File Changes

### 5.1 New files

---

#### `src/utils/vlnv.ts`

VLNV parsing utility.

```typescript
export interface ParsedVlnv {
  vendor: string;
  library: string;
  name: string;
  version: string;
}

export function parseVlnv(vlnv: string): ParsedVlnv {
  const parts = vlnv.split(':');
  if (parts.length !== 4 || parts.some(p => !p)) {
    throw new Error(`Invalid VLNV "${vlnv}": expected vendor:library:name:version`);
  }
  return { vendor: parts[0], library: parts[1], name: parts[2], version: parts[3] };
}

export function formatVlnv(v: ParsedVlnv): string {
  return `${v.vendor}:${v.library}:${v.name}:${v.version}`;
}

export function isValidVlnv(vlnv: string): boolean {
  return /^[^:]+:[^:]+:[^:]+:[^:]+$/.test(vlnv);
}
```

---

#### `src/services/SubcoreResolver.ts`

Discovers IPs from workspace, user repo paths, and Vivado catalog. Resolves subcore references.

**Constructor**: accepts `ExtensionContext`.

**Public interface**:

```typescript
export interface ResolvedSubcore {
  vlnv: string;
  source: 'workspace' | 'user-repo' | 'vivado-catalog' | 'builtin' | 'unresolved';
  fsPath?: string;
}

export interface SubcoreCandidate {
  vlnv: string;
  source: 'workspace' | 'user-repo' | 'vivado-catalog' | 'builtin';
  label?: string;     // human-friendly display name
  fsPath?: string;
}

export class SubcoreResolver {
  async initialize(): Promise<void>;            // initial scan
  resolve(vlnv: string): ResolvedSubcore;       // resolve single ref
  getAvailableIps(): SubcoreCandidate[];        // for QuickPick
  refresh(): Promise<void>;                     // re-scan all sources
}
```

**Implementation details**:

- `initialize()`: calls `scanWorkspace()`, `scanUserRepoPaths()`, `loadVivadoCatalog()`, `loadBuiltinCatalog()`
- `scanWorkspace()`: uses `vscode.workspace.findFiles('**/*.ip.yml')`. For each file, read first 20 lines with `fs.readFile`, regex-match `vendor:`, `library:`, `name:`, `version:` fields from the vlnv block. Build index.
- `scanUserRepoPaths()`: reads `ipcraft.ipRepositoryPaths` setting. For each path, glob for `*.ip.yml` and `component.xml`. Parse VLNVs. For `component.xml`, extract `spirit:vendor/library/name/version` from the root element.
- `loadVivadoCatalog()`: reads `<configDir>/vivado/catalog.json` if it exists.
- `loadBuiltinCatalog()`: loads from `src/data/xilinxCatalog.ts`.
- `resolve()`: looks up the vlnv string in workspace index first, then user-repo index, then vivado catalog, then builtin. Returns the match with its source.
- Register `FileSystemWatcher` on `**/*.ip.yml` to invalidate and re-scan workspace index.
- Listen to `onDidChangeConfiguration` for `ipcraft.ipRepositoryPaths` changes.

---

#### `src/services/VivadoCatalogScanner.ts`

Handles the manual Vivado catalog scan command.

```typescript
export class VivadoCatalogScanner {
  async scan(): Promise<{ count: number; catalogPath: string }>;
  async loadCachedCatalog(): Promise<string[]>;
}
```

**`scan()` implementation**:

1. Get `ipcraft.vivadoPath` from config (default `'vivado'`)
2. Create temp dir inside workspace `.ipcraft-tmp/` (cleaned up after)
3. Write Tcl script:
   ```tcl
   create_project -in_memory -part xc7z020clg484-1
   set fh [open {OUTPUT_FILE} w]
   foreach ipdef [get_ipdefs *] { puts $fh "$ipdef" }
   close $fh
   exit
   ```
4. Spawn: `vivado -mode batch -source <script> -nojournal -nolog`
5. Read output file, parse each line as a colon-separated VLNV
6. Write to `path.join(getIpcraftConfigDir(), 'vivado', 'catalog.json')`:
   ```json
   { "version": "2024.2", "scannedAt": "2026-05-12T...", "ipdefs": ["xilinx.com:ip:fifo_generator:13.2", ...] }
   ```
7. Clean up temp files
8. Return `{ count, catalogPath }`

**`loadCachedCatalog()`**: reads catalog.json, returns the `ipdefs` array or empty array.

---

#### `src/data/xilinxCatalog.ts`

Static fallback list of common Xilinx IPs.

```typescript
export const XILINX_COMMON_IPS: string[] = [
  'xilinx.com:ip:fifo_generator:13.2',
  'xilinx.com:ip:axi_interconnect:2.1',
  'xilinx.com:ip:clk_wiz:6.0',
  'xilinx.com:ip:axi_dma:7.1',
  'xilinx.com:ip:axi_gpio:2.0',
  'xilinx.com:ip:axi_bram_ctrl:4.1',
  'xilinx.com:ip:proc_sys_reset:5.0',
  'xilinx.com:ip:xlconcat:2.1',
  'xilinx.com:ip:xlslice:1.0',
  'xilinx.com:ip:axis_data_fifo:2.0',
  'xilinx.com:ip:axi_crossbar:2.1',
  'xilinx.com:ip:blk_mem_gen:8.4',
  'xilinx.com:ip:ila:6.2',
  'xilinx.com:ip:vio:3.0',
  'xilinx.com:ip:axi_protocol_converter:2.1',
  'xilinx.com:ip:axi_clock_converter:2.1',
  'xilinx.com:ip:util_vector_logic:2.0',
  'xilinx.com:ip:axi_uartlite:2.0',
  'xilinx.com:ip:axi_timer:2.0',
  'xilinx.com:ip:axi_intc:4.1',
];
```

---

#### `src/commands/scanVivadoCatalog.ts`

Command handler for `fpga-ip-core.scanVivadoCatalog`.

```typescript
export async function scanVivadoCatalogCommand(): Promise<void> {
  // Show progress notification
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning Vivado IP catalog...' },
    async () => {
      const scanner = new VivadoCatalogScanner();
      const result = await scanner.scan();
      void vscode.window.showInformationMessage(
        `Found ${result.count} IPs. Catalog saved to ${result.catalogPath}`
      );
    }
  );
}
```

---

#### `src/webview/ipcore/components/sections/SubcoresEditor.tsx`

New React component for the Dependencies tab.

**Props**: `{ subcores: (string | { vlnv: string; path?: string })[]; onUpdate: YamlUpdateHandler }`

**Layout** (follow the same style patterns as `MemoryMapsEditor.tsx` and `FileSetsEditor.tsx`):

1. **Header**: "Dependencies" title
2. **List of current subcores**: each entry shows:
   - VLNV string in monospace font
   - Path label (if present, shown in smaller text below)
   - Delete button (`codicon-close`) that calls `onUpdate(['subcores'], filteredArray)`
   - "Open" button (`codicon-go-to-file`) that sends `vscode.postMessage({ type: 'openFile', path })` -- only shown if path is set
3. **"Add Dependency" button** at the bottom: sends `vscode.postMessage({ type: 'addSubcore' })`
4. **Empty state**: dashed border box with "No dependencies declared." text and the add button

**Message handling**: listen for `subcoreAdded` message from the extension host:
```typescript
window.addEventListener('message', (event) => {
  if (event.data.type === 'subcoreAdded') {
    const newVlnv = event.data.vlnv as string;
    const currentSubcores = [...(subcores ?? [])];
    currentSubcores.push(newVlnv);
    onUpdate(['subcores'], currentSubcores);
  }
});
```

**Style**: use `var(--vscode-*)` tokens matching the existing sections. Use `sectionStyle`, `labelStyle` patterns from `GeneratorPanel.tsx`.

---

### 5.2 Modified files

---

#### `ipcraft-spec/schemas/ip_core.schema.json`

Add to `$defs`:
```json
"SubcoreRef": {
  "additionalProperties": false,
  "description": "Sub-IP core reference with optional path override.",
  "properties": {
    "vlnv": {
      "type": "string",
      "pattern": "^[^:]+:[^:]+:[^:]+:[^:]+$",
      "description": "Colon-separated VLNV: vendor:library:name:version"
    },
    "path": {
      "type": "string",
      "description": "Relative path to the sub-IP project root"
    }
  },
  "required": ["vlnv"],
  "type": "object"
}
```

Add `subcores` to `IpCore.properties` (at the end, after `parameters`):
```json
"subcores": {
  "description": "Sub-IP core dependencies",
  "items": {
    "oneOf": [
      { "type": "string", "pattern": "^[^:]+:[^:]+:[^:]+:[^:]+$" },
      { "$ref": "#/$defs/SubcoreRef" }
    ]
  },
  "type": "array"
}
```

---

#### `src/generator/types.ts`

Add interface and extend `IpCoreData`:

```typescript
export interface SubcoreRef {
  vlnv: string;   // colon-separated
  path?: string;
}
```

Add `subcores?: SubcoreRef[]` to `IpCoreData`.

---

#### `src/webview/types/ipCore.d.ts`

Add to `IpCore` interface:

```typescript
subcores?: (string | { vlnv: string; path?: string })[];
```

Note: this file is auto-generated by `npm run generate-types`. After updating the schema, re-run the script. If the auto-generation does not pick up `subcores`, add it manually.

---

#### `src/generator/VivadoComponentXmlGenerator.ts`

**Add** a new function `renderSubcoreRefs()`:

```typescript
import { parseVlnv } from '../utils/vlnv';

function renderSubcoreRefs(subcores: SubcoreRef[]): string[] {
  if (subcores.length === 0) return [];
  const lines: string[] = [];
  for (const ref of subcores) {
    const v = parseVlnv(ref.vlnv);
    lines.push('      <xilinx:subCoreRef>');
    lines.push(
      `        <xilinx:vlnv xilinx:vendor="${x(v.vendor)}" ` +
      `xilinx:library="${x(v.library)}" ` +
      `xilinx:name="${x(v.name)}" ` +
      `xilinx:version="${x(v.version)}" />`
    );
    lines.push('      </xilinx:subCoreRef>');
  }
  return lines;
}
```

**Modify** `renderVendorExtensions()` (or wherever `<xilinx:coreExtensions>` is built): accept `subcores` parameter, insert the output of `renderSubcoreRefs()` after `coreRevision` and before the closing `</xilinx:coreExtensions>`.

**Modify** `generateComponentXml()`: read `subcores` from `IpCoreData`, pass to `renderVendorExtensions()`.

---

#### `src/generator/registerProcessor.ts`

**Modify** `normalizeIpCoreData()`: add subcores normalization after the existing `memory_maps` normalization:

```typescript
const rawSubcores = ((raw.subcores as unknown[]) ?? []);
// ... in the return object:
subcores: rawSubcores.map(sc => {
  if (typeof sc === 'string') return { vlnv: sc };
  const obj = sc as Record<string, unknown>;
  return { vlnv: getString(obj.vlnv), ...(obj.path ? { path: getString(obj.path) } : {}) };
}),
```

---

#### `src/parser/ComponentXmlParser.ts`

**Modify** `parseComponentXmlText()`: after existing vendor extensions parsing, extract `<xilinx:subCoreRef>` elements.

Find the `vendorExtensions` element, then `coreExtensions`, then iterate `subCoreRef` children. For each, extract the 4 VLNV attributes from the `<xilinx:vlnv>` child element and format as a colon-separated string.

```typescript
// After existing parsing, before returning ipObj:
const vendorExtEl = /* find spirit:vendorExtensions element */;
if (vendorExtEl) {
  // getElementsByTagName with namespace or simple tag matching
  const subCoreRefEls = /* find all xilinx:subCoreRef elements */;
  const subcores: string[] = [];
  for (const scRef of subCoreRefEls) {
    const vlnvEl = /* find xilinx:vlnv child */;
    if (vlnvEl) {
      const vendor = vlnvEl.getAttribute('xilinx:vendor') ?? '';
      const library = vlnvEl.getAttribute('xilinx:library') ?? '';
      const name = vlnvEl.getAttribute('xilinx:name') ?? '';
      const version = vlnvEl.getAttribute('xilinx:version') ?? '';
      if (vendor && library && name && version) {
        subcores.push(`${vendor}:${library}:${name}:${version}`);
      }
    }
  }
  if (subcores.length > 0) {
    ipObj.subcores = subcores;
  }
}
```

Note: The existing parser uses `@xmldom/xmldom`. Use `getElementsByTagName` or manual child traversal matching the patterns already used in the file.

---

#### `src/webview/ipcore/hooks/useNavigation.ts`

Add `'subcores'` to the `Section` union type, between `'busInterfaces'` and `'memoryMaps'`:

```typescript
export type Section =
  | 'metadata'
  | 'clocks'
  | 'resets'
  | 'ports'
  | 'busInterfaces'
  | 'subcores'       // NEW
  | 'memoryMaps'
  | 'parameters'
  | 'fileSets'
  | 'generate';
```

---

#### `src/webview/ipcore/components/layout/NavigationSidebar.tsx`

Add entry in the `SECTIONS` array after the `busInterfaces` entry and before `memoryMaps`:

```typescript
{
  id: 'subcores',
  label: 'Dependencies',
  icon: 'extensions',
  count: (ip) => {
    const subcores = (ip as Record<string, unknown[]>)?.subcores;
    return Array.isArray(subcores) ? subcores.length : 0;
  },
},
```

---

#### `src/webview/ipcore/components/layout/EditorPanel.tsx`

Add import for `SubcoresEditor` and add case in `renderSection()`:

```typescript
import { SubcoresEditor } from '../sections/SubcoresEditor';

// In renderSection():
case 'subcores':
  return <SubcoresEditor subcores={ip.subcores ?? []} onUpdate={onUpdate} />;
```

---

#### `src/providers/IpCoreEditorProvider.ts`

Add handler for the `addSubcore` message type in `registerWebviewMessageHandlers()`:

```typescript
addSubcore: async () => {
  await this.handleAddSubcoreMessage(webviewPanel);
},
```

Add method `handleAddSubcoreMessage()`:

```typescript
private async handleAddSubcoreMessage(
  webviewPanel: vscode.WebviewPanel
): Promise<void> {
  // Get available IPs from SubcoreResolver (accessed via a singleton or passed in)
  const candidates = this.subcoreResolver.getAvailableIps();

  // Build QuickPick items grouped by source
  const items: vscode.QuickPickItem[] = [];

  // Group: Workspace
  const workspaceIps = candidates.filter(c => c.source === 'workspace');
  if (workspaceIps.length > 0) {
    items.push({ label: 'Workspace IPs', kind: vscode.QuickPickItemKind.Separator });
    items.push(...workspaceIps.map(c => ({
      label: c.vlnv,
      description: c.fsPath ? path.basename(c.fsPath) : undefined,
    })));
  }

  // Group: User repositories
  const repoIps = candidates.filter(c => c.source === 'user-repo');
  if (repoIps.length > 0) {
    items.push({ label: 'User IP Repositories', kind: vscode.QuickPickItemKind.Separator });
    items.push(...repoIps.map(c => ({ label: c.vlnv, description: c.fsPath })));
  }

  // Group: Vivado catalog / builtin
  const catalogIps = candidates.filter(c => c.source === 'vivado-catalog' || c.source === 'builtin');
  if (catalogIps.length > 0) {
    items.push({ label: 'Vivado Catalog', kind: vscode.QuickPickItemKind.Separator });
    items.push(...catalogIps.map(c => ({ label: c.vlnv })));
  }

  // Free-text entry option
  items.push({ label: 'Enter custom VLNV...', kind: vscode.QuickPickItemKind.Default, description: 'vendor:library:name:version' });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an IP dependency (vendor:library:name:version)',
    matchOnDescription: true,
  });

  if (!selected) return;

  let vlnv: string;
  if (selected.label === 'Enter custom VLNV...') {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter VLNV (vendor:library:name:version)',
      placeHolder: 'xilinx.com:ip:fifo_generator:13.2',
      validateInput: (v) => isValidVlnv(v) ? null : 'Format: vendor:library:name:version',
    });
    if (!input) return;
    vlnv = input;
  } else {
    vlnv = selected.label;
  }

  void webviewPanel.webview.postMessage({ type: 'subcoreAdded', vlnv });
}
```

Also: inject `SubcoreResolver` into the provider (construct in constructor, call `initialize()` asynchronously).

---

#### `src/extension.ts`

1. Register new command:
```typescript
import { scanVivadoCatalogCommand } from './commands/scanVivadoCatalog';
safeRegisterCommand(context, 'fpga-ip-core.scanVivadoCatalog', scanVivadoCatalogCommand);
```

2. Initialize `SubcoreResolver` on activation (lazy, non-blocking):
```typescript
void import('./services/SubcoreResolver').then(({ SubcoreResolver }) => {
  const resolver = new SubcoreResolver(context);
  void resolver.initialize();
  // Store on context or export for IpCoreEditorProvider to access
});
```

---

#### `package.json`

Add command:
```json
{
  "command": "fpga-ip-core.scanVivadoCatalog",
  "title": "Scan Vivado IP Catalog",
  "category": "IPCraft"
}
```

Add setting:
```json
"ipcraft.ipRepositoryPaths": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "markdownDescription": "Paths to directories containing IP cores (`.ip.yml` or Vivado `component.xml`). Absolute or relative to workspace root. These IPs appear as dependency candidates."
}
```

---

## 6. Test Plan

### 6.1 Unit tests

| Test file | What to test |
|---|---|
| `src/test/suite/utils/vlnv.test.ts` | `parseVlnv()` valid/invalid/edge cases, `formatVlnv()`, `isValidVlnv()` |
| `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts` | `renderSubcoreRefs()` generates correct XML; `generateComponentXml()` with subcores includes `<xilinx:subCoreRef>` elements |
| `src/test/suite/generator/registerProcessor.test.ts` | `normalizeIpCoreData()` normalizes string and object subcores forms |
| `src/test/suite/parser/ComponentXmlParser.test.ts` | Round-trip: XML with `<xilinx:subCoreRef>` parses back to subcores array |

### 6.2 Lint

`npm run lint` must pass with zero warnings.

### 6.3 Manual verification

- Generate component.xml from an `.ip.yml` with subcores, open in Vivado IP Packager
- Test webview Dependencies tab: add, remove, display
- Run `IPCraft: Scan Vivado IP Catalog` with/without Vivado installed
- Verify catalog stored in `~/.config/ipcraft/vivado/catalog.json`

## 7. Implementation Order

Execute in this order to minimize broken intermediate states:

1. `src/utils/vlnv.ts` + tests
2. `src/generator/types.ts` (add `SubcoreRef`, extend `IpCoreData`)
3. `src/generator/registerProcessor.ts` (normalize subcores)
4. `src/generator/VivadoComponentXmlGenerator.ts` (render subcores in XML)
5. `src/parser/ComponentXmlParser.ts` (parse subcores from XML)
6. `ipcraft-spec/schemas/ip_core.schema.json` (schema update)
7. `src/webview/types/ipCore.d.ts` (add subcores to IpCore)
8. `src/data/xilinxCatalog.ts` (static fallback)
9. `src/services/VivadoCatalogScanner.ts`
10. `src/services/SubcoreResolver.ts`
11. `src/commands/scanVivadoCatalog.ts`
12. `src/webview/ipcore/hooks/useNavigation.ts` (add section)
13. `src/webview/ipcore/components/sections/SubcoresEditor.tsx`
14. `src/webview/ipcore/components/layout/NavigationSidebar.tsx` (add entry)
15. `src/webview/ipcore/components/layout/EditorPanel.tsx` (add case)
16. `src/providers/IpCoreEditorProvider.ts` (handle addSubcore message)
17. `src/extension.ts` (register command, init resolver)
18. `package.json` (command + setting)
19. Run `npm run lint`, fix any issues
20. Run tests
