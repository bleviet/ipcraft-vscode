# V-8 — Stable Row Identity for Table Editing

> Status: proposed · Severity: High (recurring bug source) · Effort: M (2–3 days)
> Independent; complements [V-3](V-03-revisioned-sync-protocol.md) (different layers of the same symptom cluster)
> Source finding: [architecture.md §7 V-8](../architecture.md#v-8--index--and-name-keyed-draft-state-in-the-field-editor)

## Why

The field table (`useFieldEditor`, `FieldTableRow`) keeps per-row editing state in draft
maps with **two different key schemes**:

```ts
// useFieldEditor.ts
const [nameDrafts, setNameDrafts]   = useState<Record<string, string>>({});   // keyed by FIELD NAME
const [nameErrors, setNameErrors]   = useState<Record<string, string | null>>({});
const [bitsDrafts, setBitsDrafts]   = useState<Record<number, string>>({});   // keyed by ROW INDEX
const [bitsErrors, setBitsErrors]   = useState<Record<number, string | null>>({});
const [resetDrafts, setResetDrafts] = useState<Record<number, string>>({});
const [dragPreviewRanges, …]        = useState<Record<number, [number, number]>>({});
```

Neither key is stable under the operations the table supports:

| Operation | Name-keyed state | Index-keyed state |
| --- | --- | --- |
| **Rename a field** | Key itself changes mid-edit → orphaned entries (the recent "stale draft reappears" bug) | unaffected |
| **Move / insert / delete a row** | unaffected | every key below the row now points at the wrong field |
| **Duplicate names** | two rows share one draft slot | unaffected |

Because no key survives everything, the hook needs **two independent repair mechanisms**:

- an order-signature effect (`useFieldEditor.ts:351`) that wipes ALL index-keyed drafts when
  the name|bits signature of the list changes, and
- a stale-key pruning effect (added June 2026) that deletes name-keyed entries not matching
  any current field,

plus five call sites that defensively `setNameDrafts({}); setBitsDrafts({}); …` on
move/insert/delete. The git log shows the cost: `c75b246`, `5e999d7`, `2fdd646`, `dfb66da` —
four consecutive fix commits in this one area, including the flash-on-Enter glitch fixed
again this week. Each fix is correct locally; the architecture guarantees the next one.

The same pattern (with the same risks) exists in `RegisterTableRow`/`MemoryMapEditor`
(memory map tables) and `useTableEditorState`.

## Design goals

1. **One key scheme, stable under rename, reorder, insert, delete, and duplicates.** That is
   the definition of an identity, and neither name nor position is one.
2. All per-row UI state (drafts, errors, drag previews, selection) keyed by that identity.
3. Identity is **view-model only** — it must never be written to YAML (the file format has
   no id field, and inventing one would pollute user files).
4. Delete the repair mechanisms; correct-by-construction beats repaired-after-the-fact.

## How

### Identity assignment

Generate a `rowId` (monotonic counter or short uuid) when rows enter the view model, and
**preserve it across re-parses by position-stable reconciliation**:

```ts
// rowIdentity.ts (webview)
let nextId = 1;
export function reconcileRowIds<T extends { name?: unknown }>(
  prev: Array<{ rowId: string; model: T }>,
  next: T[]
): Array<{ rowId: string; model: T }>;
```

Reconciliation rules, in order, mirroring what `mergeNode` does for YAML nodes:

1. Exact content match against an unconsumed previous row → keep its id.
2. Same index + same name → keep id (covers value edits).
3. Same name elsewhere (unconsumed) → keep id (covers moves).
4. Same index, otherwise unconsumed → keep id (covers renames / in-place edits,
   including duplicate-name renames where the name is no longer a reliable key).
   **Trade-off:** a delete-at-N + insert-at-N in a *single* reconcile makes the
   inserted row inherit the removed row's id (and any uncommitted draft). This is
   deliberate — keeping draft state stable across renames is the dominant edit, and
   the mis-pair only bites on a simultaneous external delete+insert at the same
   index while the user has an uncommitted draft (see Risks). Pinned by the
   "pass 4" case in `rowIdentity.test.ts`.
5. Otherwise → new id (covers inserts; deleted rows' ids retire with them).

Reconciliation also returns the *previous* array reference unchanged when every
row reused its id and still points at the same model object. This makes
`setRows(prev => reconcileRowIds(prev, next))` a no-op when `next` is a
fresh-but-equal array (e.g. an unmemoised prop or `value ?? []`), so the effect
that drives it cannot spin into an update loop.

This runs where the document echo is parsed (`useMemoryMapState`/`DataNormalizer` output —
or `FieldView.rowId` from V-1's `internal.types.ts` if that landed). An echo of our own edit
reconciles to identical ids, so drafts survive; a structural external change assigns fresh
ids and drafts for vanished rows die with their rows — which is the correct behavior.

### State consolidation

Replace the six parallel maps with one map of row state, keyed by `rowId`:

```ts
interface RowEditState {
  drafts: Partial<Record<EditKey, string>>;    // name, bits, reset…
  errors: Partial<Record<EditKey, string | null>>;
  dragPreview?: [number, number];
}
const [rowState, setRowState] = useState<Record<string, RowEditState>>({});
```

One map means one cleanup path (`rowId` no longer present → entry dropped during
reconciliation) instead of two effects + five defensive wipes. `activeCell`/selection also
move from `rowIndex` to `rowId` (deriving index on demand), which fixes the subtler cousin
bugs: selection jumping after a move, focus landing on the wrong row after insert
(`focusFieldEditor`'s `data-field-index` lookup becomes `data-row-id`).

### Migration of the symptom fixes

The recent fixes become removable, each verified by a test that reproduces the original bug:

- blur-commit + draft-clear ordering (flash on Enter) — drafts keyed by `rowId` are immune
  to the name-key handoff that caused it;
- order-signature wipe effect — superseded by reconciliation;
- stale-name pruning effect — superseded by reconciliation.

## Tasks

1. **Test harness for the bug class** (M). React Testing Library tests against
   `useFieldEditor` + `FieldTableRow` reproducing: rename-then-Enter flash, move-row draft
   shift, insert-row draft shift, duplicate-name cross-talk, ESC revert. Some will fail
   against current code where bugs are merely dormant — those are the proof the refactor is
   needed; mark `.failing` and flip them as the refactor lands.
2. **`reconcileRowIds` + unit tests** (S). Pure function, exhaustive table-driven tests for
   the four rules including duplicate names and simultaneous move+edit.
3. **Thread `rowId` through the field table** (M). View-model wrapper rows, `tr data-row-id`,
   `RowEditState` consolidation, selection by id. Keep YAML write paths untouched — ids are
   stripped by construction because writes go through `sanitize*`/path edits that never see
   the wrapper.
4. **Delete repair mechanisms** (S). Order-signature effect, prune effect, the five
   defensive wipes; flip the task-1 tests to passing.
5. **Port to register/block tables** (M). `useTableEditorState` and memory-map tables get
   the same wrapper; mostly mechanical after task 3 established the pattern.

## Acceptance criteria

- Zero `Record<number, …>` draft state in table editing hooks.
- All task-1 scenario tests pass, including the dormant-bug ones.
- ESC revert (`useCellEditGuard`) and Enter commit behave identically (existing tests in
  `useFieldEditor.test.ts` stay green, rewritten to ids where they assert on keys).
- No `rowId`/`__` keys ever appear in written YAML (round-trip assertion added to the V-1/V-2
  fixture corpus if present, else a dedicated test).

## Risks

- Reconciliation heuristics can mis-pair rows under pathological edits (external bulk
  rename + reorder in one echo). Consequence is bounded: a draft attaches to the wrong row
  *only if the user had uncommitted edits during an external structural change* — rare, and
  no worse than today's full wipe. Rule 1 (exact content) keeps the common echo case exact.
- Touches focus management (`focusFieldEditor`, `data-*` attributes) — the area of the
  recent regressions. The task-1 harness exists precisely to hold this.
