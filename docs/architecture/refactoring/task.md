# Refactoring Tasks (V-8, V-2, V-7)

- `[x]` V-8: Stable Row Identity for Table Editing
  - `[x]` Create `src/webview/utils/rowIdentity.ts` and unit tests
  - `[x]` Update `useTableNavigation.ts` to support `rowId`
  - `[x]` Update `useTableEditorState.ts` to support `rowId`
  - `[x]` Thread `rowId` through `useFieldEditor.ts`, `FieldsTable.tsx`, and `FieldTableRow.tsx`
  - `[x]` Port register and address block tables to `rowId`
- `[x]` V-2: Shared YAML Edit Module
  - `[x]` Create `src/yamledit/` with `applyPathEdits.ts`, `mergeNode.ts`, `detectIndentSeq.ts`, `restoreHexSpellings.ts`, and unit tests
  - `[x]` Add `applyPathDeletes` support
  - `[x]` Migrate `useIpCoreState.ts` and update tests
  - `[x]` Point `YamlService.ts` to `src/yamledit/`
- `[x]` V-7: Import Resolution Consolidation
  - `[x]` Create `src/services/imports/resolveMemoryMapImports.ts` and unit tests
  - `[x]` Migrate `ImportResolver.ts`
  - `[x]` Migrate `registerProcessor.ts`
- `[x]` Verification
  - `[x]` Confirm all tests pass (`npm test`)
  - `[x]` Verify zero linter errors (`npm run lint`)
