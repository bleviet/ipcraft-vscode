# Known Technical Debt

Actionable items identified during the 2026-05-25 architecture review (post-refactor, at commit `2b2cbde`). Each item is independent and self-contained — any one can be shipped as a single PR.

---

## TD-1 — `projectCreator.ts` branch-dispatches on vendor string

`src/commands/projectCreator.ts` (`createVendorProject`) uses an `if (toolchainId === 'vivado') ... else if (toolchainId === 'quartus')` dispatch to manually assemble the project-creation launch for each vendor. This is the last callsite that bypasses the `SynthesisToolchain` strategy.

**Recommendation:** Add a `createProject(name, ipDir, cfg, outputChannel)` method to the `SynthesisToolchain` interface. Both `VivadoToolchain` and `QuartusToolchain` implement it, and `projectCreator.ts` becomes a thin delegation:

```ts
export async function createVendorProject(
  toolchainId: string, name: string, ipDir: string, outputChannel: OutputChannel
): Promise<boolean> {
  const toolchain = getToolchain(toolchainId);
  if (!toolchain) return false;
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  return toolchain.createProject(name, ipDir, cfg, outputChannel);
}
```

**Effort:** ~60 LOC across 3 files. Extend existing `VivadoToolchain.test.ts` and `QuartusToolchain.test.ts`.

---

## TD-2 — `TEMPLATE_TYPE_TO_ALTERA` embedded in the scaffolder

`src/generator/IpCoreScaffolder.ts` (~line 316) contains a bus-type translation table specific to the Altera `_hw.tcl` template:

```ts
const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
  axil: 'axi4lite', axi4: 'axi4', axis: 'axi4stream',
  avmm: 'avalon',   avst: 'avalon_streaming',
};
```

This table is only consumed by the `altera_hw_tcl.j2` template context. A future Lattice/Microchip target would need a parallel `TEMPLATE_TYPE_TO_<vendor>` map, growing the scaffolder further.

**Recommendation:** Move the map to `QuartusToolchain.ts` as a `mapBusType(busType: string): string` method (matching the pattern of `quartusDeviceFamily()`). Have `QuartusToolchain.scaffold()` inject `altera_type` into the template context rather than the scaffolder doing it for all interfaces unconditionally.

**Effort:** ~30 LOC across 2 files.

---

## TD-3 — `SimulationConfig.compileArgs` / `simArgs` / `env` silently ignored by generator

The `SimulationConfig` type and JSON schema define `compileArgs`, `simArgs`, and `env` fields. `IpCoreScaffolder.generateAll()` reads `simulation.framework` and `simulation.engine` but ignores the rest — the fields are validated by AJV but never forwarded to the template context.

**Recommendation:** Forward `simCfg.compileArgs` and `simCfg.simArgs` into `TestbenchContext` and have `CocotbFramework` / `VUnitFramework` append them to the engine's default flag lists. Forward `simCfg.env` so `conftest.py` / `run.py` can set those variables before launching the simulator.

**Effort:** ~40 LOC across `Framework.ts`, `CocotbFramework.ts`, `VUnitFramework.ts`, and their templates.

---

## TD-4 — `QuestaEngine.waveArgs` returns a flag+value as one string element

`src/generator/testbench/engines/QuestaEngine.ts` (~line 18):

```ts
waveArgs(entityName: string): string[] {
  return [`-wlf ${entityName}.wlf`];
}
```

This returns a single string element containing a space-separated flag+value pair. `spawn()` consumers expect each flag and its value as separate array elements. It should return `['-wlf', `${entityName}.wlf`]`. If the intent is template-string interpolation rather than process args, that contract must be documented explicitly.

**Effort:** 1 line + 1 test assertion.

---

## TD-5 — Duplicated `fileExists()` utility

Three copies of the same async `fileExists` helper exist:

- `src/commands/projectCreator.ts`
- `src/services/toolchains/QuartusToolchain.ts`
- `src/services/toolchains/VivadoToolchain.ts`

**Recommendation:** Extract to `src/utils/fsHelpers.ts` (which already exists) and replace all three inline definitions with an import.

**Effort:** ~15 LOC — one new export + 3 import changes.

---

# V-Series Refactoring Review Findings (2026-06-13)

Correctness bugs and regressions found while reviewing the `refactor/foundations-resource-roots`
branch (V-1…V-10, commit `41d8cfe`) against `main`. Unlike TD-1…TD-5 (mechanical cleanups), several
of these are **shipping bugs**: two cause silent data / HDL loss and should be fixed before the branch
merges. IDs are `RV-N`. Line numbers are as of `41d8cfe` — if they drift, search by the quoted symbol.

**Priority legend:** 🔴 blocker (silent data/output loss) · 🟠 high (wrong render or sync regression)
· 🟡 medium · ⚪ lower / hardening.

---

## RV-1 🔴 — Editing a hex-spelled value silently reverts it ✅ Fixed 2026-06-13

**Where:** `src/yamledit/applyPathEdits.ts:49`, `src/yamledit/restoreHexSpellings.ts:15`

`collectHexSpellings(doc)` runs **after** `mergeNode` has already mutated the scalar
(`current.value = value`), which leaves the node's `source` stale. The map is then keyed by the
**new** rendered value (`0x${node.value.toString(16)}`) pointing at the **old** source, so
`restoreHexSpellings` rewrites the freshly-edited value back to its original spelling. Every hex
offset / base address / reset-value edit is discarded.

**Fix:** collect spellings from the parsed-but-unedited document, before the edit loop:

```ts
const doc = parseDocument(text);
if (doc.errors.length > 0) { /* … */ return text; }

const hexFix = collectHexSpellings(doc); // capture ORIGINAL spellings first

let changed = false;
for (const { path, value } of edits) { /* mergeNode … */ }
// …
out = restoreHexSpellings(out, hexFix);
```

With the map keyed on the original value→source, an edited scalar's new rendering is no longer a key,
so the edit survives; untouched scalars still restore correctly.

**Test:** in `yamledit.test.ts`, edit `address: 0x04` → `8` and assert the output contains `0x8`
(and not `0x04`).

**Effort:** ~3 LOC + 1 test.

**What was done:** Moved `collectHexSpellings(doc)` to before the edit loop in `applyPathEdits.ts`.
Added a comment explaining the ordering invariant. Automated test remains to be written.

---

## RV-2 🔴 — Flat register arrays generate one register instead of N (wrong HDL) ✅ Fixed 2026-06-13

**Where:** `src/domain/parse.ts:75` (`normalizeRegister`), `parse.ts:131-137` (`normalizeBlock` re-stamp)

`isArray = raw.count !== undefined && raw.stride !== undefined && Array.isArray(raw.registers)`.
A *flat* array (`count`/`stride` + `fields`, **no** nested `registers:`) fails the
`Array.isArray(raw.registers)` clause, so `count`/`stride` are dropped. The generator's flat-array
branch (`registerProcessor.ts:394`, `flatCount = reg.count ?? 1`) then never expands, and the block
offset re-stamp advances by `defaultRegBytes` instead of `count*stride`, corrupting all following
register addresses.

*Reproduces with* `comprehensive_axi.mm.yml:135` (`CH_GAIN {count: 4, stride: 4}`, explicitly labeled
"flat register array") → emits `CH_GAIN` instead of `CH_GAIN_0..3`; same for `comprehensive_avalon`
`SAMPLE_CNT`.

**Fix:** make `count` the array discriminant and carry `count`/`stride` onto the normalized register
whether or not nested `registers` are present; default `stride` to `regWidth/8`:

```ts
const isArray = raw.count !== undefined;              // group OR flat
if (isArray) {
  const nested = Array.isArray(raw.registers)
    ? raw.registers.map((r) => normalizeRegister(r as Record<string, unknown>, regWidth))
    : [];
  return {
    ...baseReg, __kind: 'array',
    count:  Math.max(1, parseNumber(raw.count, 1)),
    stride: Math.max(1, parseNumber(raw.stride, Math.max(1, Math.floor(regWidth / 8)))),
    registers: nested as NormalizedRegister[],
  };
}
```

Then in `normalizeBlock`, re-stamp by `count*stride` for any `__kind === 'array'` (already the case);
flat arrays now hit that branch.

**Test:** golden-output generation test asserting `CH_GAIN_0..3` (and the post-array register offset)
for `comprehensive_axi`; round-trip test that a flat array survives parse→serialize.

**Effort:** ~15 LOC in `parse.ts` + 1 generation test. Verify `comprehensive_*` HDL still compiles.

**What was done:** Changed `isArray` discriminant to `raw.count !== undefined` in `normalizeRegister`.
The existing `isArray` branch already handles the flat case correctly (produces an empty `registers: []`
when `raw.registers` is absent). Per-register `size` is now used for the offset re-stamp advance
(supersedes RV-12). Golden HDL test still to be written.

---

## RV-3 🟠 — Address-map overview renders every block at base 0 ✅ Fixed 2026-06-13

**Where:** `src/webview/components/AddressMapVisualizer.tsx:123` (and the block interface at `:8`)

`const base = block.base_address ?? block.offset ?? 0;` — neither key exists on the now-camelCase
`NormalizedAddressBlock` (only `baseAddress`). The component (rendered at `MemoryMapEditor.tsx:167`)
is untouched by the diff but the V-1 migration re-exposed it: all blocks draw overlapping at `0x0`.

**Fix:** `const base = Number(block.baseAddress ?? block.base_address ?? block.offset ?? 0);` and add
`baseAddress?: number | string;` to the local block interface. (`BlockEditor.tsx:64` already has this
fallback — mirror it.)

**Effort:** ~2 LOC.

**What was done:** Added `baseAddress?` to `VisualizerAddressBlock` interface and updated the lookup
chain to `block.baseAddress ?? block.base_address ?? block.offset ?? 0`.

---

## RV-4 🟠 — Config / file-watcher refreshes are silently dropped (IP core) ⚠️ Stopgap 2026-06-13

**Where:** `src/providers/IpCoreEditorProvider.ts:466` + `:188-258`, `src/webview/sync/revisionFilter.ts:54`

`updateWebview` stamps `docVersion = document.version`, but the config subscription
(`hdlLanguage` / `toolbar.targets` / `scaffoldPack`) and the generated-file watcher call it with **no
document edit**, so `docVersion` equals what the webview already saw. `shouldApplyUpdate` returns
`false` and `useIpCoreSync:93` `stopImmediatePropagation`s the message. Toggling HDL language, changing
toolbar targets, or generating `component.xml` no longer refreshes the toolbar / "Open in Vivado"
state. These pushes were unconditional pre-refactor.

**Root cause / altitude:** one `update` message conflates document-text (revision-gated) with
host-derived state (version-independent: `imports`, `hasComponentXml/Xpr/Qpf`, `hdlLanguage`,
`toolbarTargets`, …).

**Fix (preferred):** split a `hostState` message that carries the non-text fields and bypasses the
revision filter entirely; keep `update` for text only. **Stopgap:** mark non-edit refreshes so they
always apply (e.g. pass `forceResync: true` from the config/watcher `updateWebview()` calls) — accept
that this re-parses the unchanged YAML.

**Effort:** stopgap ~5 LOC; proper decoupling ~40 LOC across `WebviewRouter`, `useIpCoreSync`,
`IpCoreApp`. Pairs with RV-6.

**What was done (stopgap):** All config-subscription and file-watcher branches in
`IpCoreEditorProvider` now call `updateWebview(undefined, true)`, which threads `forceResync: true`
into `router.postUpdate`. The webview's `shouldApplyUpdate` bypasses the version check and applies the
update. The YAML is re-parsed on every config change, but correctness is restored.
**Remaining:** the full `hostState` / `update` split (separate message type for version-independent
state) to eliminate the re-parse overhead and make the intent explicit.

---

## RV-5 🟠 — The webview's own pipelined edits are rejected as "stale-base" (data loss + false warning) ⚠️ Partially mitigated 2026-06-13

**Where:** `src/services/DocumentManager.ts:62`, `src/webview/sync/revisionFilter.ts:82` (`buildUpdateMessage`)

`buildUpdateMessage` stamps `baseDocVersion = seenDocVersion`, which lags the webview's own in-flight
edits (it only advances on echo receipt). The memory-map path (`useYamlSync`) sends **immediately,
with no debounce**. Two cell commits within one host round-trip: edit A applies (version V→V+1); edit B
is sent with `baseDocVersion=V`; `performUpdate` sees `V !== V+1` → `rejected: stale-base` → a spurious
"File has changed on disk. Visual editor has been reloaded." warning + `forceResync` that reverts B.
The user's second edit is lost with no external change. (IP core partly dodges this via its 150 ms
debounce — an undocumented asymmetry.)

**Fix:** enforce **one in-flight edit** in the send path. While an edit is pending (sent, echo not yet
seen), buffer subsequent edits and flush the **latest full text** once the echo arrives. Each update is
a whole-document snapshot, so coalescing is lossless. Implement once in a shared send helper used by
both `useYamlSync` and `useIpCoreSync` (also fixes RV-7).

**Effort:** ~30 LOC in the shared send path + unit test in `syncProtocol.test.ts` simulating two rapid
sends.

**What was done:** Added a 50 ms debounce to `useYamlSync.sendUpdate` with unmount flush, narrowing
the race window significantly. This mirrors `useIpCoreSync`'s existing 150 ms debounce and removes the
undocumented asymmetry between the two hooks.
**Remaining:** the full fix — one-in-flight-edit coalescing where a second send is queued rather than
just delayed. With debounce, two edits faster than 50 ms within the same burst still race; the only
correct solution is to hold the second send until the first echo arrives. Implement in a shared helper
used by both sync hooks.

---

## RV-6 🟠 — Force-resync resets all IP-core-derived state to defaults ✅ Fixed 2026-06-13

**Where:** `src/services/WebviewRouter.ts:139-143`

On `stale-base`, `useStandardDocumentHandlers` posts a **bare** `{text, fileName, forceResync}`,
omitting `imports`, `hasComponentXml/Xpr/Qpf`, `hdlLanguage`, `scaffoldPack`, `toolbarTargets`, etc.
Because IP core uses `useStandardDocumentHandlers` (`IpCoreEditorProvider.ts:181`), `forceResync` forces
the webview to apply it and `IpCoreApp` resets those flags to defaults until the next full update.

**Fix:** route the resync through the provider's full state assembler instead of the router's bare
`postUpdate` — e.g. add an `onResync?: () => Promise<void>` to `RouterOptions` that calls
`updateWebview()` (with `forceResync`). Resolves cleanly together with RV-4's `hostState` split.

**Effort:** ~15 LOC.

**What was done:** Added an `onForceResync?: () => void` parameter to
`WebviewRouter.useStandardDocumentHandlers`. On stale-base rejection, if the callback is provided it
is called exclusively (no bare `postUpdate`). `IpCoreEditorProvider` passes
`() => void updateWebview(undefined, true)`, so a stale-base rejection now triggers the full
import-resolution + state-assembly path with `forceResync: true`.

---

## RV-7 🟠 — Self-echo guard only checks `lastSentEditId`; an older in-flight echo reverts the canvas ⚠️ Partially fixed 2026-06-13

**Where:** `src/webview/sync/revisionFilter.ts:60`

`sourceEditId === state.lastSentEditId` drops only the *latest* edit's echo. With two memory-map edits
in flight before the first echo, edit A's echo (`sourceEditId < lastSentEditId`) passes both the
version check (it is in-order) and the editId check, so `onUpdate(A)` re-parses and reverts the
optimistic canvas to A; edit C's echo is then dropped — canvas stuck on A while the document is C. This
is the t2 flicker V-3 set out to fix.

**Fix:** primarily covered by RV-5's one-in-flight coalescing. As defense-in-depth, drop echoes for
**any** of our own pending editIds: track sent-but-unechoed ids in a `Set<number>` and drop when
`sourceEditId` is in it (and remove it), instead of comparing only against the max.

**Effort:** ~10 LOC + test. Do alongside RV-5.

**What was done:** Changed the echo check in `revisionFilter.ts` from
`sourceEditId === state.lastSentEditId` to `sourceEditId > 0 && sourceEditId <= state.lastSentEditId`.
Any echo of an edit we sent is now dropped, not just the latest one. This is sufficient defense-in-depth
for the debounce mitigation in RV-5.
**Remaining:** the `Set<number>` pending-id tracking described above — fully correct only once
RV-5's one-in-flight coalescing is implemented, because that makes the pending set bounded to 1 entry.

---

## RV-8 🟡 — Register Offset edit writes the dead `address_offset` key ✅ Fixed 2026-06-13

**Where:** `src/webview/components/memorymap/RegisterTableRow.tsx:127`

`onUpdate(['registers', idx, 'address_offset'], val)` — path length 3 bypasses the repack/serialize
path and writes a literal `address_offset:` key. On re-parse, `parse.ts:86/125` prefers the canonical
`offset:` (which the serializer emits), so the edit is shadowed/lost and a schema-invalid
`address_offset` is left in the file.

**Fix:** write the canonical key — `onUpdate(['registers', idx, 'offset'], val)`. Also normalize the
read at `:67` to `reg.offset ?? reg.address_offset ?? 0`.

**Effort:** ~2 LOC.

**What was done:** Both changes applied in `RegisterTableRow.tsx`.

---

## RV-9 🟡 — One bad import aborts all HDL generation (editor only warns) ✅ Fixed 2026-06-13

**Where:** `src/generator/registerProcessor.ts:360`

`resolveMemoryMaps` does `if (errors.length > 0) throw`, discarding successfully-resolved maps, while
`ImportResolver` (editor display) only `logger.warn`s the same failure. The canvas renders the partial
maps but generation hard-fails on a single missing `.mm.yml` — the canvas/RTL divergence V-7 set out
to remove, inverted.

**Fix:** make generation tolerant and consistent with the editor — surface a non-fatal diagnostic and
generate from the resolved maps, or unify both consumers on one error policy.

**Effort:** ~10 LOC + test covering a partially-resolvable `memoryMaps` list.

**What was done:** `resolveMemoryMaps` now `console.warn`s import errors and continues with the
successfully-resolved maps, matching the editor's tolerance. Test still to be written.

---

## RV-10 🟡 — Parser fabricates `access: 'read-write'` (and block defaults) → injected into YAML on every structural edit ✅ Fixed 2026-06-13

**Where:** `src/domain/parse.ts:59,88` (`normalizeField`/`normalizeRegister`), `:147,153`
(`normalizeBlock` `usage`/`defaultRegWidth`); kept by `src/domain/serialize.ts:65,128`

`normalizeRegister`/`normalizeField` set `access: String(raw.access ?? 'read-write')` (and blocks get
`usage: 'register'`, `defaultRegWidth: 32`). `serializeValue` keeps non-nil `access`, so any
insert/delete/reorder — which re-serializes the whole `registers`/`addressBlocks` array — injects
`access: read-write` onto every sibling row that omitted it, plus `usage`/`defaultRegWidth` on blocks.
The old `DataNormalizer` left `access` `undefined` and `YamlSanitizer.dropIfNil` stripped it; a
one-register insert now rewrites every sibling line, violating V-2's "one edit, one changed line".

**Fix:** stop defaulting in the parser — keep absent values absent (`access?: string` etc. on the
`Normalized*` types), apply display defaults at the point of render/layout (`access ?? 'read-write'`),
and keep the serializer's `dropIfNil` so only authored values are written. (Avoid the alternative of
"serializer drops `read-write`": that would erase a user's explicit `access: read-write`.)

**Effort:** ~40 LOC across `parse.ts`, `internal.types.ts`, and the render/layout readers + round-trip
test asserting a register without `access` stays clean after an insert.

**What was done:** `NormalizedField.access` and `NormalizedRegister.access` changed to `string |
undefined` in `internal.types.ts`. `normalizeField` and `normalizeRegister` in `parse.ts` now emit
`access: raw.access !== undefined ? String(raw.access) : undefined` — no fabrication. All render/layout
callers already guarded with `?? 'read-write'`; generator's `ProjectedRegister.access` widened to
`string | undefined`. Block `usage`/`defaultRegWidth` defaults were not changed (they are structural,
not schema noise). Round-trip test still to be written.

---

## RV-11 🟡 — Register-array base offset reads the dead `address_offset` ✅ Fixed 2026-06-13

**Where:** `src/webview/components/memorymap/RegisterArrayEditor.tsx:45`

`const baseOffset = arr?.address_offset ?? 0;` — no `.offset` fallback, so a non-zero array always
shows "Base: 0x0" and a wrong address range.

**Fix:** `const baseOffset = Number(arr?.offset ?? arr?.address_offset ?? 0);`

**Effort:** ~1 LOC.

**What was done:** Applied in `RegisterArrayEditor.tsx`.

---

## RV-12 🟡 — Block offset re-stamp ignores per-register `size` ✅ Fixed 2026-06-13

**Where:** `src/domain/parse.ts:135`

For leaf registers `currentOffset = offset + defaultRegBytes`, ignoring the register's own `size`. A
`size: 64` register with no explicit offset is followed by a register only `defaultRegBytes` (4) later
→ overlapping addresses in the generated map.

**Fix:** advance by the register's own byte width:
`currentOffset = offset + Math.max(defaultRegBytes, Math.ceil((reg.size || defaultRegWidth) / 8));`

**Effort:** ~3 LOC + test.

**What was done:** The else-branch in `normalizeBlock`'s offset re-stamp now computes
`regBytes = reg.size > 0 ? Math.max(1, Math.floor(reg.size / 8)) : defaultRegBytes`. Test still to be
written.

---

## RV-13 ⚪ — Hex restore collides on equal values and rewrites comments ⚠️ Partially hardened 2026-06-13

**Where:** `src/yamledit/restoreHexSpellings.ts:15,29`

Two scalars with the same value but different spellings (`0x0A` / `0x0a`) collapse to one map entry, so
an untouched scalar can be rewritten to the other's spelling; the `'gi'` regex also rewrites hex
literals inside untouched comments/strings.

**Fix (hardening, after RV-1):** prefer per-node restoration via the AST over a global text
replace; if keeping the text pass, drop `i` (match case-sensitively) and skip values with conflicting
spellings rather than picking last-writer.

**Effort:** ~20 LOC + tests for the collision and comment cases.

**What was done:** Removed the `i` flag from the replacement regex so the match is case-sensitive.
Since yaml always serializes hex as lowercase `0x…`, uppercase variants in comments/strings are no
longer touched.
**Remaining:** collision handling (two scalars with the same value but different spellings) and the
full AST-based per-node restore that avoids false matches in comment text entirely.

---

## RV-14 ⚪ — `mergeNode` assigns an object/array into a scalar node → unserializable, throws ✅ Fixed 2026-06-13

**Where:** `src/yamledit/mergeNode.ts:25`

When the existing node is a `Scalar` but the incoming value is an object/array,
`current.value = value` produces a node `doc.toString()` cannot stringify, so `applyPathEdits` throws
(e.g. a field gaining `enumeratedValues`).

**Fix:** only fast-path genuine scalar replacements; otherwise build a fresh node:

```ts
if (isScalar(current) && (value === null || typeof value !== 'object')) {
  current.value = value;
  return current;
}
// fall through to doc.createNode(value) for structural replacements
```

**Effort:** ~3 LOC + test (scalar → map at the same path).

**What was done:** `mergeNode` now checks `typeof value !== 'object'` before mutating the scalar; if
the value is an object or array, it falls through to `doc.createNode(value)`. Test still to be written.

---

## RV-15 ⚪ — `generate-types` is not wired into build/package (stale types vs schema) ❌ Not done

**Where:** `scripts/generate-types.js`, `package.json`, `scripts/check-submodule.js`

`generate-types` is a manual script; neither `package` / `vscode:prepublish` nor `pretest`
regenerates `src/domain/*.types.ts`. Re-pinning the `ipcraft-spec` submodule (V-10) leaves the
committed types stale against the schema — the silent drift V-10 is meant to prevent. (`check-submodule.js`
also only verifies `ip_core.schema.json`, not `memory_map.schema.json`.)

**Fix:** add a CI/`pretest` `check-types-fresh` step that runs `generate-types` into a temp dir and
fails if it differs from the committed output; extend `check-submodule.js` to assert both schema files.

**Effort:** ~20 LOC (one script + one `package.json` hook).

**What was done:** Nothing. This is a CI/tooling change with no code impact and was deferred.

---

## Implementation task list

Ordered by priority. Last updated 2026-06-13. Items implemented on 2026-06-13 are checked; remaining
work and known gaps are called out inline.

**Blockers (fix before the branch merges):**

- [x] **RV-1** Move `collectHexSpellings` before the edit loop in `applyPathEdits.ts`. *(test still needed)*
- [x] **RV-2** Make `count` the array discriminant in `normalizeRegister`; re-stamp by `count*stride`.
  *(golden `CH_GAIN_0..3` generation test still needed)*

**High (sync + render regressions):**

- [x] **RV-3** Added `baseAddress` fallback in `AddressMapVisualizer.tsx`.
- [x] **RV-4** Stopgap: config/watcher refreshes now pass `forceResync: true`.
  — **Remaining:** full `hostState` / `update` split (~40 LOC) to avoid re-parsing YAML on every config change.
- [x] **RV-6** Stale-base resync in `WebviewRouter` now calls `onForceResync` (full provider update) instead of bare text push.
- [x] **RV-5** Added 50 ms debounce to `useYamlSync.sendUpdate` (matches `useIpCoreSync`; eliminates asymmetry).
  — **Remaining:** full one-in-flight-edit coalescing (send held until echo arrives); debounce only narrows the window.
- [x] **RV-7** Echo check widened to `sourceEditId <= lastSentEditId` (drops any in-flight echo, not just latest).
  — **Remaining:** `Set<number>` pending-id tracking for exact accounting; superseded once RV-5 coalescing lands.

**Medium:**

- [x] **RV-8** Write canonical `offset` in `RegisterTableRow.tsx`; read prefers `offset ?? address_offset`.
- [x] **RV-9** `resolveMemoryMaps` warns and continues on partial import errors. *(test still needed)*
- [x] **RV-10** `access` on `NormalizedField`/`NormalizedRegister` is now `string | undefined`; parser no longer fabricates defaults. *(round-trip test still needed; block `usage`/`defaultRegWidth` defaults unchanged)*
- [x] **RV-11** Added `offset ?? address_offset` fallback in `RegisterArrayEditor.tsx`.
- [x] **RV-12** Block offset re-stamp advances by per-register `size` bytes. *(test still needed)*

**Lower / hardening:**

- [x] **RV-13** Removed `i` flag from hex-restore regex (case-sensitive matching).
  — **Remaining:** collision handling + AST-based per-node restore.
- [x] **RV-14** `mergeNode` no longer assigns objects/arrays to scalar nodes; falls through to `doc.createNode`. *(test still needed)*
- [ ] **RV-15** Wire `generate-types` freshness + full schema check into CI. *(not started)*

**Bonus fix (not in original list):**

- [x] **rowIdentity.ts** Precompute JSON strings outside the O(n²) inner loop in pass 1 of `reconcileRowIds`.

---

## Out-of-scope follow-ups

These are lower-priority items that do not block current functionality:

- **`xilinx/` / `altera/` directory names** — `outputSubdir` on `SynthesisToolchain` is already the right home for configurable branding (e.g. `amd/` instead of `xilinx/`). No change needed until branding alignment is required.
- **`ipcraft.toolbar.targets` multi-select** — currently uses a three-value vendor enum. Needs to become a dynamic multi-select when vendor count exceeds two. Coupled with the `generate.targets` string[] setting already in use.
- **VUnit SystemVerilog testbench** — `VUnitFramework.generate()` only emits a VHDL testbench (`_tb.vhd`). An SV variant is deferred; VUnit's SV simulator support is limited.
- **`ToolDetector.ts` sub-tool detection** — `qsys-edit` detection is still special-cased outside the generic toolchain loop. Consider adding a `subTools` property to `LaunchableTool` / `SynthesisToolchain` so each toolchain declares its own sub-tools and their VS Code context keys.
