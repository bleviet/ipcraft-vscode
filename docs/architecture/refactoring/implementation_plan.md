# Editing Robustness, Formatting Preservation, and Import Consolidation Refactoring Plan (V-8, V-2, V-7)

Implement the sequencing points for editing robustness (V-8 stable row ids, V-2 shared serializer) and import resolution consolidation (V-7) from the architectural debt roadmap.

## User Review Required

The refactoring introduces structural changes to table editing hooks and YAML editing flows. Highlights:
- Table selection hooks and components transition from index-keyed selection to unique `rowId` keys. Ids are assigned using position-stable reconciliation.
- YAML modification in the IP Core editor moves from parse-modify-restringify to node-reuse merging. This preserves custom formatting, comments, and hex representations of untouched elements.
- Generation fails loudly if any memory map imports are broken or unparseable.

## Open Questions

None.

## Proposed Changes

### Stable Row Identity for Table Editing (V-8)

Introduce position-stable unique IDs for table rows to avoid desynchronization of editing drafts during reordering, renaming, insertion, and deletion.

#### [NEW] [rowIdentity.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/utils/rowIdentity.ts)
- Implement `reconcileRowIds<T extends { name?: unknown }>(prev: Array<{ rowId: string; model: T }> | undefined, next: T[]): Array<{ rowId: string; model: T }>` using stable pairing rules:
  1. Exact content match against an unconsumed previous row -> keep its id.
  2. Same index + same name -> keep id.
  3. Same name elsewhere (unconsumed) -> keep id.
  4. Same index, otherwise unconsumed -> keep id (covers renames / in-place edits; see the same-index trade-off in [V-08](V-08-stable-row-ids.md#how)).
  5. Otherwise -> generate a fresh monotonic `rowId`.
- Return the previous array reference unchanged when every row reused its id and model, so the reconcile effect cannot loop on a fresh-but-equal `next` array.

#### [MODIFY] [useTableNavigation.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useTableNavigation.ts)
- Transition `activeCell` to use `rowId: string | null` instead of `rowIndex: number`.
- Modify scroll and keyboard navigation logic to query and locate elements using `tr[data-row-id]` and track active/selection focus by `rowId`.
- Accept `rowIds: string[]` instead of `rowCount: number`.

#### [MODIFY] [useTableEditorState.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useTableEditorState.ts)
- Accept reconciled wrappers `rows: Array<{ rowId: string; model: TRow }>` and raw model array `rawRows: TRow[]`.
- Keep selection internal states (`selectedRowId: string | null`, `hoveredRowId: string | null`, `activeCell: { rowId: string | null; key: TColumnKey }`) keyed by `rowId`.
- Expose helper indexes (`selectedIndex`, `hoveredIndex`, `activeCell.rowIndex`) derived dynamically on render from `rawRows` array matching.
- Adjust `focusCellEditor` to query elements using `data-row-id`.

#### [MODIFY] [useFieldEditor.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useFieldEditor.ts)
- Maintain `wrappedFields` via `reconcileRowIds` on incoming `fields`.
- Replace the multiple parallel draft/error state maps in `useFieldDrafts` with single unified maps keyed by `rowId` or using the new scheme.
- Remove signature-based automatic full wipes and stale-name prune effects. Drafts now naturally live and die with their stable `rowId` mappings.

#### [MODIFY] [FieldsTable.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/register/FieldsTable.tsx) / [FieldTableRow.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/register/FieldTableRow.tsx)
- Use `rowId` for key elements and row container data attributes (`data-row-id` instead of `data-field-index`).
- Access drafts and errors using the field's `rowId`.

#### [MODIFY] [RegisterTableRow.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/RegisterTableRow.tsx) / [BlockEditor.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/BlockEditor.tsx)
- Reconcile register list to wrapped elements with stable `rowId`s.
- Bind selection and interaction handlers to register `rowId`s.

#### [MODIFY] [MemoryMapEditor.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/MemoryMapEditor.tsx) / [RegisterArrayEditor.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/RegisterArrayEditor.tsx)
- Port address block and memory-mapped lists to wrap and reconcile `rowId`s.

---

### Shared YAML Edit Module (V-2)

Consolidate YAML path editing, node merging, literal preservation, and indent sequence detection under a single shared, framework-free module.

#### [NEW] [index.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/yamledit/index.ts) / [applyPathEdits.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/yamledit/applyPathEdits.ts) / [mergeNode.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/yamledit/mergeNode.ts) / [detectIndentSeq.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/yamledit/detectIndentSeq.ts) / [restoreHexSpellings.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/yamledit/restoreHexSpellings.ts)
- Pure module `src/yamledit/` depending solely on the `yaml` npm library.
- Port regex-based sequence indentation detection as the canonical implementation.
- Support `applyPathDeletes(text, paths)` helper to handle item and key deletions explicitly.
- Re-use AST nodes recursively to preserve unchanged block indentation and comments.

#### [MODIFY] [YamlService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/YamlService.ts)
- Dissolve redundant edit/indentation helper logic and delegate call flows directly to the new `src/yamledit/` module.

#### [MODIFY] [useIpCoreState.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/ipcore/hooks/useIpCoreState.ts)
- Replace custom loop-based serialization and inline document mutator with shared `applyPathEdits` and `applyPathDeletes` from `src/yamledit/`.
- Prevent formatting churn and preserve comments/hex formatting on `.ip.yml` modifications.

---

### Import Resolution Consolidation (V-7)

Unify duplicate `.mm.yml` import following logic from extension host displaying and generation paths.

#### [NEW] [resolveMemoryMapImports.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/imports/resolveMemoryMapImports.ts) / [types.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/imports/types.ts)
- Define `FileReader` interface with dependency-injected filesystem reader `readText(absPath: string): Promise<string>`.
- Core resolution logic: loading array/legacy-object imported map entries, overriding with entry-level attributes (name, base offset), resolving paths relative to parent file, and collecting failures into an optional `error` output string.

#### [MODIFY] [ImportResolver.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/ImportResolver.ts)
- Instantiate vscode-fs wrapper reader and delegate memory map resolving tasks to the shared `resolveMemoryMapImports` function.

#### [MODIFY] [registerProcessor.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/generator/registerProcessor.ts)
- Instantiate fs/promises file reader and delegate import task to the shared `resolveMemoryMapImports`.
- Enforce strict generation errors when any import resolves with an error.

---

### Tests

#### [NEW] [yamledit.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/yamledit/yamledit.test.ts)
- Exhaustive unit tests for path edits, deletes, node-merging comment retention, hex preserving, and resolved sequence indent checks.

#### [NEW] [rowIdentity.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/webview/rowIdentity.test.ts)
- Exhaustive table-driven tests for position-stable row-id reconciliation rules.

#### [NEW] [resolveMemoryMapImports.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/resolveMemoryMapImports.test.ts)
- Unit tests validating the mock reader, correct paths, legacy overrides, and error collection rules.

#### [MODIFY] [useFieldEditor.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/hooks/useFieldEditor.test.ts)
- Adapt assertions to check `rowId` behavior, selection preservation, and verify fix for draft-editor bugs.

## Verification Plan

### Automated Tests
- Run `npm test` to verify unit and integration tests.
- Run `npm run lint` and `npm run type-check`.
- Run `npm run compile`.

### Manual Verification
- Verify table editing in Extension Development Host for:
  - Memory Map Address Blocks (BlockEditor).
  - Register fields (RegisterEditor / FieldsTable).
  - Reordering, inserts, deletions, edits preserve input focus and drafts accurately.
- Verify single clock rename in `.ip.yml` produces exactly one changed line in Git diff.
- Verify unreadable imports block the HDL generation command with a clear error prompt.
