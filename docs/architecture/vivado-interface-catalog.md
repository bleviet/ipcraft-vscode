# Vivado Interface Catalog — Architecture

How a local Vivado installation's IP-XACT interface files become entries in
IPCraft's bus library, and how the inspector and generator each consume them.

See [The Vivado Interface Catalog](../concepts/vivado-interface-catalog.md)
for the reasoning behind this design.

---

## Pipeline overview

```
<vivado>/data/ip/interfaces/**/*.xml         (Vivado's own IP-XACT files)
      |
      v
VivadoInterfaceXmlParser.parseVivadoInterfaceFiles()
      |  joins busDefinition + abstractionDefinition pairs by VLNV
      v
VivadoInterfaceScanner.scan()
      |  writes one YAML file per interface, tagged source: 'vivado'
      v
~/.config/ipcraft/vivado/bus_definitions/*.yml   (global cache, one per machine)
      |
      +---------------------------+---------------------------+
      v                           v                           v
ImportResolver                IpCoreScaffolder          (re-scan replaces
(webview bus library)      .ensureBusDefinitions()       the whole cache dir)
      |                           |
      v                           v
CanvasInspector                 generator/
(Bus Type / Interface Type      VivadoComponentXmlGenerator.ts
 dropdowns, Port Widths,        (busType/abstractionType + portMaps;
 Map Signals dialog)             busdef/*.xml generation skipped
                                  when source === 'vivado')
```

Entry points: `src/commands/scanVivadoInterfaces.ts` (user-triggered scan),
`src/services/ImportResolver.ts` and `src/generator/IpCoreScaffolder.ts`
(consumers, on every webview load / generation run).

---

## Module layout

```
src/parser/
  VivadoInterfaceXmlParser.ts     parses Vivado's IP-XACT XML → VivadoInterfaceDef[]

src/services/
  VivadoInterfaceScanner.ts       walks the install dir, writes the YAML cache
  ImportResolver.ts               (changed) merges the cache into the webview bus library
  BusLibraryService.ts            (unchanged) generic YAML-directory loader, reused as-is

src/utils/
  vivadoResolver.ts               (changed) resolveVivadoInstallDir() extracted for reuse

src/commands/
  scanVivadoInterfaces.ts         "Scan Vivado Interface Catalog" command

src/generator/
  IpCoreScaffolder.ts             (changed) ensureBusDefinitions() merges the cache
  VivadoComponentXmlGenerator.ts  (changed) source-aware generateCustomBusDefs()
  registerProcessor.ts            (changed) conduitPorts null → [] in expandBusInterfaces
  types.ts                        (changed) BusDefinition.source, CustomBusInfo.source

src/webview/ipcore/
  components/canvas/CanvasInspector.tsx        (changed) FuzzySelect, InterfaceTypeField,
                                                ConduitPanel libraryPortDefs branch,
                                                Port Widths filter fix
  components/canvas/MapConduitToBusDialog.tsx  signal-mapping dialog
  hooks/useGroupPorts.ts                       (changed) applyMapConduitToKnownBus()
  data/busDefinitions.ts                       (unchanged) lookupBusDefFromLibrary(),
                                                listLibraryBusTypes()

src/sidebar/
  IpCoreTreeDataProvider.ts       (changed) Quick Actions entries

ipcraft-spec/                     (submodule bump) nullable-field schema change
```

---

## `VivadoInterfaceXmlParser`

Parses raw XML text using `@xmldom/xmldom`, namespaced to
`http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009` (IP-XACT
1685-2009, the same namespace `ComponentXmlParser.ts` already parses).

Vivado ships a `busDefinition` and an `abstractionDefinition` as **separate
files**, with no consistent filename convention (`fifo_write_rtl.xml` for the
abstraction, `fifo_v1_0/component.xml`-adjacent files for the bus
definition). `parseSingleFile()` therefore classifies by **root element**,
not filename:

| Root element | Extracted into |
|---|---|
| `spirit:busDefinition` | `{ busType, description }` |
| `spirit:abstractionDefinition` | `{ busTypeKey, ports[] }` |
| anything else (e.g. Xilinx's proprietary `parameterAbstractionDefinition` for CHI/CPI/CXS/CXL) | skipped |

`parseVivadoInterfaceFiles(fileContents: string[])` is the public entry
point: it parses every file in the input list (which may span many files
across many directories — a single scan covers `data/ip/interfaces/`
recursively), groups `abstractionDefinition`s by their declared `busType`
VLNV, and joins each one to the `busDefinition` with the matching VLNV key.
A `busDefinition` with no matching abstraction (or vice versa) contributes
nothing — both halves are required to produce a usable interface.

### Port extraction and the width-omission rule

For each `<spirit:port>` inside an abstraction definition, the parser reads
the `<spirit:wire><spirit:onMaster>` block (only the master side; the slave
side is the mechanical inverse and the rest of the system already knows how
to flip direction). A port with no `<spirit:wire>` at all — only
`<spirit:transactional>` — is a TLM/socket-level signal, not an RTL one, and
is skipped. If **every** port in a file is transactional-only, the whole
file is skipped (this is how `aximm_tlm.xml`-style files are excluded
without a filename-based heuristic).

```typescript
const port: VivadoBusPortDef = { name: logicalName };
if (widthText) {
  const width = Number(widthText);
  if (Number.isFinite(width)) {
    port.width = width;
  }
}
```

`port.width` is left `undefined` when `<spirit:width>` is absent — this is
not a parsing gap, it is what Vivado's own file says: some logical ports
(notably `fifo_write`'s `WR_DATA`) are deliberately unconstrained because
their real width depends on the FIFO core's configuration, not the
protocol. `src/test/suite/parser/VivadoInterfaceXmlParser.test.ts` fixtures
this exact shape, verified against a real Vivado 2024.2 install, and asserts
`width` is `undefined` for that port — this is the seam the
[Port Widths filter bug](#the-port-widths-filter-bug) below was hiding.

---

## `VivadoInterfaceScanner`

```typescript
async scan(): Promise<{ count: number; cacheDir: string; version: string }>
```

1. Reads `ipcraft.vivado.installDir` from VS Code configuration; throws if
   unset.
2. Resolves it to the actual version-specific install directory via
   `resolveVivadoInstallDir()` (see below) — throws if nothing is found.
3. Recursively reads every `.xml` file under `<installDir>/data/ip/interfaces/`.
4. Hands the file contents to `parseVivadoInterfaceFiles()`.
5. Wipes (`fs.rm({ recursive: true, force: true })`) and rewrites the cache
   directory — a re-scan never leaves a stale entry behind.

The cache directory is `getIpcraftConfigDir() + '/vivado/bus_definitions'`,
resolved via `src/utils/configDir.ts` — `$XDG_CONFIG_HOME/ipcraft` (or
`~/.config/ipcraft`) on Linux, `~/Library/Application Support/ipcraft` on
macOS, `%APPDATA%/ipcraft` on Windows. This is a **single global cache
shared by every IP core on the machine**, not written into any project —
re-running the scan after a Vivado upgrade replaces it for every workspace
at once.

Each discovered interface is written as one YAML file, named from a
filesystem-safe VLNV stem (`vlnvToFileStem`, e.g.
`xilinx_com_interface_fifo_write_1_0.yml`), in the same shape as a
hand-authored `.busdef.yml`:

```yaml
XILINX_COM_INTERFACE_FIFO_WRITE_1_0:
  busType:
    vendor: xilinx.com
    library: interface
    name: fifo_write
    version: '1.0'
  source: vivado
  ports:
    - name: WR_DATA
      direction: out
      presence: required
    - name: WR_EN
      width: 1
      direction: out
      presence: required
```

`source: 'vivado'` is the only field that distinguishes this from a
user-saved custom bus definition file — every other field uses the exact
format `BusLibraryService` and `lookupBusDefFromLibrary` already understood
before this feature existed. No new file format, no new loader.

`getVivadoInterfaceCacheDir()` and `pathExists()` are exported for reuse by
the two merge points below.

### `resolveVivadoInstallDir` extraction

`vivadoResolver.ts` already had logic to resolve a user-configured
`installDir` into the real version-specific install directory (handling both
"installDir is already version-specific" and "installDir is the Vivado
family directory containing versioned subdirectories like `2024.2/`" — Xilinx
installs typically look like the latter). That logic lived inline inside
`findVivadoInInstallDir()` (used to locate the `vivado` launcher binary). It
was extracted into a standalone exported function, `resolveVivadoInstallDir()`,
because the scanner needs the same resolution to find
`data/ip/interfaces/` — a directory that exists relative to the install root,
not the launcher. `findVivadoInInstallDir()` now calls
`resolveVivadoInstallDir()` first and locates the launcher relative to the
result, so there is exactly one place that knows how to find "the Vivado
install directory" regardless of which file inside it the caller actually
wants.

---

## The two merge points

The cache is plain `BusLibraryService.loadFromUserPaths()` input — it is not
given special treatment beyond being added to the list of paths to scan,
once, in two places that each already had a `busLibraryPaths`-merging step:

**`ImportResolver.loadDefaultBusLibrary()`** (webview-facing — feeds the
inspector's Bus Type / Interface Type dropdowns and Port Widths section):

```typescript
const userPaths = [...config.get<string[]>('busLibraryPaths', [])];
const vivadoCacheDir = getVivadoInterfaceCacheDir();
if (await pathExists(vivadoCacheDir)) {
  userPaths.push(vivadoCacheDir);
}
```

**`IpCoreScaffolder.ensureBusDefinitions()`** (generator-facing — feeds
`component.xml` and `_hw.tcl` generation):

```typescript
const userPaths = [...config.get<string[]>('busLibraryPaths', [])];
const vivadoCacheDir = getVivadoInterfaceCacheDir();
if (await pathExists(vivadoCacheDir)) {
  userPaths.push(vivadoCacheDir);
}
```

Both check `pathExists()` first so a machine that has never run a scan
behaves exactly as before — no cache directory, no extra path, no behavior
change. Load order is: built-in library → `busLibraryPaths` setting →
Vivado cache, so a user-configured custom definition with the same VLNV as a
discovered one (unlikely, but possible) wins, since later entries in
`Object.assign(merged, parsed)` overwrite earlier ones — see
`BusLibraryService.scanDirectory()`.

---

## Inspector UI: `FuzzySelect`, `InterfaceTypeField`

Two related but separate inspector problems, fixed with one shared
component.

**`FuzzySelect`** (`CanvasInspector.tsx`) replaces a plain `<select>` with a
text input that opens a filtered, keyboard-navigable dropdown on focus.
Matching is a small subsequence-aware scorer with no external dependency:

```typescript
function fuzzyScore(query: string, text: string): number | null {
  // contiguous substring match always outranks a scattered one;
  // among scattered matches, smaller total character-gap wins
}
```

It is used for both:

- **`BusTypeField`**'s "preset" mode (the existing "Bus Type" dropdown for
  standard interfaces) — this is what makes the dropdown searchable instead
  of an alphabetical wall of options once Vivado-discovered entries are
  added to `BUILTIN_BUS_TYPES ++ listLibraryBusTypes(busLibrary)`.
- **`InterfaceTypeField`** (new) — gives custom/VLNV interfaces the same
  dropdown-style selection "Bus Type" already had. Its preset list is
  `listLibraryBusTypes(busLibrary)` (saved-custom + Vivado-discovered, no
  built-ins — those already have their own field), and its manual mode keeps
  the prior free-text behavior (`buildConduitType()` synthesizes a
  `user:busif:<name>:1.0` VLNV from a short name; a pasted full VLNV is kept
  as-is). The toggle button — and the field itself — is only shown when
  `listLibraryBusTypes(busLibrary).length > 0`, so a machine with no scan and
  no saved custom buses sees exactly the old plain text field.

### `ConduitPanel`'s `libraryPortDefs` branch

`ConduitPanel` (rendered whenever `isCustomBusInterface()` is true — mode is
`conduit`, the type string contains `conduit`, `conduitPorts` is non-empty,
or the type isn't one of the five hardcoded built-ins) now also looks the
interface's type up in the loaded bus library:

```typescript
const libraryPortDefs = busLibrary ? lookupBusDefFromLibrary(bus.type, busLibrary) : null;
const hasOwnConduitPorts = (bus.conduitPorts ?? []).length > 0;
```

- `libraryPortDefs && !hasOwnConduitPorts` — the type is known (built-in
  saved-custom, or Vivado-discovered) and there's no existing hand-authored
  port list to preserve. Renders `PortWidthOverridesSection` directly, the
  same component standard bus interfaces use — this is the path a freshly
  created `fifo_write` interface (typed in via the new searchable
  `InterfaceTypeField`, no signals yet) takes.
- `libraryPortDefs && hasOwnConduitPorts` — the type is known, but the user
  already has physical signals wired up under `conduitPorts`. Switching
  silently would orphan their HDL port names, so instead an info banner with
  a **"Map Signals"** button appears, opening `MapConduitToBusDialog`.
- neither — falls through to the original free-form `ConduitSignalsSection`
  (name/direction/width/presence table) unchanged.

### `MapConduitToBusDialog` + `applyMapConduitToKnownBus`

`MapConduitToBusDialog.tsx` renders the library's assignable logical ports
(those without a `role` of `clock`/`reset`) against the interface's existing
`conduitPorts`, filtered by expected direction for the selected mode, with a
best-effort case-insensitive name auto-match seeding the initial assignment.
Confirm is disabled while any `required` port is unassigned.

On confirm, `useGroupPorts.applyMapConduitToKnownBus(ipCore, busIndex, result)`
sets `mode`, `portNameOverrides`, `useOptionalPorts`, and clears
`conduitPorts` (`null`) — producing exactly the shape shown in the
[concepts doc's `fifo_write` example](../concepts/vivado-interface-catalog.md#the-map-signals-workflow-dont-discard-the-users-wiring).
This is a pure function over `BusInterface[]`; `ConduitPanel` wires it to
`onUpdate` via `useCallback`.

---

## The Port Widths filter bug

`PortWidthOverridesSection` (`CanvasInspector.tsx`) decides which logical
ports get an editable width override row. Before this fix:

```typescript
const configurableDefs = enabledDefs.filter((p) => (p.width ?? 1) > 1);
```

For built-in protocols this is correct: a signal with no declared width
really is fixed at 1 bit by the spec (`AWVALID`, `WVALID`, ...), so there's
nothing to override. For Vivado-discovered interfaces it is wrong: `width:
undefined` means *parameterized, no default stated* (see the
[parser section above](#port-extraction-and-the-width-omission-rule)), not
*fixed at 1 bit*. The `?? 1` coalescing collapsed both meanings into the same
bucket, so `fifo_write`'s `WR_DATA` (and similarly shaped Vivado interfaces)
had no width row at all — and consequently fell back to a hardcoded width of
1 wherever the generator needed a default (`VivadoComponentXmlGenerator.ts`'s
`port.width ?? 1`), silently producing a 1-bit data port unless the user
happened to add a manual `portWidthOverrides` entry by editing YAML directly.

Fix:

```typescript
const configurableDefs = enabledDefs.filter((p) => p.width === undefined || p.width > 1);
```

Each row also now carries `hasFixedDefault: portDef.width !== undefined`,
rendered as a small marker next to the signal name with a tooltip
("no standard width; set to match your design") so a row with no real
specification default isn't mistaken for a true 1-bit control signal.

---

## Generator-side fixes

### `conduitPorts` null → `[]`

`expandBusInterfaces()` (`registerProcessor.ts`) passed `iface.conduitPorts`
straight through into the template context. The domain type allows
`ConduitPort[] | null`, and any interface using `portNameOverrides` instead
of inline ports (every Vivado-discovered or Map-Signals-converted interface)
carries `null`. The contract schema (`template_context.schema.json`)
requires `conduitPorts` to be an array, so generation failed with:

```
Template context failed contract v1.0.0 validation:
  - context/expanded_bus_interfaces/1/conduitPorts must be array
```

Fixed by defaulting like the adjacent fields already did:

```typescript
conduitPorts: iface.conduitPorts ?? [],
```

(`useOptionalPorts` and `portWidthOverrides` already followed this pattern;
`conduitPorts` had simply been missed.)

### Source-aware `generateCustomBusDefs`

`findCustomBusDef()` (`VivadoComponentXmlGenerator.ts`) resolves a bus
interface's VLNV against the loaded bus library when it isn't one of the
five `resolveVivadoBusType()`-recognized protocols. Before this fix, any
match — Vivado-discovered or user-saved — was treated identically:
`generateCustomBusDefs()` wrote a `busdef/<name>.xml` +
`busdef/<name>_rtl.xml` pair into the packaged output for every match,
duplicating files Vivado already ships for a discovered interface.

`CustomBusInfo` now carries the library entry's `source` field through, and
`generateCustomBusDefs()` skips file generation when it is `'vivado'`:

```typescript
const custom = findCustomBusDef(ifaceType, busDefinitions);
if (!custom || custom.source === 'vivado') {
  continue;
}
```

`renderBusInterface()` — which emits the `<spirit:busType>` /
`<spirit:abstractionType>` elements and `<spirit:portMaps>` inside
`component.xml` — is **not** changed by this fix and did not need to be: it
was already using the real `xilinx.com:interface:fifo_write:1.0` VLNV via
the same `findCustomBusDef()` lookup, so the reference in `component.xml`
stays correct; only the redundant file-writing step is skipped.

`BusDefinition.source` and `CustomBusInfo.source` (`types.ts`) are both
`string | undefined` — absent for every pre-existing user-saved custom bus
definition, so none of that behavior changes for them.

---

## Quick Actions

`IpCoreTreeDataProvider.ts`'s Quick Actions section gained two entries,
surfacing commands that already existed but previously required the command
palette:

| Label | Command ID | Title in `package.json` |
|---|---|---|
| Scan Vivado IP Catalog | `fpga-ip-core.scanVivadoCatalog` | Scan Vivado IP Catalog |
| Scan Vivado Interface Catalog | `fpga-ip-core.scanVivadoInterfaces` | Scan Vivado Interface Catalog |

Both commands declare `"enablement": "ipcraft.vivadoFound"` in
`package.json`, so they only run once a Vivado install is detected.

---

## Domain schema change

`ipcraft-spec` (submodule) was bumped to allow `null` for `description`,
`physicalPrefix`, `physicalPrefixPattern`, the clock/reset logical-name
fields, and `Parameter.uiPage` / `Parameter.uiGroup`. `src/domain/ipcore.types.ts`
and `src/webview/types/ipCore.d.ts` were regenerated from the updated schema
(`npm run generate-types`) — neither file is hand-edited. This is what lets
the editor write `physicalPrefix: null` for an interface like `fifo_write`
that has no meaningful default prefix, instead of forcing an empty string.

---

## Test coverage

| File | Covers |
|---|---|
| `src/test/suite/parser/VivadoInterfaceXmlParser.test.ts` | busDefinition/abstractionDefinition joining, TLM-port skipping, width-omission semantics (fixture verified against a real Vivado 2024.2 install) |
| `src/test/suite/services/VivadoInterfaceScanner.test.ts` | cache directory wipe-and-rewrite, YAML shape, stale-file cleanup |
| `src/test/suite/utils/vivadoResolver.test.ts` | `resolveVivadoInstallDir()` — version-specific dir vs. family dir with versioned subdirectories |
| `src/test/suite/services/ImportResolver.test.ts` | Vivado cache path merged into the webview bus library when present, absent when not scanned |
| `src/test/suite/generator/IpCoreScaffolder.test.ts` | same merge on the generator side |
| `src/test/suite/components/MapConduitToBusDialog.test.tsx` | mode-dependent direction filtering, required-port gating, auto-match seeding |
| `src/test/suite/webview/applyMapConduitToKnownBus.test.ts` | `portNameOverrides`/`useOptionalPorts` production, `conduitPorts` clearing |
| `src/test/suite/generator/registerProcessor.test.ts` | `conduitPorts` defaults to `[]` |
| `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts` | `source: 'vivado'` entries skip `busdef/` generation; user-saved custom entries (no `source`) still generate it |
| `src/test/suite/services/YamlValidator.test.ts` | nullable-field schema acceptance |

---

## See also

- [Architecture Overview](overview.md) — system-wide module map.
- [Extension Host](extension-host.md) — where `VivadoInterfaceScanner` and
  `scanVivadoInterfaces` sit among the other services and commands.
- [Webview](webview.md) — where `MapConduitToBusDialog` sits among the other
  IP Core components.
- [Custom Interface](../concepts/custom-interface.md) — the interface model
  this feature extends rather than replaces.
