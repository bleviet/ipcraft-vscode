# V-2 — Shared YAML Edit Module

> Status: proposed · Severity: Medium · Effort: M (2–4 days)
> Feeds into: [V-1](V-01-unified-domain-model.md) · Related: [V-3](V-03-revisioned-sync-protocol.md)
> Source finding: [architecture.md §7 V-2](../architecture.md#v-2--two-divergent-yaml-write-paths)

## Why

The two editors serialize edits back to YAML text through **two unrelated implementations
of different quality**:

| | Memory Map editor | IP Core editor |
| --- | --- | --- |
| Entry point | `YamlService.applyPathEdits` (`src/webview/services/YamlService.ts:116`) | `useIpCoreState.updateIpCore` (`src/webview/ipcore/hooks/useIpCoreState.ts:141`) |
| Strategy | `parseDocument` + recursive **node-reuse merge** (`mergeNode`): untouched nodes keep comments, scalar styles, formatting | `parseDocument` + `doc.setIn(path, value)` + full `toString()` |
| Hex literal preservation | Yes — post-stringify pass restores original spellings (`0x000A` stays `0x000A`) | No — `yaml` library re-renders |
| No-op detection | Yes — returns identical string; callers compare by identity | No — always restringifies |
| Sequence indent detection | `detectIndentSeq` — regex over raw text (`YamlService.ts:15`) | `detectIndentSeq` — line-scanning loop (`useIpCoreState.ts:13`) |

The two `detectIndentSeq` implementations are **independently written and subtly different**
(the regex version skips blank/comment lines between key and first item; the loop version
checks only the immediately following line). A document that one classifies as indented and
the other as compact will be reformatted whole when edited in the "wrong" editor.

**Consequences:**

- Editing an `.ip.yml` in the canvas can churn formatting (lost hex spellings, re-wrapped
  lines) that editing an `.mm.yml` would have preserved — inconsistent UX, noisy git diffs,
  and user comments at risk in `.ip.yml`.
- Bug fixes land in one implementation only. The hex-restore pass and the no-op detection
  in `YamlService` were added for real problems; `.ip.yml` editing still has those problems.
- This is straight **DRY** violation at a correctness-sensitive spot: text serialization of
  the SSOT.

## Design goals

1. One serializer, one behavior: minimal-diff, comment/format/hex-preserving, no-op-aware.
2. Pure module: text in, text out. No React, no `vscode` — usable from both webview bundles
   and (later) the extension host and tests.
3. The better implementation wins: `applyPathEdits` + `mergeNode` is the keeper;
   `doc.setIn` + restringify is retired.

## How

### Target layout

```
src/yamledit/                    # NEW — pure, dependency-light (only `yaml` package)
  applyPathEdits.ts              # moved from webview/services/YamlService.ts
  mergeNode.ts                   # extracted, unit-tested in isolation
  detectIndentSeq.ts             # ONE implementation
  restoreHexSpellings.ts         # extracted post-pass
  index.ts
```

`YamlService` keeps its name as a thin façade in the MM webview during migration
(static methods delegating), then dissolves.

### IP core editor migration

`updateIpCore` currently does state update + serialization in one `setState` callback.
Split it:

```ts
// before (useIpCoreState.ts): parseDocument + setIn + toString inside setState
// after:
const updateIpCore = useCallback((path: YamlPath, value: unknown) => {
  setState((prev) => {
    const newYaml =
      value === undefined
        ? applyPathDeletes(prev.rawYaml, [path])      // new sibling helper for deleteIn
        : applyPathEdits(prev.rawYaml, [{ path, value }]);
    if (newYaml === prev.rawYaml) return prev;        // no-op suppression, new for ip core
    return { ...prev, rawYaml: newYaml, ipCore: parse(newYaml) };
  });
}, []);
```

Note `applyPathEdits` has no delete semantics today (`updateIpCore` supports
`value === undefined` → `doc.deleteIn`). Add an explicit `applyPathDeletes` (or a
`{ delete: true }` edit flag) rather than overloading `undefined` — `cleanForYaml`
already uses `undefined` to mean "skip this key," and overloading it again invites bugs.

### Behavioral deltas to accept (and test)

Migrating the IP core editor to the merge strategy **changes behavior on purpose**:
comments and hex spellings in `.ip.yml` survive edits, and no-op edits stop producing
churn. Snapshot tests must be updated knowingly, not reflexively.

## Tasks

1. **Extract and pin** (S). Move `applyPathEdits`/`mergeNode`/`detectIndentSeq`/hex-restore
   into `src/yamledit/` unchanged; port the existing `YamlService` unit tests; add missing
   edge-case tests for `mergeNode` (sequence reorder by `name`, key deletion, nested merge).
2. **Resolve the `detectIndentSeq` fork** (S). Build a fixture corpus from both editors'
   real-world cases (blank line between key and seq, comment lines, top-level seq); pick the
   regex version as canonical unless a fixture proves the loop version handles something it
   doesn't; delete the other.
3. **Add delete support** (S). `applyPathDeletes` with tests (delete scalar, delete last key
   of a map, delete seq element).
4. **Migrate `useIpCoreState`** (M). Switch to the shared module per the sketch above.
   Round-trip fixture tests for `.ip.yml`: edit one clock name → assert only that line
   changes in the diff.
5. **Dissolve façades** (S). Point MM webview imports at `src/yamledit/`; remove the
   duplicate code from `YamlService.ts` (keep `parse`/`safeParse`/`dump` there or fold into
   V-1's domain module later).

## Acceptance criteria

- Exactly one `detectIndentSeq` in the repo.
- Editing a single value in `.ip.yml` via the canvas produces a one-line diff in a file
  containing comments and hex literals (new integration test).
- No-op canvas edits produce zero `postMessage` traffic (combined with the existing
  identity-compare pattern).
- `src/yamledit/` has no imports from `react`, `vscode`, or `src/webview/`.

## Risks

- Hidden reliance on full-restringify "normalization" in the IP core path (e.g. tests or
  downstream code expecting reformatted output). The characterization tests in task 1/4
  surface these before the switch.
- `mergeNode`'s sequence matching falls back to `name`-based pairing; `.ip.yml` sequences
  (clocks, busInterfaces) are name-keyed so this fits, but parameter sequences with
  duplicate names would pair arbitrarily — add a fixture to confirm acceptable behavior.
