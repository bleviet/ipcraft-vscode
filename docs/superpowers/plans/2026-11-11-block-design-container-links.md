# Block design containers: implementation plan

Design: `docs/superpowers/specs/2026-11-11-block-design-container-links-design.md`
(approved). Two tasks, done in order; each ends green on type-check, lint and
jest.

Verification for both tasks:

```bash
npx tsc --noEmit
npx eslint src --max-warnings 0
npx jest --config config/jest.config.js            # full suite at the end
npx jest --config config/jest.config.js <pattern>  # while iterating
```

Baseline: 444 suites passed (2 skipped), 7145 tests passed (55 skipped).

## Task A: parse, resolve and expand containers (viewer and CLI)

### A1. Domain: `src/domain/systemGraph.ts`

Add to `SystemInstance`:

```ts
/**
 * Vivado block design container (`create_bd_cell -type container`). Shown as a
 * black box until enrichment finds the Tcl script that generates its block
 * design; then grafted as a hierarchy (`kind: 'hier'`) and `source` is set.
 */
container?: {
  /** `-reference`: the block design name. */
  reference: string;
  source?: SystemSourceRef & { evidence: BdTclEvidence };
};
```

`export type BdTclEvidence = 'link' | 'cmake' | 'design_name' | 'file_name';`

New pure file `src/domain/bdContainer.ts`:

```ts
/** Active synthesis BD and the other BDs of a container, `.bd` stripped. */
export function containerDesigns(instance: SystemInstance): { active: string; alternatives: string[] } | undefined
```

`active` = `CONFIG.ACTIVE_SYNTH_BD` without `.bd`, else `container.reference`.
`alternatives` = the `CONFIG.LIST_SYNTH_BD` entries (split on `:`, `.bd`
stripped, trimmed, empty dropped) except `active`. `undefined` when the
instance has no `container`.

### A2. Parser

- `bdTclGraphBuilder.ts`: `NewInstance` gets `container?: { reference: string }`,
  copied onto the instance by `addInstance`. `addReferencedBlackBoxes` still
  adds net pins to a container black box, but does not call `noteBlackBox`
  for it (containers are not in the "Not defined in this file" warning and do
  not set `hasWarning`).
- `bdTclCommands.ts` `createCell`: `-type container` with a `-reference`
  creates `kind: 'blackbox'`, `container: { reference }`. Without
  `-reference`: keep today's "Unknown cell type" warning path. `set_property`
  on the returned variable then fills `parameters` as for any cell.

### A3. File entries and CMake projects

`src/services/systemDiagram/enrichment/fileEntries.ts`:

- `export type BdTclEntry<R> = FileLocation<R> & { designName?: string };`
- `bdTclEntryFromText(text, location)`: `designName` from the first
  `^\s*set\s+design_name\s+(\S+)\s*$` (multiline), surrounding `"…"` or `{…}`
  removed.
- `export const TCL_MAX_BYTES = 4 * 1024 * 1024;` (larger files are skipped).

New pure `src/services/systemDiagram/enrichment/cmakeProjects.ts`:

```ts
/** The `DESIGN` lists of every `add_vivado_project(...)` call, as absolute paths. */
export function vivadoProjectDesigns(text: string, cmakeFile: string): string[][]
```

- Strip `#` comments to end of line. Find `add_vivado_project\s*\(` and its
  matching `)`. Tokenize the arguments on whitespace; a token matching
  `^[A-Z][A-Z0-9_]*$` is a keyword. The tokens after `DESIGN` up to the next
  keyword are split on `;`, quotes removed.
- `${CMAKE_CURRENT_LIST_DIR}` and `${CMAKE_CURRENT_SOURCE_DIR}` become the
  folder of `cmakeFile`; an item with any other `${` is dropped; relative
  items resolve against that folder (`path.resolve`, so `../` works).
- `export interface CmakeEntry { file: string; projects: string[][] }`.

### A4. Ranking (pure): `src/services/systemDiagram/enrichment/rankBdTcl.ts`

```ts
export interface RankedBdTcl<R> { entry: BdTclEntry<R>; evidence: BdTclEvidence }
export interface BdTclRanking<R> {
  /** Strongest evidence first, then nearest to the design; one per file. */
  candidates: RankedBdTcl<R>[];
  chosen?: RankedBdTcl<R>;
  /** Set when the best evidence level has a tie that distance does not break. */
  ambiguous?: RankedBdTcl<R>[];
}
export function rankBdTcl<R>(bdName: string, designFile: string, sources: {
  link?: BdTclEntry<R>;
  project: readonly BdTclEntry<R>[];   // Tcl files listed with designFile
  workspace: readonly BdTclEntry<R>[]; // the workspace Tcl index
}): BdTclRanking<R>
```

- `link`: always a candidate with evidence `link`, and always `chosen`.
- `cmake`: a `project` entry whose `designName === bdName`.
- `design_name`: a `workspace` entry whose `designName === bdName`.
- `file_name`: a `workspace` entry without `designName` whose base name is
  `<bdName>.tcl`.
- Exact, case-sensitive compare. `designFile` itself is never a candidate. A
  file appears once, with its strongest evidence.
- `chosen` (without a link): the best evidence level present; within it the
  smallest `treeDistance` to `designFile`; a tie at that distance leaves
  `chosen` undefined and sets `ambiguous`.
- Export `treeDistance` from `matchDefinitions.ts` and reuse it (no copy).

### A5. IO

`enrichmentIo.ts` `EnrichmentIo<R>` gets:

```ts
/** Called only for block designs with containers. */
listBdTclFiles(): Promise<BdTclEntry<R>[]>;
listCmakeFiles(): Promise<CmakeEntry[]>;
/** A workspace file by absolute path (Tcl files of a CMake project, link targets). */
locate(file: string): FileLocation<R>;
/** The user's links for `designFile`: block design name -> absolute Tcl path. Missing file: `{}`. */
readBdLinks(designFile: string): Promise<Record<string, string>>;
```

New pure `src/services/systemDiagram/enrichment/bdLinks.ts`:

```ts
export const BD_LINKS_FILE = '.ipcraft/bd-links.json';
export interface BdLinksFile { version: 1; links: Record<string, Record<string, string>> }
/** Throws on invalid JSON or shape. */
export function parseBdLinks(text: string): BdLinksFile
/** Links of one design; keys and values are POSIX paths relative to `root`. */
export function linksForDesign(file: BdLinksFile, root: string, designFile: string): Record<string, string>  // values absolute
```

- VS Code adapter (`SystemDesignEnricher.ts`): a `WorkspaceFileIndex` for
  `**/*.tcl` (limit 5000, files over `TCL_MAX_BYTES` skipped via `stat`, as
  HDL) and one for `**/CMakeLists.txt` (limit 5000; entry undefined when the
  text has no `add_vivado_project`). `locate` = `locationOf(vscode.Uri.file(file))`.
  `readBdLinks`: the workspace folder of the design
  (`vscode.workspace.getWorkspaceFolder`), read `BD_LINKS_FILE` there; a
  missing file or no folder gives `{}`; invalid content is logged with
  `logger.warn` and gives `{}`. Follow the `SubsystemExpander` pattern only if
  it keeps `SystemDesignEnricher` readable; otherwise put both indexes in a
  new `BdTclIndex.ts` next to it.
- CLI adapter (`src/cli/workspaceIo.ts`): `scanWorkspace` also collects
  `.tcl` and `CMakeLists.txt` (same sorted, limited, ignored-folder walk;
  `TCL_LIMIT = 5000`, `CMAKE_LIMIT = 5000`); `locate` = the existing `locate`
  for a path relative to `base`; `readBdLinks` reads `<base>/BD_LINKS_FILE`
  (invalid: `warn`, `{}`).
- Update every other `EnrichmentIo` implementation and test fake.

### A6. Expansion: `src/services/systemDiagram/enrichment/expandContainers.ts`

```ts
export async function expandContainers<R>(graph, designFile, io, log?): Promise<SystemGraph>
```

- Only `graph.source.format === 'vivado-bd-tcl'` and only when an instance
  has `container`; otherwise return `graph` without touching `io`.
- Lazily, once per call tree: `listCmakeFiles()`, `listBdTclFiles()`.
  `project` entries for a design file = for every CMake project list that
  contains `designFile` (compare `path.resolve`d), every other listed `.tcl`
  file: its index entry if present, else `bdTclEntryFromText(await
  io.readText(...), io.locate(file))` (unreadable: skipped).
- Links: `io.readBdLinks(designFile)`; a link target is read with
  `io.readText`; unreadable -> warning
  `${instance.name}: ${BD_LINKS_FILE} links ${bd} to ${file}, which cannot be read; using automatic resolution.`
  and ranking without the link.
- Per container (all levels, root-level first; process instances present in
  the graph before expansion): `bd = containerDesigns(instance).active`,
  `rankBdTcl`. Chosen: read with `readBdTcl(text, entry.displayName)`, expand
  its own containers recursively with its file as `designFile` (stack guard
  as in `expandSubsystems`, same warning text), then `graftSubsystem(result,
  path, child, { fileName, uri })`, then set
  `instances[path].container.source = { fileName, uri, evidence }`.
- Diagnostics (on `instance.line`, `level` as in `expandSubsystems`):
  - none found: warning
    `${instance.name}: no Tcl script defines block design ${bd}; shown as a black box. Use Assign Tcl in the details panel to choose one.`
  - ambiguous: warning
    `${instance.name}: several Tcl scripts define block design ${bd}: <displayNames sorted, comma separated>. Use Assign Tcl to choose one.`
  - read/parse error: warning as in `expandSubsystems`.
  - When any container stays a black box: `capabilities.connections` and
    `capabilities.addressMap` become `partial` (weaker of current and partial).
- `enrichSystemGraph.ts`: call `expandContainers` right after
  `expandSubsystems` (before IP/HDL matching, so grafted IPs get enriched).

### A7. Details panel (read-only part)

`src/webview/systemDiagram/InstanceDetails.tsx`, for an instance with
`container`:

- identity text: `Block design container ${active}`; the black-box paragraph
  for a container reads: "This block design container is shown as a black box
  because no Tcl script that generates block design `<active>` was found. Its
  pins are the ones seen in connections."
- when `container.source`: "Read from <link to source.uri, line 1 via
  onReveal> (<evidence text>)" with evidence texts `linked in
  .ipcraft/bd-links.json`, `listed in the CMake project`, `design_name
  matches`, `file name matches`.
- when `alternatives.length > 0`: "Other block designs: a, b".

### A8. Tests (Task A)

- `BdTclReader.test.ts`: container with single and DFX lists (snippet copied
  from vek385 `top.tcl` lines 2546-2560 and the `rp_fmc` cell); no
  "Unknown cell type"; not in the black-box warning; parameters read;
  `containerDesigns` result.
- `cmakeProjects.test.ts`: vek385 `DESIGN` line (relative, `../`),
  `${CMAKE_CURRENT_LIST_DIR}`, other variables dropped, two calls, comments,
  no call.
- `rankBdTcl.test.ts`: each evidence, precedence, distance tie-break,
  ambiguity, link wins, `base_partition_sim_top` not a candidate, the vek280 /
  common `base_partition.tcl` pair resolves to common through `project`.
- `bdLinks.test.ts`: parse, invalid JSON, wrong shape, `linksForDesign`.
- `expandContainers.test.ts` (fake io): graft and evidence; recursion guard;
  missing and ambiguous diagnostics + capabilities; stale link falls back;
  no container -> io untouched; a `.gen/.../hw_handoff` file never reaches the
  ranking (CLI walk test below).
- `renderWorkspace.node.test.ts`: a temp workspace modelled on vek385
  (`fpga/b/CMakeLists.txt`, `fpga/b/src/tcl/top.tcl` with a container
  `part`, `fpga/common/src/tcl/part.tcl` and `fpga/other/src/tcl/part.tcl`
  both `design_name part`, `fpga/b/build/x.gen/sources_1/bd/part/hw_handoff/part.tcl`)
  renders with `part` expanded from common.

## Task B: Assign Tcl (VS Code only)

### B1. Messages

`src/shared/messages/systemDiagram.ts`: add
`{ type: 'assignContainerTcl'; instance: string }` to extension messages.
`useSystemDiagramMessages.ts`: `assignContainerTcl(instance)`; thread it like
`openDefinition` through `SystemDiagramApp` -> `DiagramWorkbench` ->
`WorkbenchLayout` -> `DetailsPanel` -> `InstanceDetails`.

### B2. Button

`InstanceDetails.tsx`: for an instance with `container`, a `sd-button`
"Assign Tcl…" (title: "Choose the Tcl script that generates this block
design").

### B3. Writing links (pure + adapter)

`bdLinks.ts` adds:

```ts
export function setBdLink(file: BdLinksFile | undefined, root: string, designFile: string, bdName: string, tclFile: string | undefined): BdLinksFile
export function formatBdLinks(file: BdLinksFile): string // 2-space JSON, sorted keys, trailing newline
```

`undefined` `tclFile` removes the entry (and an emptied design key).

### B4. Provider: `SystemDiagramProvider.ts`

`router.on('assignContainerTcl', …)`:

1. Instance from `lastGraph`, must have `container`; `bd` from
   `containerDesigns`. The design's workspace folder; none -> error message
   "Open the design inside a workspace folder to assign a Tcl script."
2. Candidates: new `SystemDesignEnricher.bdTclCandidates(designFile, bd)`
   returning the `rankBdTcl` candidates (reuse the A6 helpers for `project`
   and links; no duplicated collection logic).
3. QuickPick: one item per candidate (label = file base name, description =
   display path, detail = evidence text, the current `container.source` marked
   "current"), then "Browse…", then "Remove assignment" when a link exists.
4. Browse: `showOpenDialog` with `filters: { 'Tcl scripts': ['tcl'] }`,
   `defaultUri` the design folder; a file outside the workspace folder ->
   error message, nothing written.
5. Write `<folder>/.ipcraft/bd-links.json` with `setBdLink` +
   `formatBdLinks` via `vscode.workspace.fs` (create `.ipcraft/`), then
   `postGraph()`.

Plus a `FileSystemWatcher` on `**/.ipcraft/bd-links.json` per panel
(create/change/delete -> `postGraph()`), disposed with the panel.

### B5. Tests and docs (Task B)

- `bdLinks.test.ts`: `setBdLink` add, replace, remove, remove last;
  `formatBdLinks` stable output.
- Provider test (follow the existing provider tests for `openDefinition`):
  QuickPick pick writes the file and re-posts; Remove; Browse outside the
  folder is rejected.
- `InstanceDetails` test: button shown for containers only; source line and
  alternatives.
- Docs: `docs/how-to/view-a-system-design.md` section "Block design
  containers" after "Black boxes" (how they resolve, the evidence order,
  Assign Tcl, the links file, that `.bd` files are never used).
  `CHANGELOG.md` new `## [Unreleased]` / `### New` entry;
  `docs/contributing/changelog.md` technical entry.
