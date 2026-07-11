# V-7 — Import Resolution Consolidation

> Status: **Implemented** (see `src/services/ImportResolver.ts`) · Severity: Medium (silent divergence) · Effort: S–M (1–2 days)
> Independent of other V-items · Touches V-1's domain module if available
> Source finding: [architecture.md §7 V-7](../architecture.md#v-7--import-resolution-duplicated-host-side)

## Why

Two independent implementations follow `.mm.yml` imports from an `.ip.yml`, both on the
extension host:

| | `ImportResolver` (`src/services/ImportResolver.ts`) | `registerProcessor.resolveMemoryMaps` (`src/generator/registerProcessor.ts:476`) |
| --- | --- | --- |
| Consumer | IP core **editor display** — resolved maps shipped to the webview for canvas rendering and `memoryMapRef` validation | **Generation** — register data for template context (`prepareRegisters`) |
| Also resolves | `fileSets[].import`, `useBusLibrary` (with default-library fallback + cache) | memory maps only |
| Legacy shortcut `memoryMaps: { import: … }` | Handled explicitly | Must be re-verified — separately implemented |
| Entry-level override merge (`{ ...imported, ...entry }`) | Yes (`ImportResolver.ts:84`) | Own implementation |
| Error policy | Warn + fall back to the raw entry | Own policy |

The semantics here are **contract-bearing**: which fields of an importing entry override the
imported file (`name` does), what happens on missing/unparsable files, how relative paths
resolve (relative to the importing `.ip.yml`). With two implementations these rules can —
and over time will — drift. The symptom would be nasty: *the canvas shows one register
layout, the generated RTL implements another.* That breaks the SSOT promise in the worst
possible way, silently, downstream in hardware.

There's a structural reason the duplicate exists: `ImportResolver` imports `vscode` (via
`BusLibraryService`) while the generator aims to stay testable under plain ts-jest. The fork
was the path of least resistance.

## Design goals

1. **One implementation of import semantics.** Path resolution, override merge, error
   policy defined once, unit-tested once.
2. **Dependency-injected I/O.** The core is pure logic over an injected file reader, so the
   generator (plain fs), the editor service (vscode fs + caching), and tests (in-memory map)
   all share it. This removes the structural reason for the fork.
3. Display-only concerns (bus library default fallback, webview-shaped output) stay in
   `ImportResolver`; generation-only concerns (register flattening) stay in
   `registerProcessor`. Only the *import following* unifies.

## How

```
src/services/imports/                     # NEW (or src/domain/imports/ once V-1 lands)
  resolveMemoryMapImports.ts              # the single semantics implementation
  types.ts
```

```ts
export interface FileReader {
  readText(absPath: string): Promise<string>;
}

export interface ResolvedMemoryMapEntry {
  map: Record<string, unknown>;           // MemoryMap type after V-1
  sourceFile?: string;                    // absolute path when imported
  error?: string;                         // populated on fallback-to-raw-entry
}

export async function resolveMemoryMapImports(
  memoryMaps: unknown,                    // raw .ip.yml `memoryMaps` value (array | legacy object)
  baseDir: string,
  reader: FileReader
): Promise<ResolvedMemoryMapEntry[]>;
```

Semantics, captured as the unit-test suite (today they exist only as code in two places):

- Array entries with `import` → load file, take first map of the root list,
  spread entry-level keys over it minus `import` itself.
- Entries without `import` → pass through.
- Legacy `memoryMaps: { import }` object form → equivalent to a one-element array.
- Import file unreadable/unparsable → return raw entry + `error`; never throw
  (callers decide whether to warn, show in UI, or fail generation).
- Paths resolve relative to the importing file's directory; absolute paths pass through.

Then:

- `ImportResolver.resolveImports` calls it with a vscode-fs reader and keeps doing
  fileSets/bus-library on top.
- `registerProcessor.resolveMemoryMaps` calls it with a plain-fs reader and keeps doing
  register preparation on top. One behavioral decision to make explicit during migration:
  generation should arguably **fail loudly** on a broken import (generating RTL from a
  fallback raw entry that has no `addressBlocks` produces an empty register file) — use the
  `error` field to convert today's silent-ish path into a real generation error with the
  file name in the message.

## Tasks

1. **Characterization tests for both current implementations** (S). Same fixture set against
   both; any behavioral difference found is documented and a deliberate winner chosen —
   this diff *is* the bug being fixed.
2. **Extract `resolveMemoryMapImports`** (S). Port from `ImportResolver` (the more complete
   implementation); inject the reader; move the task-1 fixtures onto it.
3. **Migrate `ImportResolver`** (S). Delegate; behavior identical by construction.
4. **Migrate `registerProcessor`** (S). Delegate; add the fail-loudly-on-error decision with
   an explicit generation error message; update `IpCoreScaffolder` tests.
5. **Cross-check test** (S). One integration test that resolves the same `.ip.yml` through
   both consumers and asserts the resulting register sets are identical — the regression
   guard for the original disease.

## Acceptance criteria

- `grep -rn "\.import" src/generator src/services` shows import-following logic only in the
  shared module.
- Task-5 cross-check test in CI.
- A broken `import:` path now fails generation with a message naming the file, instead of
  producing an empty register block.

## Risks

- Behavioral differences found in task 1 may be load-bearing for existing user files
  (e.g. if the generator currently tolerates something the editor doesn't). Resolution rule:
  the *documented* semantics win; tolerances kept on purpose get a fixture + comment.
