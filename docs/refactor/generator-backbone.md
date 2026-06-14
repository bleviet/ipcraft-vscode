# Generator Backbone: Public Template Context API, Semantic Decoupling, and Headless Validation

Status: design blueprint — the active execution plan for the generator refactor.

This document is the execution plan for turning IPCraft's HDL generator into a stable,
third-party-safe backbone. It addresses three structural requirements:

1. **Harden the template context into a versioned Public API** so external Nunjucks/Jinja2
   packs can be built without IPCraft silently breaking them.
2. **Decouple generator semantics from rendering** — separate *how* parameters, bus rules
   (AXI-Lite, Avalon-MM), and shadow registers (W1C/CoS) are *computed* from *how* they are
   *rendered*.
3. **Fix the integration suite** — eliminate silent self-skips by introducing tiered,
   open-source headless validation that fails loudly in CI.

Every claim about current behaviour below is cited to a path so the plan stays anchored to
the real tree, not an idealised one.

---

## 1. Current state (the honest baseline)

| Concern | Where it lives today | Problem for BYOT |
|---|---|---|
| Context assembly | `IpCoreScaffolder.buildTemplateContext()` returns `Record<string, unknown>` (`src/generator/IpCoreScaffolder.ts:352`, literal at `:590-626`) | The public surface third parties consume is **untyped and unvalidated**. Any refactor can silently change it. |
| Magic constants | `data_width: 32`, `reg_width: 4` hardcoded in the return (`IpCoreScaffolder.ts:609-611`) | Baked-in opinion masquerading as fact; 16/64-bit buses impossible. |
| Bus rules | `VLNV_BUS_NAME_MAP`, `BUS_TYPE_ALIASES`, `MEMORY_MAPPED_TEMPLATE_TYPES` (`src/generator/registerProcessor.ts:53-112`) | Adding a bus protocol requires editing core source. Not extensible. |
| Shadow registers (W1C/CoS) | ~90 lines inline in `buildTemplateContext` (`IpCoreScaffolder.ts:359-451`) | Semantics entangled with assembly; cannot be unit-tested or disabled per pack. |
| Width expressions | **Two** `evalWidthExpr` impls: hardened parser at `src/webview/shared/utils/evalWidthExpr.ts`, but the generator path still uses `new Function` at `src/generator/registerProcessor.ts:43` | Duplicated logic; `new Function` is an `eval`-class hazard already removed from the canvas (commit `5a12623`) but **still live in the generator**. |
| Pack resolution | `ScaffoldPackLoader` (workspace then built-in) + multi-path `TemplateLoader` (`src/generator/TemplateLoader.ts:15-27`) | Solid foundation — controls *which files* render, not the *semantics* fed in. Reuse, don't replace. |
| Vendor validation | `vivado.test.ts` self-skips when `VIVADO_BIN` is absent (`src/test/integration/vivado.test.ts:29-30`); `quartus.test.ts` already runs in Docker (`cvsoc/quartus:23.1`) but also self-skips | The most fragile code (packagers/importers) is the least continuously verified. Default is skip, not fail. |

Two assets the plan will **reuse rather than reinvent** (both already in `package.json`):

- `ajv ^8.20.0` — for runtime contract validation.
- `json-schema-to-typescript ^13.0.0`, already driving `scripts/generate-types.js` — for
  compiling the contract's TypeScript types from a single JSON Schema source of truth.

One invariant to respect throughout (from `CLAUDE.md`): **snake_case is reserved for the
Nunjucks/Jinja2 template context only.** The template context is therefore the *intended*
camelCase->snake_case boundary. That is convenient: the contract schema is exactly where the
naming convention legitimately flips.

---

## 2. Goal 1 — A hardened, versioned Template Context contract

### 2.1 Principles

1. **One source of truth.** The contract is a JSON Schema, versioned with the `ipcraft-spec`
   submodule alongside `ip_core.schema.json` and `memory_map.schema.json`.
2. **Generated types, never hand-written.** TS types are compiled from the schema, exactly
   like `src/domain/ipcore.types.ts`.
3. **Validated at the boundary.** Every context is validated with AJV *before* it reaches a
   template. Internal bugs fail closed; third-party pack errors produce actionable messages.
4. **SemVer'd and additive within a major.** Packs declare the contract range they target.

### 2.2 Schema as source of truth

Add `ipcraft-spec/schemas/template_context.schema.json` with a versioned `$id`:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ipcraft.dev/schemas/template_context/1.0.0",
  "title": "TemplateContext",
  "type": "object",
  "required": ["contract_version", "name", "entity_name", "registers", "bus", "addressing"],
  "additionalProperties": false,
  "properties": {
    "contract_version": { "type": "string", "const": "1.0.0" },
    "name": { "type": "string" },
    "entity_name": { "type": "string" },
    "addressing": { "$ref": "#/$defs/Addressing" },
    "bus": { "$ref": "#/$defs/Bus" },
    "registers": { "type": "array", "items": { "$ref": "#/$defs/Register" } }
    // ... clocks, resets, generics, user_ports, shadow_registers, memory_maps
  },
  "$defs": {
    "Addressing": {
      "type": "object",
      "required": ["data_width", "reg_width", "addr_width"],
      "properties": {
        "data_width": { "type": "integer", "enum": [8, 16, 32, 64, 128] },
        "reg_width":  { "type": "integer" },
        "addr_width": { "type": "integer", "minimum": 1 }
      }
    }
    // ... Bus, Register, Field, ShadowRegister
  }
}
```

Note `data_width`/`reg_width` move under an `addressing` object and become *real* values
(see 3.6), not hardcoded `32`/`4`.

### 2.3 Generated types

Extend `scripts/generate-types.js` (same `compile()` call it already uses) to emit
`src/generator/contract/templateContext.types.ts`:

```ts
// src/generator/contract/index.ts
export type { TemplateContext } from './templateContext.types';
export const CONTRACT_VERSION = '1.0.0' as const;
```

`buildTemplateContext` stops returning `Record<string, unknown>` and returns `TemplateContext`.
That single signature change converts the most important public surface in the codebase from
"anything" to "this exact shape", checked by `tsc`.

### 2.4 Runtime validation (reusing AJV)

```ts
// src/generator/contract/validate.ts
import Ajv, { type ValidateFunction } from 'ajv';
import schema from '../../../ipcraft-spec/schemas/template_context.schema.json';
import type { TemplateContext } from './templateContext.types';

const ajv = new Ajv({ allErrors: true, strict: false });
const validator: ValidateFunction<TemplateContext> = ajv.compile(schema);

export function assertValidContext(ctx: unknown): asserts ctx is TemplateContext {
  if (validator(ctx)) return;
  const detail = (validator.errors ?? [])
    .map((e) => `  - context${e.instancePath || ''} ${e.message}`)
    .join('\n');
  throw new ContractViolationError(
    `Template context failed contract ${ctx?.['contract_version'] ?? '?'} validation:\n${detail}`
  );
}
```

Call it once, at the render boundary in `TemplateLoader.render` (or in the scaffolder just
before the render loop) so **no template ever runs against an invalid context** — neither
built-in nor third-party.

### 2.5 Versioning policy

- `contract_version` is injected into every context and surfaced to templates.
- A pack's `scaffold.yml` declares the range it targets: `apiVersion: "^1.0"`.
- `ScaffoldPackLoader.load` parses it; the scaffolder checks it against `CONTRACT_VERSION`
  using `semver.satisfies` and refuses to render an incompatible pack with a clear message
  ("pack X targets ^2.0 but this IPCraft provides contract 1.4.0").

| Change | SemVer impact |
|---|---|
| Add an optional field | minor |
| Add a value to an enum | minor |
| Remove/rename a field, change a type, change a computed meaning | **major** |
| Fix a value that was wrong vs. its documented meaning | patch |

Within a major, the contract is **append-only**. That is the entire promise that makes BYOT
safe. AJV's `additionalProperties: false` on the schema is what enforces it in tests: if a
field is added without a schema bump, conformance tests fail.

---

## 3. Goal 2 — Decouple semantics (compute) from rendering (present)

### 3.1 The target pipeline

```
NormalizedIpCore (domain)
      |
      v
[ ContextResolvers ]  -- pure, typed, independently testable
      |
      v
TemplateContext (validated IR)   <-- the Public API from Goal 1
      |
      v
[ TemplateLoader.render ]         <-- presentation only; no business logic
```

The key idea: `buildTemplateContext` becomes a thin **orchestrator** that runs a list of
resolvers and assembles their typed outputs. Today it is a 270-line method that mixes
filtering, validation, throwing, and shaping. After: each concern is a small unit.

### 3.2 The resolver interface

```ts
// src/generator/resolvers/types.ts
export interface ResolverInput {
  readonly ipCore: NormalizedIpCore;
  readonly memoryMaps: readonly NormalizedMemoryMap[];
  readonly buses: BusRuleRegistry;     // see 3.3
  readonly config: GeneratorConfig;    // data width, addr width override, feature flags
}

/** A resolver computes one slice of the context. Pure: no IO, no throw-for-control-flow. */
export interface ContextResolver<K extends keyof TemplateContext> {
  readonly key: K;
  resolve(input: ResolverInput): TemplateContext[K];
  /** Domain-level validation errors surfaced to the user, not exceptions. */
  validate?(input: ResolverInput): readonly ContractDiagnostic[];
}
```

Initial resolver set (one file each under `src/generator/resolvers/`):

| Resolver | Replaces inline logic at | Output slice |
|---|---|---|
| `AddressingResolver` | `IpCoreScaffolder.ts:574-587` + hardcoded `:609-611` | `addressing` |
| `BusResolver` | `IpCoreScaffolder.ts:460-522` | `bus`, secondary interfaces |
| `RegisterResolver` | `prepareRegisters` (`registerProcessor.ts:375-453`) | `registers` |
| `ShadowRegisterResolver` | W1C/CoS block `IpCoreScaffolder.ts:359-451` | `shadow_registers` (w1c/cos) |
| `ClockResetResolver` | `IpCoreScaffolder.ts:453-458, 568-572` | `clocks`, `resets` |
| `GenericResolver` | `prepareGenerics` (`:629+`) | `generics`, `xgui_pages` |

Each resolver is unit-tested against `NormalizedIpCore` fixtures with **zero rendering** —
the W1C/CoS validation (currently `throw new Error(...)` inside the assembly loop) becomes
`ShadowRegisterResolver.validate()` returning structured diagnostics the UI can show inline.

### 3.3 Bus rules as a registry, not a hardcoded map

Replace the three frozen maps in `registerProcessor.ts` with a provider registry:

```ts
// src/generator/buses/types.ts
export interface BusRuleProvider {
  readonly id: string;                 // 'axil', 'avmm', ...
  readonly aliases: readonly string[]; // 'AXI4L', 'AXILITE', 'ipcraft.busif.axi4_lite'
  readonly memoryMapped: boolean;      // replaces MEMORY_MAPPED_TEMPLATE_TYPES
  readonly wrapperKind: 'memory-mapped' | 'streaming' | 'conduit';
  resolvePorts(iface: NormalizedBusInterface, ctx: BusResolveCtx): TemplatePort[];
}

export class BusRuleRegistry {
  private readonly byAlias = new Map<string, BusRuleProvider>();
  register(p: BusRuleProvider): void { /* index id + aliases, reject dup */ }
  match(typeName: string): BusRuleProvider | undefined { /* normalize, look up */ }
}
```

Built-in providers (`axil`, `axi4`, `avmm`, `axis`, `avst`) live in
`src/generator/buses/builtin/` and are registered at startup. The existing
`getActiveBusPortsFromDefinition` logic (`registerProcessor.ts:239-347`) moves behind
`resolvePorts`. A third party (or a future paid pack) can `register()` a custom protocol
without forking core. `normalizeBusType` / `getBusTypeForTemplate` become thin lookups over
the registry.

### 3.4 Shadow-register semantics behind a flag

The W1C/CoS machinery is powerful but is currently *always on*. Move it into
`ShadowRegisterResolver`, gated by `config.features.shadowRegisters` (default on for
`builtin-ipcraft`, off for minimal/BYOT packs that do not model it). The resolver owns the
"monitorChangeOf must be W1C" and "monitored field must exist" rules as diagnostics, not
exceptions thrown mid-assembly.

### 3.5 Consolidate width evaluation; delete `new Function`

There must be exactly one width evaluator. Promote the hardened parser
(`src/webview/shared/utils/evalWidthExpr.ts`) to a shared, environment-neutral module (e.g.
`src/shared/evalWidthExpr.ts`) and have both the webview and the generator import it. Delete
the `new Function` implementation at `registerProcessor.ts:17-49`. This removes an `eval`-class
hazard from the extension-host path and erases a silent divergence between what the canvas
previews and what the generator emits.

### 3.6 Make the magic constants inputs

`AddressingResolver` derives `data_width` from the primary memory-mapped bus (its data port
width), `reg_width` from `data_width / 8`, and keeps the existing `addr_width` auto-compute
(`IpCoreScaffolder.ts:574-587`) with the `addrWidth` YAML override. `32`/`4` become the
*default*, not the *law*. This is also schema-enforced via the `data_width` enum in 2.2.

---

## 4. Goal 3 — Tiered headless validation that fails loudly

### 4.1 The test pyramid

| Tier | Tools required | Runs | What it proves |
|---|---|---|---|
| **0 — Contract & round-trip** | none (pure Node) | every PR | AJV contract validity; generate -> re-import -> equality; golden snapshots |
| **1 — Open-source headless** | GHDL, iverilog, `xmllint`, Docker (Quartus image) | every PR in CI | HDL compiles; component.xml is IP-XACT/IEEE-1685 schema-valid; hw.tcl passes Platform Designer stub |
| **2 — Licensed deep** | Vivado | nightly / manual, explicitly gated | `ipx::check_integrity`, OOC synthesis |

Tier 0 + Tier 1 cover the fragile packager/importer code **without any licensed binary**,
which is precisely the gap the critique flagged.

### 4.2 The anti-self-skip rule (invert the default)

The current default is "skip unless `REQUIRE_VIVADO=1`" (`vivado.test.ts:29-30`). Invert it
per tier:

- **Tier 0 and Tier 1 have no skip path.** If a Tier 1 tool is missing, the test *fails*. CI
  must provide the tools (containerised). Local devs without them run `npm run test`
  (Tier 0) which needs nothing.
- **Tier 2 keeps an opt-out, but it is loud and tracked.** A skipped Tier 2 test emits a
  `console.warn` *and* records a JUnit `skipped` entry so dashboards show coverage gaps
  instead of green-by-omission.

Concretely, replace the boolean `SKIP` with a tier-aware guard:

```ts
// src/test/integration/tier.ts
export function requireTool(tool: ToolSpec): void {
  if (tool.available()) return;
  if (tool.tier <= 1) {
    throw new Error(`[tier ${tool.tier}] ${tool.name} is required in CI but was not found.`);
  }
  // tier 2: allowed to skip, but never silently
  console.warn(`[tier 2] SKIPPING ${tool.name}: ${tool.reason}`);
  recordSkip(tool.name);
}
```

### 4.3 Round-trip property tests (the real safety net for fragile code)

The packagers and importers already exist as inverse pairs:
`VivadoComponentXmlGenerator` <-> `ComponentXmlParser`, and the hw.tcl emitter <->
`HwTclParser`. Exploit that. For each fixture IP core:

```
IpCoreData --generate--> component.xml --ComponentXmlParser.parse--> IpCoreData'
assert deepEqualOnContract(IpCoreData, IpCoreData')   // VLNV, buses, registers, fields
```

This is Tier 0 — no Vivado, no Docker — yet it exercises the exact CRC/VLNV/variant logic
that breaks across vendor versions. It is the single highest-leverage test to add first.

### 4.4 A pack conformance kit (so BYOT is self-certifying)

Ship a reusable harness: given any pack, render it against a fixture matrix and assert the
outputs (a) validate against the contract and (b) compile under GHDL/iverilog. Built-in packs
run it in CI; third parties run the same kit to certify their pack against a contract version
before publishing. This makes "does my pack work?" answerable without IPCraft's involvement,
which is the whole point of a Public API.

### 4.5 CI image

One container with GHDL + iverilog + `xmllint` (+ the IEEE-1685 XSD) + Docker-in-Docker for
the Quartus image. The licensed Vivado job is a separate, nightly workflow with the binary
mounted, running Tier 2 only.

---

## 5. Phased roadmap

Sequencing is deliberate: **build the safety net before refactoring, freeze the contract
before decomposing behind it, publish only once it is stable.**

### Phase 0 — Characterize & net (no behaviour change)
- Add golden-file snapshots of current generated output for the example IP cores.
- Add the Tier 0 round-trip tests (4.3) against today's generator.
- Flip CI skip defaults to the tier model (4.2); make Tier 1 (incl. existing Quartus Docker
  and HDL compile gate `test:integration:hdl`) required.
- **Exit:** CI fails loudly if any current vendor/HDL path regresses. Risk: low. This phase
  ships value even if the rest slips.

### Phase 1 — Extract the contract (shape only, semantics frozen)
- Author `template_context.schema.json` describing today's output 1:1 (group widths under
  `addressing`, but keep `32`/`4` values for now).
- Wire `generate-types.js`; type `buildTemplateContext(): TemplateContext`.
- Add the AJV gate (2.4). Golden snapshots from Phase 0 must be byte-identical.
- **Exit:** context is typed + validated, output unchanged. Risk: low/medium (mechanical).

### Phase 2 — Decompose behind the stable contract
- Extract resolvers (3.2); introduce `BusRuleRegistry` (3.3); move W1C/CoS (3.4).
- Consolidate `evalWidthExpr`, delete `new Function` (3.5).
- Make widths real inputs (3.6).
- Snapshots + round-trip + HDL compile gate guard every step.
- **Exit:** semantics modular and unit-tested; output still snapshot-stable. Risk: medium —
  but fully covered by Phase 0/1 nets.

### Phase 3 — Publish (BYOT GA)
- Tag contract `1.0.0`; add `apiVersion` gating in `ScaffoldPackLoader` (2.5).
- Ship the pack conformance kit (4.4) and contract reference docs (generated from the schema).
- Extract `builtin-ipcraft` as the reference external pack per the BYOT critique.
- **Exit:** a third party can build and self-certify a pack. Risk: low (additive).

### Phase 4 — Deepen validation
- Nightly Tier 2 (licensed Vivado) workflow; expand the fixture matrix; track skip telemetry.
- **Exit:** the fragile vendor surface has continuous, layered coverage.

---

## 6. Target module layout

```
src/generator/
  contract/
    templateContext.types.ts   # generated from ipcraft-spec schema (do not hand-edit)
    validate.ts                # AJV gate + ContractViolationError
    version.ts                 # CONTRACT_VERSION, semver compatibility check
  resolvers/
    types.ts                   # ContextResolver, ResolverInput, ContractDiagnostic
    addressing.ts  bus.ts  registers.ts  shadowRegisters.ts  clockReset.ts  generics.ts
  buses/
    types.ts  registry.ts
    builtin/ axil.ts  axi4.ts  avmm.ts  axis.ts  avst.ts
  render/                      # TemplateLoader stays here, render-only
src/shared/
  evalWidthExpr.ts             # single hardened arithmetic parser (was webview-only)
scripts/integration/
  ipxact/                      # IEEE-1685 XSD + xmllint runner (Tier 1)
ipcraft-spec/schemas/
  template_context.schema.json # the contract, versioned with the submodule
```

---

## 7. Invariants and risks

- **snake_case boundary:** the contract schema is the only place camelCase domain becomes
  snake_case template keys. Do not leak snake_case earlier or camelCase later (`CLAUDE.md`).
- **`rowId`/`__kind` never reach the context.** They are UI-only and stripped at serialize;
  the AJV `additionalProperties: false` rule now also catches any accidental leak.
- **Rendering quirks unchanged:** `trimBlocks`/`lstripBlocks` behaviour
  (`TemplateLoader.ts:23-27`) must be preserved; snapshots will catch stray-newline regressions.
- **Append-only contract within a major** is the load-bearing promise; the conformance kit
  and `additionalProperties: false` are what keep it honest.
- **Biggest risk** is Phase 2 semantic drift; it is bought down entirely by doing Phase 0
  first. Do not reorder.
- **The submodule coupling:** the contract schema lives in `ipcraft-spec`; a contract bump is
  a submodule commit, mirroring how `ip_core`/`memory_map` schema changes already flow.

---

## 8. First three pull requests

1. **Tier 0 net:** golden snapshots + generate/parse round-trip tests for the example cores.
   No source changes. Immediate, durable safety.
2. **CI tiering:** introduce `requireTool` (4.2), make Tier 1 required, keep Vivado as loud
   Tier 2. Inverts the silent-skip default.
3. **Contract skeleton:** `template_context.schema.json` mirroring current output + generated
   types + AJV gate, with snapshots proving byte-identical output.

These three deliver the critique's core demand — the fragile surface becomes continuously
tested and the public surface becomes typed and validated — before a single semantic line is
moved.
