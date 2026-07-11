# Generator Architecture

The HDL generator pipeline: how an `.ip.yml` file becomes rendered RTL, vendor
packaging files, and testbench scaffolding.

See [Template Context Contract and BYOT Generation](../concepts/generator-backbone.md)
for the reasoning behind the design. See [Scaffold Packs](../how-to/scaffold-packs.md)
for the pack author perspective.

---

## Pipeline overview

```
.ip.yml (YAML on disk)
      |
      v
IpCoreScaffolder.generateAll()
      |
      +-- loadIpCore()           → raw IpCoreData
      |
      +-- normalizeIpCoreData()  → NormalizedIpCore (domain)
      |
      +-- buildTemplateContext() → TemplateContext
      |     |
      |     +-- clockResetResolver.resolve()
      |     +-- genericsResolver.resolve()
      |     +-- shadowRegistersResolver.resolve()
      |     +-- addressingResolver.resolve()
      |     +-- busResolver.resolve()
      |     +-- resolveMemoryMaps()
      |
      +-- assertValidContext()   ← AJV gate (throws ContractViolationError)
      |
      +-- checkPackApiVersion()  ← semver range check (throws Error)
      |
      +-- pack.files loop        → rendered file strings
      |     |
      |     +-- packLoader.evaluateCondition()
      |     +-- packLoader.render()   ← TemplateLoader (Nunjucks)
      |
      +-- generateTestbenchFiles()
      |
      +-- toolchain.scaffold()   → vendor packaging files (per target)
      |
      v
GenerateResult  { files: Record<string, string>, success, error? }
```

Entry point: `src/generator/IpCoreScaffolder.ts`.

---

## Module layout

```
src/generator/
  IpCoreScaffolder.ts        orchestrator — generateAll(), buildTemplateContext()
  registerProcessor.ts       normalizeIpCoreData(), prepareRegisters(), bus helpers
  TemplateLoader.ts          Nunjucks render engine; searches pack dir then built-ins
  ScaffoldPackLoader.ts      parses scaffold.yml; resolves workspace > built-in order

  contract/
    template_context.schema.json   JSON Schema (source of truth; do not edit types directly)
    templateContext.types.ts       generated from schema — do not hand-edit
    validate.ts                    AJV gate + ContractViolationError
    version.ts                     CONTRACT_VERSION, checkPackApiVersion(), satisfiesRange()
    index.ts                       re-exports

  resolvers/
    types.ts                       ResolverInput, ContextResolver, ContractDiagnostic
    clockReset.ts
    generics.ts
    shadowRegisters.ts
    addressing.ts
    bus.ts

  buses/
    types.ts                       BusRuleProvider interface
    registry.ts                    BusRuleRegistry class
    builtin.ts                     built-in providers (axil, axi4, avmm, axis, avst)

  packs/
    builtin-ipcraft/scaffold.yml   full layered generation
    builtin-minimal/scaffold.yml   top-level stub only
    example-*/scaffold.yml         annotated examples

  templates/
    *.j2                           Nunjucks templates (copied to dist/templates/ at build)

  testbench/
    Framework.ts, Engine.ts        testbench framework x engine interfaces
    frameworks/                    CocotbFramework.ts, VUnitFramework.ts
    engines/                       GhdlEngine.ts, IcarusEngine.ts, QuestaEngine.ts, VerilatorEngine.ts

src/shared/
  evalWidthExpr.ts                 single arithmetic parser used by generator and webview
```

---

## Contract

### Schema and generated types

`src/generator/contract/template_context.schema.json` is the single source of
truth for the shape of every context object passed to a template. Running
`npm run generate-types` compiles it into `templateContext.types.ts` via
`json-schema-to-typescript`. The TypeScript compiler then enforces the contract
at build time.

The schema uses `additionalProperties: false` at the top level. Adding a field to
`buildTemplateContext` without adding it to the schema causes `assertValidContext`
to throw, and causes `npm run generate-types` to produce an updated type. This
makes undeclared context fields impossible to ship silently.

### AJV gate

`assertValidContext(ctx: unknown): asserts ctx is TemplateContext` is called once,
in `generateAll`, between context assembly and the pack render loop. It throws
`ContractViolationError` with a human-readable list of all AJV errors if the
context fails validation. No template ever runs against an invalid context.

### Version check

`CONTRACT_VERSION` is the semver string declared in `src/generator/contract/version.ts`.
`checkPackApiVersion(pack)` compares the pack's `apiVersion` field (from
`scaffold.yml`) against `CONTRACT_VERSION` using a minimal inline range checker
that supports `^` (caret) and `~` (tilde) prefix ranges. Packs that do not declare
`apiVersion` are accepted without a check — backwards compatibility for packs
predating the versioning model.

| `apiVersion` in scaffold.yml | Behaviour |
|---|---|
| absent | accepted silently |
| `"^1.0"` | accepted when `CONTRACT_VERSION` is `1.x.x` with `x >= 0` |
| `"^2.0"` | rejected — major mismatch |
| `"~1.2"` | accepted when `CONTRACT_VERSION` is `1.2.x` |

---

## Resolvers

Each resolver implements `ContextResolver`:

```typescript
export interface ContextResolver {
  readonly name: string;
  resolve(input: ResolverInput): Record<string, unknown>;
}
```

`ResolverInput` carries the normalized IP core, the bus definitions loaded from
`ipcraft-spec/bus_definitions/`, and the `BusRuleRegistry`.

### clockResetResolver

Reads `ipCore.clocks` and `ipCore.resets`. Picks the first clock and reset name
as the primary port names. Computes `period_ns` from frequency strings (`100MHz`,
`1GHz`) for the `clocks_with_period` list used in Vivado XCI and VUnit run scripts.
Falls back to `clk` / `rst` / `reset_active_high: true` when nothing is declared.

### genericsResolver

Maps `ipCore.parameters` to the `generics` array, resolving VHDL and SystemVerilog
type names and default value formats. Builds the `xgui_pages` structure (Vivado
XGUI page/group layout) from the `uiPage` and `uiGroup` parameter attributes.

### shadowRegistersResolver

Partitions `registers` into `sw_registers` (software write access), `hw_registers`
(hardware read access), `w1c_registers` (write-1-to-clear), and `cos_registers`
(change-of-state — a W1C field with a `monitorChangeOf` reference to another W1C
field). Annotates each register with `has_cos_fields` and each W1C field with
`is_cos`.

Two exports serve different call sites:

| Function | Behaviour on invalid `monitorChangeOf` |
|---|---|
| `buildShadowRegisters()` | throws `Error` — used in generation |
| `validateShadowRegisters()` | returns `ContractDiagnostic[]` — intended for UI |

### addressingResolver

Derives `data_width` from the WDATA port width of the primary memory-mapped slave
interface as declared in the bus definitions library. Falls back to 32 when no
bus definition is available. Computes `reg_width = data_width / 8`. Computes
`addr_width` from the highest register offset (minimum 3 bits). Respects an
explicit `addrWidth` override in the `.ip.yml`.

### busResolver

Produces all bus-related context fields. For each bus interface it calls
`getActiveBusPortsFromDefinition` (in `registerProcessor.ts`) to resolve the
physical port list from the bus definitions library, then formats them as
`TemplatePort` records with VHDL type strings, SystemVerilog type strings, and
TCL width expressions for Vivado IP-XACT.

Also produces `user_ports` (ports not belonging to a bus interface) and
`interrupt_ports` (declared interrupt signals), and flattens array bus interfaces
into individual `expanded_bus_interfaces` entries.

---

## Bus rule registry

`BusRuleRegistry` maps bus type strings — whether they arrive as VLNV names
(`ipcraft:busif:axi4_lite:1.0`) or as short aliases (`AXILITE`, `axil`) — to a
`BusRuleProvider` that declares the canonical `id` and whether the protocol is
memory-mapped.

`normalizeBusType(typeName)` performs a two-pass lookup (VLNV first, alias second)
and returns `{ templateType, busLibraryKey }`. `getBusTypeForTemplate` and
`hasMemoryMappedSlaveInterface` in `registerProcessor.ts` delegate to this
registry.

---

## Pack loading and render

`ScaffoldPackLoader.resolve(packName, workspacePackDirs)` searches workspace pack
directories before the built-in packs directory. This lets a workspace pack shadow
a built-in pack of the same name.

`TemplateLoader` maintains a priority-ordered list of template directories. For
each file rule in the pack, `packLoader.render(sourceName, context)` searches:
1. The pack's own directory (enables template overrides).
2. The extension's built-in template directory.

A template in the pack directory with the same filename as a built-in template
silently shadows the built-in — the mechanism that makes template customisation
work without forking.

---

## Test pyramid

| Tier | Test files | Tools required | Runs in CI |
|---|---|---|---|
| 0 | `snapshots.test.ts`, `roundtrip.test.ts`, `conformance.test.ts` | none (pure Node) | yes (both `test` and `hdl-integration` jobs) |
| 1 | `hdl.test.ts`, `ipxact.test.ts`, `quartus.test.ts` | GHDL, iverilog, Verilator, xmllint, Docker | yes (`hdl-integration` job) |
| 2 | `vivado.test.ts` | Vivado | nightly only (`vivado-nightly.yml` workflow) |

Tier 0 tests are pure Node and run as part of every PR. They cover:

- **Snapshots** (`snapshots.test.ts`): golden-file comparison of generated file
  lists and the full text of `component.xml` and `_hw.tcl` files. A change to any
  template or resolver that alters generated output causes a snapshot diff.
- **Round-trip** (`roundtrip.test.ts`): generates `component.xml` for every fixture,
  parses it back with `ComponentXmlParser`, and asserts that VLNV and bus protocol
  invariants survive the cycle. Same for `hw.tcl` via `HwTclParser`. Exercises the
  fragile vendor packager code without any vendor binary.
- **Conformance** (`conformance.test.ts`): loads every built-in pack, verifies
  `apiVersion` compatibility, and generates each pack against a representative
  fixture. Supports `CONFORMANCE_PACK_DIR` + `CONFORMANCE_FIXTURE` for third-party
  pack self-certification.

Tier 2 tests use `guardTier2`. When Vivado is absent they skip and write a NDJSON
record to `SKIP_TELEMETRY_FILE` so the nightly artifact shows what was skipped.

---

## Width expression evaluation

`src/shared/evalWidthExpr.ts` is the single width evaluator. It accepts a string
such as `"DATA_WIDTH + 2"` and a map of parameter defaults, and returns the
evaluated integer. The algorithm is a recursive descent arithmetic parser over
`[0-9\s+\-*/().]` tokens — no `eval`, no `new Function`.

Both the webview canvas (port width preview) and the generator (TCL width
expressions in `_hw.tcl` and `component.xml`) import this module. The previous
generator-side `new Function` implementation is deleted.
