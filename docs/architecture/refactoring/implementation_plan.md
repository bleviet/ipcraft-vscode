# V-1 Unified Domain Model Implementation Plan

Unify the three separate domain model vocabularies (schema camelCase, legacy snake_case, and webview-internal normalized variables) under a single, schema-conforming camelCase domain model. Establish a strict parsing and serialization boundary at the edge of the webview and generation systems.

## User Review Required

The refactoring introduces structural changes to all data paths and types:
- Stored properties in the in-memory state transition from snake_case (e.g., `reset_value`, `bit_offset`, `bit_width`, `base_address`) to camelCase (e.g., `resetValue`, `offset`, `width`, `baseAddress`).
- The parser accepts all formats tolerantly (snake_case, camelCase, fallback ranges), but the serializer only generates clean, camelCase schema shapes.
- Untouched properties and comments are preserved during partial YAML edits using the AST merge layer.

## Open Questions

None.

## Proposed Changes

### Domain Layer (New)

#### [NEW] [memorymap.types.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/domain/memorymap.types.ts)
- Generated file containing TypeScript interfaces matching `memory_map.schema.json`.

#### [NEW] [ipcore.types.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/domain/ipcore.types.ts)
- Generated file containing TypeScript interfaces matching `ip_core.schema.json`.

#### [NEW] [internal.types.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/domain/internal.types.ts)
- Define `NormalizedField`, `NormalizedRegister`, `NormalizedAddressBlock`, and `NormalizedMemoryMap` structures that extend the generated types to guarantee presence of rendering/editing defaults (like `offset`, `width`, `bits`, `size`, `baseAddress`) and carry `rowId` from the V-8 stable identity refactor.
- Define `MemoryMapDoc` which wraps the root layout formats (`standalone`, `array`, `nested` / `memory_maps`) to track root layout styles.

#### [NEW] [parse.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/domain/parse.ts)
- Implement `parseMemoryMap(text: string, prevMap?: NormalizedMemoryMap): MemoryMapDoc`. Resolves aliases and fallbacks (like `reset_value` -> `resetValue`, `bit_offset`/`bit_width`/`bits` -> LSB/MSB/bits, `address_offset` -> `offset`, `base_address` -> `baseAddress`) and reconciles stable row IDs from `prevMap` using `rowIdentity`.
- Implement `parseIpCore(text: string): IpCore`. Resolves all snake_case aliases to canonical camelCase.

#### [NEW] [serialize.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/domain/serialize.ts)
- Implement `serializeMemoryMap(normalized: NormalizedMemoryMap, rootStyle: string): unknown`. Cleans and outputs a pure object matching `MemoryMap` or `MemoryMapSchema` depending on the `rootStyle`, dropping runtime-only keys (like `rowId`, `offset`/`width` inside fields if `bits` is present).
- Implement `serializeIpCore(normalized: IpCore): unknown`.

---

### Shared Configuration and Scripts

#### [MODIFY] [package.json](file:///home/balevision/workspace/bleviet/ipcraft-vscode/package.json)
- Update `generate-types` script to output to `src/domain/memorymap.types.ts` and `src/domain/ipcore.types.ts`.

---

### Core Services and Algorithms Refactoring

#### [MODIFY] [LayoutEngine.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/LayoutEngine.ts)
- Refactor the pure algorithms to operate on `NormalizedField`, `NormalizedRegister`, and `NormalizedAddressBlock` types.
- Replace snake_case properties with camelCase counterparts (e.g., `bit_offset` -> `offset`, `reset_value` -> `resetValue`, `base_address` -> `baseAddress`).

#### [MODIFY] [MutationService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/MutationService.ts)
- Adapt insertions, deletions, and relocations to produce/manipulate the camelCase types.

#### [MODIFY] [YamlService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/YamlService.ts)
- Replace local `cleanForYaml` with calls to `serializeMemoryMap`.
- Ensure all mutations through the AST edit layer receive cleaned camelCase inputs.

#### [DELETE] [DataNormalizer.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/DataNormalizer.ts)
- Deprecate/delete and redirect call sites to `src/domain/parse.ts`.

#### [DELETE] [YamlSanitizer.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/YamlSanitizer.ts)
- Deprecate/delete in favor of `src/domain/serialize.ts`.

---

### Generator Components Refactoring

#### [MODIFY] [registerProcessor.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/generator/registerProcessor.ts)
- Use `parseIpCore` and `parseMemoryMap` at the generation boundaries instead of custom fallback parsing.
- Update VHDL/SystemVerilog template preprocessors to read camelCase keys (e.g., `resetValue`, `baseAddress`, `offset`).

---

### Webview Components & Hooks Refactoring

#### [MODIFY] [useMemoryMapState.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useMemoryMapState.ts) / [useIpCoreState.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/ipcore/hooks/useIpCoreState.ts)
- Retain the parsed domain models as state.

#### [MODIFY] All Table/Editor hooks:
- [useFieldEditor.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useFieldEditor.ts)
- [useTableEditorState.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useTableEditorState.ts)
- [useTableNavigation.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useTableNavigation.ts)
- [useFieldDrafts.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useFieldDrafts.ts)
- [useSelectionResolver.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useSelectionResolver.ts)
Update variables and parameter lookups to match the new camelCase properties.

#### [MODIFY] React Components:
- [FieldsTable.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/register/FieldsTable.tsx) / [FieldTableRow.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/register/FieldTableRow.tsx)
- [RegisterEditor.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/register/RegisterEditor.tsx)
- [BlockEditor.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/BlockEditor.tsx) / [BlockTableRow.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/BlockTableRow.tsx)
- [DetailsPanel.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/DetailsPanel.tsx)
- [OutlinePanel.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/OutlinePanel.tsx)
- [RegisterMapVisualizer.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/RegisterMapVisualizer.tsx)
Update render and editor callbacks to use camelCase attributes.

---

### Tests

#### [NEW] [roundtrip.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/domain/roundtrip.test.ts)
- Pin parse -> serialize round-trips for existing schemas and corpus files to guarantee zero semantic or literal data loss.

#### [MODIFY] Update existing tests to conform to new type names:
- `LayoutEngine.test.ts`
- `MutationService.test.ts`
- `useFieldEditor.test.ts`
- `SpecConformance.test.ts`

## Verification Plan

### Automated Tests
- Run `npm run generate-types` to ensure schema types are correctly built.
- Run `npm test` to verify unit and integration tests.
- Run `npm run lint` and `npm run type-check`.

### Manual Verification
- Load memory map visually in Extension Development Host:
  - Verify address blocks, registers, arrays, and fields load correctly.
  - Verify editing names, offsets, access rules, reset values, and descriptions preserves draft state and commits correctly to YAML.
  - Verify reordering registers and fields works as expected.
- Run HDL generation commands on an IP Core:
  - Verify generated VHDL / SystemVerilog matches outputs.
