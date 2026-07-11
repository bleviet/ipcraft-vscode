# V-1 — Unified Domain Model

> Status: **Implemented** (see `src/domain/{parse,serialize,internal.types,ipcore.types,memorymap.types}.ts`; `DataNormalizer.ts`/`YamlSanitizer.ts` are deleted) · Severity: High · Effort: L (1–2 weeks, incremental)
> Depends on: [V-2](V-02-shared-yaml-edit-module.md) (single serializer), [V-10](V-10-spec-versioning.md) (pinned schemas)
> Source finding: [architecture.md §7 V-1](../architecture.md#v-1--three-key-vocabularies-for-the-same-domain-model)

## Why

Three key vocabularies describe the same domain objects today:

1. **Schema camelCase** — `addressBlocks`, `resetValue`, `defaultRegWidth`, `enumeratedValues`
   (`ipcraft-spec/schemas/*.json`, the documented format).
2. **Legacy snake_case in user files** — `address_blocks`, `reset_value`, `default_reg_width`
   (accepted for backward compatibility).
3. **Webview-internal normalized form** — `bit_offset`/`bit_width` (instead of `bits`),
   `address_offset`, `__kind: 'array'` discriminator (`DataNormalizer.ts`).

Conversion logic is smeared across at least four modules:

| Module | Direction | Example |
| --- | --- | --- |
| `src/webview/services/DataNormalizer.ts` | YAML → internal | `field.reset_value ?? field.resetValue ?? field.reset` |
| `src/webview/services/YamlSanitizer.ts` | internal → schema keys | strips `__kind`, re-derives `bits` |
| `src/webview/services/YamlService.ts` (`cleanForYaml`) | internal → schema keys | recombines `bit_offset`+`bit_width` into `bits: '[msb:lsb]'`, with key-ordering logic |
| `src/webview/services/YamlPathResolver.ts` (`KEY_ALIASES`) | path navigation | falls back `addressBlocks` → `address_blocks` |

Additionally `src/generator/registerProcessor.ts` (`normalizeIpCoreData`) performs its own,
separate normalization for the generation pipeline.

**Consequences observed:**

- Every feature touching fields must remember all spellings or it silently drops data
  (the triple-fallback `?? resetValue ?? reset` pattern is the tell).
- Two sanitizers (`YamlSanitizer` + `cleanForYaml`) can disagree on which keys survive a
  round-trip; a write through one path then a read through the other loses information.
- Type safety is nil at the boundary: everything is `Record<string, unknown>` with inline
  casts, so the compiler cannot catch a misspelled key.

This violates **Single Source of Truth at the type level**: the JSON schema is authoritative
for the file format, but no TypeScript type is authoritative for the in-memory model.

## Design goals

1. **One internal vocabulary.** Inside webview and generator code, exactly one set of
   TypeScript types describes IP cores and memory maps. Pick the schema's camelCase —
   it is the documented format and minimizes conversion on the common path.
2. **One conversion boundary per direction.** `parse(text) → DomainModel` and
   `serialize(DomainModel, originalText) → text` are the only places alias handling exists.
3. **Schema-derived types.** Types are generated from the JSON schemas, not hand-maintained
   (the `generate-types` npm script already exists — finish wiring it in).
4. **Tolerant reader, strict writer** (Postel's law): the parser accepts every legacy
   spelling; the serializer emits only canonical camelCase for keys it creates, while the
   V-2 merge layer keeps untouched legacy keys as-is so hand-written files don't churn.

## How

### Target module layout

```
src/domain/                      # NEW — shared by webview AND extension host
  ipcore.types.ts                # generated from ip_core.schema.json
  memorymap.types.ts             # generated from memory_map.schema.json
  parse.ts                       # parseMemoryMap(text) → MemoryMapDoc (alias handling HERE only)
  serialize.ts                   # toSchemaShape(model) → plain object with canonical keys
  internal.types.ts              # view-model extensions (resolved bit ranges, row ids, __kind)
```

- `MemoryMapDoc` wraps the list-vs-object-vs-`memory_maps:` root variants behind one type
  with an explicit `rootStyle` discriminator (currently implicit in
  `YamlPathResolver.getMapRootInfo`).
- View-model fields the UI needs but the schema doesn't have (`bit_offset`, `bit_width`,
  stable row id from V-8) live in `internal.types.ts` as a wrapper, **not** mixed into the
  schema type:

```ts
// internal.types.ts
export interface FieldView {
  readonly model: BitFieldDef;       // schema-shaped, canonical keys
  readonly bitRange: [msb: number, lsb: number];  // resolved from bits OR offset+width
  readonly rowId: string;            // V-8 stable identity
}
```

This keeps the "what is persisted" / "what the UI computed" distinction visible in the type
system instead of relying on sanitizers to strip computed keys at write time.

### Conversion rules

- `parse.ts` resolves all aliases once: `reset_value|resetValue|reset → resetValue`,
  `address_blocks → addressBlocks`, `bits ↔ offset+width` → both stored (`model.bits`
  untouched, `bitRange` computed).
- `serialize.ts` produces a plain JS object in canonical schema shape; the V-2 merge layer
  (`applyPathEdits`) decides what actually changes in the text. Because the merge layer
  reuses untouched nodes, a legacy `address_blocks:` key in a file the user never restructures
  stays `address_blocks:` — no gratuitous diff churn.
- `YamlPathResolver.KEY_ALIASES` stays (paths must address real keys in real files) but
  becomes an internal detail of `serialize.ts`/path-edit code, not something feature code
  imports.

## Tasks

Each task ships independently; order matters.

1. **Wire up type generation** (S).
   Make `npm run generate-types` emit `src/domain/*.types.ts` from the two schemas
   (e.g. `json-schema-to-typescript`); commit generated output; CI check that regeneration
   is clean (guards against schema/code drift, complements V-10).
2. **Characterization tests for round-trips** (S).
   Pin current behavior: parse → edit nothing → serialize for a corpus of fixtures covering
   camelCase, snake_case, `bits` vs `offset/width`, array registers, `memory_maps:` wrapper.
   Assert byte-identical output. These tests guard every later task.
3. **Introduce `src/domain/parse.ts`** (M).
   Move `DataNormalizer`'s logic there, returning the new types. `DataNormalizer` becomes a
   thin deprecated re-export. Webview `useMemoryMapState` switches to it.
4. **Introduce `src/domain/serialize.ts`** (M).
   Fold `YamlSanitizer` + `YamlService.cleanForYaml` into one implementation with one test
   suite. Delete the duplicate after callers migrate.
5. **Migrate generator normalization** (M).
   `registerProcessor.normalizeIpCoreData` consumes `parse.ts` output instead of raw
   `Record<string, unknown>`. Generation-specific shaping (template context) stays in
   `registerProcessor` — it is a *projection*, not a second normalizer.
6. **Migrate IP core webview** (M).
   `useIpCoreState` types `ipCore` as the generated `IpCore` type; remove inline casts in
   `IpCoreApp.tsx` consumers incrementally (compiler drives the worklist).
7. **Delete dead aliases** (S).
   Once no feature code reads legacy keys directly, the triple-fallbacks disappear;
   `KEY_ALIASES` remains only inside the path-edit module.

## Acceptance criteria

- Grep for `resetValue ?? ` / `reset_value ??` outside `src/domain/` returns nothing.
- One sanitizer implementation; `YamlSanitizer.ts` and `cleanForYaml` removed or re-exporting.
- Round-trip corpus tests pass byte-identical for untouched documents.
- `tsc` enforces key correctness: misspelling `adressBlocks` in feature code is a compile error.

## Risks

- **Biggest item in the series.** Mitigate by strictly following task order — every task
  leaves the tree green and shippable.
- Generated types may be looser than hand-written ones (schema `anyOf` → unions). Acceptable;
  tighten the schema (V-10 territory) rather than hand-editing generated files.
- Webview bundle size: domain module is shared with the host — keep it dependency-free
  (no `vscode`, no Node built-ins) so webpack can include it in both targets.
