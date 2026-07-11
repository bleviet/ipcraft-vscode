# IPCraft for VS Code — Software Architecture Document

> Originally reverse-engineered from the codebase at version 0.2.0 (June 2026); updated to
> track the architecture as of 0.8.6. Every statement in this document is derived from reading
> the actual source; where the implementation still diverges from the ideal architecture, the
> divergence is documented as-is and flagged in
> [§7 Technical Debt](#7-technical-debt--vibe-code-assessment) (the V-1…V-10 items there are
> historical — resolved, kept for context).
>
> Companion documents: [overview.md](overview.md), [extension-host.md](extension-host.md),
> [webview.md](webview.md), [technical-debt.md](technical-debt.md) (actionable TD items TD-1…TD-5).

---

## 1. Executive Summary

`ipcraft-vscode` is a VS Code extension for designing FPGA IP cores. It treats two YAML file
types as the **Single Source of Truth (SSOT)**:

| File | Content | Custom editor |
| --- | --- | --- |
| `*.ip.yml` | IP core definition: VLNV identity, clocks, resets, ports, bus interfaces, parameters, file sets, simulation config | `fpgaIpCore.editor` (canvas-based React app, `ipcore.js` bundle) |
| `*.mm.yml` | Memory map: memory maps → address blocks → registers / register arrays → bit fields | `fpgaMemoryMap.editor` (outline + details React app, `webview.js` bundle) |

Around these files the extension provides:

1. **Two-way-synced visual editing.** Each custom editor is a React webview that renders the
   parsed YAML and writes edits back to the `TextDocument` through `postMessage`. The text
   document remains authoritative; the user can switch to the raw text editor at any time
   (`fpga-ip-core.openAsText`) and both views stay consistent.
2. **Code generation.** A scaffold-pack-driven Nunjucks pipeline turns `.ip.yml` (+ referenced
   `.mm.yml`) into RTL (VHDL/SystemVerilog), register files, testbenches (CocoTB/VUnit),
   vendor packaging (`component.xml` for Vivado, `*_hw.tcl` for Quartus Platform Designer),
   and project/build scripts.
3. **Toolchain integration.** Detection and launching of Vivado/Quartus (native or Docker),
   OOC synthesis builds, report parsing into a tree view, and experimental importers
   (VHDL, `_hw.tcl`, `component.xml` → `.ip.yml`).

The architecture has three hard process boundaries: the **extension host** (Node.js),
the **webviews** (browser sandbox, one per open editor), and **external EDA tools**
(child processes). All cross-boundary communication is asynchronous message passing or
file I/O — there is no shared memory.

---

## 2. Domain Data Model

### 2.1 `.ip.yml` — IP core definition

JSON Schema: `ipcraft-spec/schemas/ip_core.schema.json` (copied into `dist/resources/schemas/`
at build time; AJV-validated in `IpCoreScaffolder.loadIpCore`). Root keys:

```yaml
vlnv: { vendor, library, name, version }   # identity — REQUIRED; presence of `vlnv` is how
                                           # IpCoreEditorProvider detects an IP core file
description: ...
scaffold_pack: builtin-ipcraft            # per-file generator pack selection (round-trips)
clocks:      [{ name, logicalName, direction, frequency, associatedReset, ... }]
resets:      [{ name, polarity, associatedClock, ... }]
interrupts:  [{ name, logicalName, ... }]
ports:       [{ name, direction, width, type, ... }]          # raw conduit ports
busInterfaces:
  - name: s_axi
    type: axi4lite                         # resolved against the bus definition library
    mode: slave
    physicalPrefix: s_axi_
    associatedClock: clk
    associatedReset: rst_n
    memoryMapRef: CSR_MAP                  # cross-file link into a memory map by NAME
    array: { count, indexStart, namingPattern, physicalPrefixPattern }   # replicated interfaces
memoryMaps:                                # inline maps OR per-entry { import: file.mm.yml }
  - import: ./regs.mm.yml
parameters:  [{ name, value, dataType, ... }]
fileSets:    [{ name, files: [{ path, type, managed, ... }] }]   # generator writes back here
subcores:    [...]                         # hierarchical composition
simulation:  { framework, engine, compileArgs, simArgs, env }
targets:     [...]                         # replaces legacy `vendor:` (migration command exists)
useBusLibrary: ./bus_defs                  # per-IP custom bus definition directory
```

Key relationship: `busInterfaces[].memoryMapRef` refers to `memoryMaps[].name`. The referenced
entry may itself be an `import:` pointing at a `.mm.yml` file — `ImportResolver` (editor display)
and `registerProcessor.resolveMemoryMaps` (generation) both follow the import and merge
entry-level overrides (e.g. `name`) over the imported file's content.

### 2.2 `.mm.yml` — memory map

JSON Schema: `ipcraft-spec/schemas/memory_map.schema.json`. The document root is a **list** of
memory maps (the webview also tolerates a single object or a `memory_maps:` wrapper —
see `useMemoryMapState.parseAndNormalize` and `YamlPathResolver.getMapRootInfo`).

Hierarchy:

```yaml
- name: CSR_MAP                  # MemoryMap
  addressBlocks:
    - name: CONTROL_REGS         # AddressBlock
      baseAddress: 0
      range: 4K                  # int or "4K"/"1M" strings
      usage: register            # register | memory | reserved
      defaultRegWidth: 32
      registers:
        - name: CTRL             # RegisterDef (single register)
          offset: 0
          access: read-write
          fields:
            - name: ENABLE       # BitFieldDef
              bits: '[0:0]'      # OR offset+width — both spellings in the schema
              access: read-write
              resetValue: 0
        - name: CHANNEL          # RegisterDef used as a REGISTER ARRAY:
          count: 4               # count + stride + nested `registers:` =
          stride: 64             # array of register groups
          registers:
            - { name: CTRL, offset: 0, fields: [...] }
            - { name: STATUS, offset: 4, fields: [...] }
```

A `RegisterDef` is polymorphic: with `count`/`stride`/nested `registers` it represents an
array of register groups; without them it is a single register with `fields`.

Access types: `read-only`, `write-only`, `read-write`, `write-1-to-clear`,
`read-write-1-to-clear`. W1C fields may carry `monitorChangeOf` (change-of-state monitoring,
extension-specific).

### 2.3 ER diagram (mm.yml structure)

```mermaid
erDiagram
    MM_YML_FILE ||--|{ MEMORY_MAP : "root list"
    MEMORY_MAP ||--o{ ADDRESS_BLOCK : addressBlocks
    ADDRESS_BLOCK ||--o{ REGISTER_DEF : registers
    REGISTER_DEF ||--o{ BIT_FIELD : "fields (single register)"
    REGISTER_DEF ||--o{ REGISTER_DEF : "registers (array: count+stride)"
    IP_YML_FILE ||--o{ BUS_INTERFACE : busInterfaces
    IP_YML_FILE ||--o{ MEMORY_MAP : "memoryMaps (inline or import)"
    BUS_INTERFACE }o--o| MEMORY_MAP : "memoryMapRef (by name)"

    MEMORY_MAP {
        string name PK
        string description
        string import "optional file reference"
    }
    ADDRESS_BLOCK {
        string name
        int baseAddress
        string range "int or 4K/1M"
        enum usage "register|memory|reserved"
        int defaultRegWidth
    }
    REGISTER_DEF {
        string name
        int offset
        int size
        enum access
        int resetValue
        int count "array only"
        int stride "array only"
    }
    BIT_FIELD {
        string name
        string bits "[msb:lsb]"
        enum access
        int resetValue
        object enumeratedValues
    }
    BUS_INTERFACE {
        string name
        string type
        enum mode
        string physicalPrefix
        string memoryMapRef FK
    }
```

### 2.4 The dual-spelling problem (schema vs. webview internals)

The schemas use **camelCase** (`addressBlocks`, `resetValue`, `defaultRegWidth`) but the memory
map webview internally normalizes to **snake_case** (`address_blocks`, `reset_value`,
`bit_offset`/`bit_width` instead of `bits`). Conversion now happens through one boundary module,
`src/domain/` (this used to be split across a `DataNormalizer`/`YamlSanitizer` pair, since
removed — see resolved item V-1 in §7):

- `normalizeMemoryMap` / `parseMemoryMap` (`src/domain/parse.ts`): YAML → normalized internal
  model, adding a UI-only `rowId` (see [CLAUDE.md](../../CLAUDE.md) "rowId is UI-only identity").
- `serializeValue` / `serializeMemoryMap` (`src/domain/serialize.ts`): internal model → schema
  keys before writing back (`bit_offset`+`bit_width` recombined into a `bits: '[msb:lsb]'`
  string; strips `rowId` and `__kind`).
- `YamlPathResolver.KEY_ALIASES`: path navigation still falls back from `addressBlocks` to
  `address_blocks` so both spellings in hand-written user files keep working.

This is a deliberate tolerance for hand-written files, but it still means **two key
vocabularies coexist at the boundary** (schema camelCase, legacy snake_case tolerated on read) —
narrower than before since the internal normalized form now has exactly one producer/consumer
pair instead of three independent conversion sites.

---

## 3. System Architecture

### 3.1 C4 system context

```mermaid
C4Context
    title IPCraft VS Code Extension — System Context
    Person(user, "FPGA Engineer", "Designs IP cores and register maps")
    System_Boundary(vscode, "VS Code") {
        System(ext, "IPCraft Extension Host", "Node.js: providers, commands, generator, toolchain services")
        System(wv_mm, "Memory Map Webview", "React app (webview.js), sandboxed")
        System(wv_ip, "IP Core Webview", "React canvas app (ipcore.js), sandboxed")
    }
    SystemDb(fs, "File System (SSOT)", ".ip.yml / .mm.yml + generated RTL, TB, vendor packaging")
    System_Ext(vivado, "AMD Vivado", "component.xml packaging, OOC synthesis, .xpr projects")
    System_Ext(quartus, "Intel Quartus / Platform Designer", "_hw.tcl, .qpf projects")
    System_Ext(sim, "Simulators", "GHDL / Questa / Verilator via CocoTB or VUnit")

    Rel(user, wv_mm, "edits registers/fields visually")
    Rel(user, wv_ip, "edits IP core on canvas")
    Rel(user, ext, "runs commands (generate, build, import)")
    BiRel(wv_mm, ext, "postMessage: update / command")
    BiRel(wv_ip, ext, "postMessage: update / generate / staging")
    BiRel(ext, fs, "TextDocument edits, file generation, watchers")
    Rel(ext, vivado, "spawn (native or Docker)")
    Rel(ext, quartus, "spawn (native or Docker)")
    Rel(fs, sim, "generated testbench drives")
```

### 3.2 Boundaries and ownership

| Boundary | Owns | Must not |
| --- | --- | --- |
| **Extension host** (`src/` minus `src/webview/`) | `TextDocument` lifecycle, file I/O, YAML validation (AJV), import resolution, generation, toolchain spawning, VS Code UI (commands, trees, status bar) | Render editor UI |
| **Webviews** (`src/webview/`) | Parsing/normalizing YAML text for display, editing state (drafts, selection, undo), serializing edits back to full YAML text | Touch the file system, run commands directly (the `command` message is allow-listed host-side) |
| **File system** | The authoritative content; generated artifacts | — |
| **Generators** (`src/generator/`) | Pure(ish) text-in/text-out rendering; dry-run produces an in-memory `Record<relativePath, content>` | Write to disk during dry run |

Security posture worth noting (both deliberate, post-hoc hardening): the IP Core provider
restricts `localResourceRoots` to `dist/` + codicons, and the generic `command` message from
the webview is checked against `WEBVIEW_COMMAND_ALLOWLIST`
(`IpCoreEditorProvider.ts`).

### 3.3 Component diagram

```mermaid
graph TB
    subgraph host["Extension Host (Node)"]
        EXT[extension.ts<br/>activate: registers everything]
        subgraph providers["Providers"]
            MMP[MemoryMapEditorProvider]
            IPP[IpCoreEditorProvider<br/>own messageHandlers table + watchers]
            SPP[IpCoreSourcePreviewProvider]
            SB[WebviewStagingBridge<br/>singleton]
            SCP[StagingContentProvider<br/>virtual staging:// docs]
            TPP[TemplatePreviewProvider<br/>.j2 live preview]
        end
        subgraph services["Services"]
            WR[WebviewRouter<br/>revisioned update/command dispatch]
            DM[DocumentManager<br/>serialized WorkspaceEdit queue]
            YV[YamlValidator AJV]
            IR[ImportResolver<br/>mm.yml + fileset + bus lib]
            HG[HtmlGenerator]
            TD2[ToolDetector / BuildRunner / ReportParser]
        end
        subgraph generator["Generator"]
            SC[IpCoreScaffolder.generateAll]
            SPL[ScaffoldPackLoader<br/>scaffold.yml manifests]
            TL[TemplateLoader<br/>Nunjucks, multi-root search]
            RP[registerProcessor<br/>bus expansion, register prep]
            TB[testbench/<br/>Framework x Engine strategies]
            TCH[toolchains/<br/>Vivado + Quartus strategies]
        end
        CMD[commands/<br/>GenerateCommands.runGenerator<br/>BuildCommands, importers]
    end

    subgraph wvmm["Memory Map Webview (webview.js)"]
        MMAPP[index.tsx App]
        MMSTATE[useMemoryMapState<br/>rawTextRef + normalized model]
        MMSYNC[useYamlSync<br/>window message listener]
        MMUPD[useYamlUpdateHandler<br/>path edits]
        YS[YamlService.applyPathEdits<br/>comment-preserving merge]
        DN[domain/parse.ts<br/>normalizeMemoryMap / parseMemoryMap]
        ALG[algorithms/<br/>LayoutEngine, Repackers, MutationService]
    end

    subgraph wvip["IP Core Webview (ipcore.js)"]
        IPAPP[IpCoreApp.tsx]
        IPSTATE[useIpCoreState<br/>doc.setIn full reserialize]
        IPSYNC[useIpCoreSync<br/>500ms debounced full-text push]
        UNDO[useCanvasUndo]
    end

    EXT --> providers
    EXT --> CMD
    MMP --> WR --> DM
    MMP --> HG
    IPP --> WR
    IPP --> IR
    IPP --> SB
    CMD --> SC
    SC --> SPL & TL & RP & TB & TCH
    CMD --> SB
    SB --> SCP
    MMP <-->|postMessage| MMAPP
    IPP <-->|postMessage| IPAPP
    MMAPP --> MMSTATE & MMSYNC & MMUPD
    MMUPD --> YS
    MMSTATE --> DN
    MMAPP --> ALG
    IPAPP --> IPSTATE & IPSYNC & UNDO
```

Bundling: webpack builds three entries — `dist/extension.js` (Node target), `dist/webview.js`
(memory map app), `dist/ipcore.js` (IP core app). `HtmlGenerator` selects the script per
editor type. Webviews use `retainContextWhenHidden: true`.

---

## 4. Data Flow & State Management

### 4.1 The authoritative loop

The `TextDocument` (in-memory VS Code buffer of the YAML file) is the single source of truth.
Webviews never hold a divergent model for long — every edit is immediately serialized to full
YAML text and pushed to the host, and every document change is echoed back to the webview.

**Exact lifecycle of one memory map edit** (e.g. user renames a bit field and presses Enter):

```mermaid
sequenceDiagram
    participant U as User
    participant C as Cell component<br/>(FieldTableRow)
    participant H as useYamlUpdateHandler
    participant Y as YamlService.applyPathEdits
    participant S as useMemoryMapState
    participant B as postMessage bridge
    participant WR as WebviewRouter (host)
    participant DM as DocumentManager
    participant DOC as TextDocument (SSOT)
    participant P as MemoryMapEditorProvider

    U->>C: types, Enter (blur commits)
    C->>H: onUpdate(['fields', i, 'name'], value)
    H->>Y: applyPathEdits(rawTextRef.current, [{path, value}])
    Note over Y: parseDocument + node-reuse merge —<br/>untouched lines keep comments,<br/>hex spellings, formatting
    Y-->>H: newText (or identical text on no-op)
    H->>S: updateRawText(newText)
    Note over S: optimistic local update:<br/>rawTextRef + re-parse + re-render
    H->>B: buildUpdateMessage — postMessage {type:'update', text, editId, baseDocVersion}
    B->>WR: on('update')
    WR->>DM: updateDocument(document, text, baseDocVersion)
    Note over DM: per-URI promise chain serializes<br/>concurrent edits; rejects if baseDocVersion is stale
    DM->>DOC: WorkspaceEdit.replace(entire range)
    DOC-->>P: onDidChangeTextDocument
    P->>WR: handleDocumentChange
    WR->>B: postUpdate {type:'update', text, docVersion, sourceEditId}
    B->>S: useYamlSync → shouldApplyUpdate(revisionState, update)
    Note over S: drops if docVersion <= seenDocVersion<br/>or sourceEditId <= lastSentEditId (echo of our own edit);<br/>forceResync:true always applies (host rejected a stale base)
    Note over DOC: file stays DIRTY —<br/>user saves via Ctrl+S as usual
```

Saving is the standard VS Code dirty-document flow; the webview can also request it via
`{type:'command', command:'save'}`. The `editId`/`docVersion` pairing is the revisioned sync
protocol (`src/services/WebviewRouter.ts` host-side, `src/webview/sync/revisionFilter.ts`
webview-side pure functions) — see [CLAUDE.md](../../CLAUDE.md#revisioned-sync-protocol-v-3v-4)
for the FIFO contract it replaces the old byte-equality echo suppression with.

### 4.2 The two editors implement this loop differently

| Aspect | Memory Map editor | IP Core editor |
| --- | --- | --- |
| Local model | Normalized snake_case model + `rawTextRef` (text is primary) | Parsed JS object + `rawYaml` string in one state |
| Edit serialization | `YamlService.applyPathEdits` — surgical node-reuse merge, preserves comments/hex/format of untouched nodes, restores hex spellings post-stringify | `yaml.parseDocument` + `doc.setIn(path)` + full `toString` per edit (`useIpCoreState.updateIpCore`) |
| Push to host | Immediate, per edit | **Debounced 500 ms** full-text push (`useIpCoreSync` effect on `rawYaml`) |
| Undo | VS Code text-document undo only | `useCanvasUndo` snapshot stack **plus** VS Code undo |
| Host message dispatch | `WebviewRouter.useStandardDocumentHandlers` (`update`/`command`) | Same `WebviewRouter`, plus a provider-local table of IP-core-specific message types registered via `router.on(...)` |
| Initial handshake | Webview sends `ready`, `WebviewRouter` flushes queued updates | Same `ready`-gated flush (no timer) |

Both providers re-push the full document on `onDidChangeTextDocument`, so external edits
(raw text editor, git checkout) propagate into open webviews automatically. The IP core
provider additionally re-pushes on config changes (HDL language, scaffold pack, toolbar
targets, bus library paths) and on file-watcher events for generated artifacts
(`component.xml`, `*_hw.tcl`, `.xpr`, `.qpf`) so toolbar button enablement stays current.

### 4.3 Race-condition mitigations that exist (and what they tell us)

These mitigations were each added in response to an observed corruption/glitch (visible in
git history) — they are load-bearing:

- **`DocumentManager.updateQueues`** — per-document promise chain. Reason documented in
  source: a full-range replace computed against a stale document leaves "a tail of the
  previous content behind."
- **Single-pass structural edits** — `index.tsx handleUpdateWithRepack` merges structural
  edit + layout repack + sanitize into *one* document update, with a comment stating that
  two back-to-back updates "can corrupt the file when the second edit races the first one
  in the extension host."
- **No-op suppression** — `applyPathEdits` returns the identical string when nothing changed;
  callers compare by identity before sending. `DocumentManager.performUpdate` also skips
  when text is equal, which breaks echo loops.
- **Draft state in cells** — editable cells keep keystrokes in local draft maps
  (`nameDrafts`, `bitsDrafts`, …) so the echo re-render does not clobber in-progress typing;
  `useCellEditGuard` snapshots rows on focus for ESC-revert and blur-commit on Enter.
- **Revisioned sync protocol** — `WebviewRouter` stamps every `update` with `docVersion` and
  rejects edits whose `baseDocVersion` is stale (replying `forceResync: true`); the webview
  stamps every edit with a monotonic `editId` and drops echoes/out-of-order updates via
  `revisionFilter.shouldApplyUpdate`. Both editors share this (`src/services/WebviewRouter.ts`,
  `src/webview/sync/revisionFilter.ts`) — it replaced the byte-equality echo suppression that
  used to be the only defense against a slow echo re-parsing stale text after a newer local edit.

### 4.4 Auxiliary data flows

- **Import resolution (display):** on every IP core webview update, `ImportResolver` follows
  `memoryMaps[].import`, `fileSets[].import`, and `useBusLibrary` relative to the document and
  ships the resolved objects alongside the raw text, so the canvas can render register counts
  and validate `memoryMapRef` without file access.
- **Staging bridge:** generation results are staged in memory; `WebviewStagingBridge`
  (singleton, keyed by `.ip.yml` fsPath) shows the confirm overlay inside the canvas webview
  when one is open, else falls back to a standalone `StagingPanel`. Diff/preview use virtual
  documents under the `staging://` scheme fed by `StagingContentProvider`.

---

## 5. Code Generation Pipeline

### 5.1 Trigger surface

All generation funnels into `GenerateCommands.runGenerator()`. Triggers: command palette /
explorer context menu commands (`generateHdl`, `scaffoldProject`, `exportXilinx`,
`exportAltera`, `generateTestbench`, `generateVivadoProject`, …) and toolbar buttons inside
the IP core webview, which post `{type:'command', command:'fpga-ip-core.*'}` through the
allow-list, or `{type:'generate'}` handled by `IpCoreGenerateHandler`.

### 5.2 Four-phase execution (`runGenerator`)

1. **Dry run.** `new IpCoreScaffolder(...).generateAll(inputPath, outputDir, {dryRun: true})`
   produces `generatedContents: Record<relativePath, string>` entirely in memory.
2. **Categorize.** Each generated file is compared against disk → `new` / `modified` /
   `unchanged`, with `protectedPaths` flagged (pack rules with `managed: false` — user-owned
   files the generator must not overwrite once they exist).
3. **Confirm.** Staged list shown in the canvas overlay (via `WebviewStagingBridge`) or the
   standalone `StagingPanel`; user can inspect per-file diffs before accepting.
4. **Write.** Only `new`+`modified`, minus protected-existing. Optionally writes back
   `fileSets:` and `scaffold_pack:` into the `.ip.yml` (`updateYaml` option) so the SSOT
   records what was generated.

### 5.3 Inside `IpCoreScaffolder.generateAll`

```
load .ip.yml ──► AJV validate (ip_core.schema.json)
              ──► normalizeIpCoreData (registerProcessor)
              ──► bus expansion: busInterfaces[].array → N concrete interfaces;
                  port lists resolved from the bus definition library
                  (built-in dist/resources/bus_definitions + useBusLibrary overrides)
              ──► resolveMemoryMaps: follow mm.yml imports, prepareRegisters
                  (flatten arrays, compute offsets/widths for templates)
              ──► resolve scaffold pack:
                  options.scaffoldPack > .ip.yml scaffold_pack > legacy IPCraft flag
                  search: .vscode/ipcraft/packs/<name>/ then built-in dist/packs/<name>/
              ──► for each pack file rule {source, target, condition, managed}:
                  Nunjucks-render condition + source/target names + template content
              ──► testbench files: Framework (CocoTB|VUnit) × Engine (GHDL|Questa|Verilator…)
                  strategy classes under generator/testbench/
              ──► per-target vendor packaging via toolchain strategies
                  (VivadoToolchain → component.xml + TCL; QuartusToolchain → _hw.tcl)
```

**Scaffold packs** are the extensibility mechanism: a pack is a directory with a
`scaffold.yml` manifest (`files[]` rules, `fullGeneration` flag) plus `.j2` templates that
shadow the built-in template directory via `TemplateLoader`'s ordered multi-root search.
Built-ins: `builtin-minimal`, `builtin-ipcraft`, plus example packs. Workspace packs live in
`.vscode/ipcraft/packs/` and can be exported from built-ins
(`fpga-ip-core.exportScaffoldPack`). `TemplatePreviewProvider` renders `.j2` files live
against a pinned IP core. Conditions in `scaffold.yml` are Nunjucks boolean expressions
evaluated in the sandbox (`TemplateLoader.evaluateCondition`), not `eval`.

`fullGeneration: false` packs deliberately suppress the bus/register context
(`has_memory_mapped_slave` forced false) so the rendered top-level has an empty architecture
and the testbench doesn't import a register package that was never generated.

### 5.4 Build integration

`BuildCommands` + `BuildRunner` spawn the vendor tools (native install dir or Docker image,
per `ipcraft.{vivado,quartus}.runner` settings). `ToolDetector` probes installs and sets
context keys (`ipcraft.vivadoFound`, …) that grey out commands. `ReportParser` +
`ReportsTreeProvider` surface timing/utilization reports in a tree view.

---

## 6. Module Inventory (where to look)

| Concern | Location |
| --- | --- |
| Activation, command registry | `src/extension.ts` |
| Custom editor providers | `src/providers/{MemoryMap,IpCore}EditorProvider.ts` |
| Host-side message dispatch | `src/services/WebviewRouter.ts` (shared by both providers; revisioned `update`/`command` protocol) + provider-local handler table in `IpCoreEditorProvider` registered via `router.on(...)` |
| Revisioned sync protocol (webview side) | `src/webview/sync/revisionFilter.ts` (pure functions, unit-tested directly) |
| Serialized document writes | `src/services/DocumentManager.ts` |
| Normalized domain model (shared parse/serialize boundary) | `src/domain/{parse,serialize}.ts` |
| Format-preserving YAML edits (shared module, both editors) | `src/yamledit/` (`applyPathEdits`, `applyPathDeletes`) — `src/webview/services/YamlService.ts` is a thin MM-side static wrapper around it; the IP core editor (`useIpCoreState.ts`) imports it directly |
| Normalization / sanitization (both editors) | `src/domain/parse.ts` (`normalizeMemoryMap`, `normalizeIpCore`) and `src/domain/serialize.ts` (`serializeValue`, `serializeMemoryMap`, `serializeIpCore`) |
| MM layout invariants (bit/register/block packing) | `src/webview/algorithms/LayoutEngine.ts` (`recompute*Layout`, `validateLayout`) |
| IP core canvas state | `src/webview/ipcore/hooks/useIpCoreState.ts`, `useCanvasUndo.ts` |
| Generation orchestration | `src/commands/GenerateCommands.ts` (`runGenerator`) |
| Generator core | `src/generator/IpCoreScaffolder.ts`, `registerProcessor.ts` |
| Scaffold packs | `src/generator/ScaffoldPackLoader.ts`, `src/generator/packs/` |
| Templates | `src/generator/templates/*.j2` (Nunjucks via `TemplateLoader`) |
| Testbench strategies | `src/generator/testbench/{frameworks,engines}/` |
| Vendor toolchains | `src/services/toolchains/` |
| Importers (experimental) | `src/parser/{Vhdl,HwTcl,ComponentXml,Verilog}Parser.ts` |
| Schemas / spec | `ipcraft-spec/` (nested repo; schemas copied to `dist/resources/schemas/`) |
| Vivado interface catalog scan | `src/services/VivadoInterfaceScanner.ts`, `src/parser/VivadoInterfaceXmlParser.ts`, `src/commands/scanVivadoInterfaces.ts` — see [Vivado Interface Catalog](vivado-interface-catalog.md) |

---

## 7. Technical Debt & "Vibe Code" Assessment

The existing [technical-debt.md](technical-debt.md) tracks five scoped items (TD-1…TD-5).
The items below (V-1…V-10) were **architectural** observations from an earlier review of this
codebase. All ten have since been implemented as a dedicated refactor pass — kept here as the
historical record of *why* the current design looks the way it does, since several current
architecture sections above (§2.4, §3.3, §4) directly describe the post-fix state. Each entry
below states the original problem, then how it was actually resolved (verified against the
current source, not just the refactor's stated intent).

### V-1 — Three key vocabularies for the same domain model (RESOLVED)
Schema camelCase (`addressBlocks`, `resetValue`), legacy snake_case accepted in user files,
and the webview's internal normalized form (`bit_offset`/`bit_width`) used to be converted in
three independent places (`DataNormalizer`, `YamlSanitizer`, `YamlPathResolver.KEY_ALIASES`).
**Resolution:** `DataNormalizer`/`YamlSanitizer` were deleted; `src/domain/parse.ts`
(`normalizeMemoryMap`, `normalizeIpCore`) and `src/domain/serialize.ts` (`serializeValue`,
`serializeMemoryMap`, `serializeIpCore`) are now the single parse/serialize boundary shared by
both editors — see §2.4.

### V-2 — Two divergent YAML write paths (RESOLVED)
The MM editor's `applyPathEdits` (node-reuse merge, comment/hex preservation) used to be
markedly more careful than the IP core editor's `doc.setIn` + full restringify, with two
independent `detectIndentSeq` implementations. **Resolution:** `src/yamledit/` is now the one
shared format-preserving edit module (`applyPathEdits`, `applyPathDeletes`,
`detectIndentSeq.ts`); `src/webview/services/YamlService.ts` is a thin MM-side wrapper around
it, and `useIpCoreState.ts` imports it directly.

### V-3 — Echo loop was convention, not contract (RESOLVED)
The webview used to rely on byte-equality with the host echo to suppress churn, with no
version/sequence number — a slow echo could re-parse stale text after a newer local edit.
**Resolution:** the revisioned sync protocol. `WebviewRouter` stamps every `update` with
`docVersion` and rejects stale-`baseDocVersion` edits (`forceResync: true`); the webview
stamps every edit with a monotonic `editId` via `src/webview/sync/revisionFilter.ts`
(`shouldApplyUpdate`, `buildUpdateMessage`), dropping echoes and out-of-order updates as a
FIFO-paired contract rather than an implicit convention. See §4.1's sequence diagram.

### V-4 — IP core debounced full-text push could drop concurrent external edits (RESOLVED)
`useIpCoreSync`'s 500 ms debounced whole-file push used to be last-writer-wins against
concurrent external edits (git, text editor) with no version check. **Resolution:** the same
revisioned protocol from V-3 covers this — `DocumentManager.updateDocument` now takes the
edit's `baseDocVersion` and rejects it (rather than blindly overwriting) if the document moved
on since the webview last saw it.

### V-5 — Dual message-dispatch mechanisms on the host (RESOLVED)
A generic `MessageHandler` used to be the "official" dispatcher while `IpCoreEditorProvider`
grew its own ~20-entry ad hoc `messageHandlers` table, falling back to `MessageHandler` only
when its own table missed. **Resolution:** `MessageHandler.ts` was deleted; `WebviewRouter`
(`src/services/WebviewRouter.ts`) is now the single typed dispatcher for both providers via
`.on(type, handler)`. `IpCoreEditorProvider` still registers its own set of IP-core-specific
message types, but through the router's typed API rather than a separate mechanism.

### V-6 — Handshake belt-and-suspenders (RESOLVED)
`IpCoreEditorProvider.resolveCustomTextEditor` used to implement the `ready` handshake **and**
fire an unconditional `setTimeout(100)` initial update as a leftover race fix. **Resolution:**
both providers now rely solely on `WebviewRouter`'s `ready`-gated pending-update flush
(`isReady` + `pendingUpdates`); the `setTimeout(100)` is gone.

### V-7 — Import resolution duplicated host-side (RESOLVED)
`ImportResolver` (editor display path) and `registerProcessor.resolveMemoryMaps` (generation
path) used to independently implement `.mm.yml` import following and merging. **Resolution:**
both now import the same `resolveMemoryMapImports` from `src/services/imports/`.

### V-8 — Index- and name-keyed draft state in the field editor (RESOLVED)
`useFieldEditor` used to key `nameDrafts` by field **name** but `bitsDrafts`/`resetDrafts` by
row **index**, needing two separate cleanup effects to stay coherent across renames/moves/
inserts. **Resolution:** stable per-row `rowId` (`generateRowId()` in
`src/webview/utils/rowIdentity.ts`, assigned during `src/domain/parse.ts` normalization and
re-matched across reparses by `reconcileRowIds`) now keys draft maps consistently — see
[CLAUDE.md](../../CLAUDE.md) "rowId is UI-only identity, never schema data."

### V-9 — Path-resolution heuristics for packaged vs dev vs test runtime (RESOLVED)
`IP_CORE_SCHEMA_PATH`, `ScaffoldPackLoader.BUILTIN_PACKS_DIR`, and
`TemplateLoader.resolveTemplatesPath` used to each re-derive resource-root paths independently
relative to `__dirname`, each with its own fallback chain. **Resolution:**
`src/services/ResourceRoots.ts` now resolves all resource roots once from
`context.extensionPath` at activation and injects them.

### V-10 — `ipcraft-spec` was an untracked nested repo (RESOLVED)
The schema/spec directory used to sit inside the extension repo without being tracked by it
(`?` in git status), risking silent schema/code drift. **Resolution:** `ipcraft-spec` is now a
proper git submodule (`.gitmodules`); `scripts/check-submodule.js` (run via `npm run pretest`)
fails the build if it's missing, and `git submodule update --init --recursive` is the
documented setup step (see [CLAUDE.md](../../CLAUDE.md)).

### What is genuinely solid

Worth preserving through any refactor: the four-phase staged generation with dry-run +
diff confirmation; the scaffold-pack design (data-driven file rules, sandboxed conditions,
workspace shadowing); `DocumentManager`'s serialized edit queue; `applyPathEdits`' minimal-diff
merge; the toolchain strategy registry; and the webview command allow-list.
