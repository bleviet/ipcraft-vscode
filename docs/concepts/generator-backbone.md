# Template Context Contract and Bring-Your-Own-Template Generation

How IPCraft separates the work of *computing* an HDL context from *rendering* it,
why that separation is necessary for reliable third-party code generation, and
what guarantees the contract makes to pack authors.

---

## The problem with an untyped context

Before the refactor, `IpCoreScaffolder.buildTemplateContext()` returned
`Record<string, unknown>` — an untyped bag of values assembled in a single
270-line method. Any change to that method could silently rename a variable,
remove a field, or change the meaning of a number, and templates would fail only
at render time, with an obscure Nunjucks error or silent empty output.

For a built-in pack that is developed alongside the generator this is manageable.
For a third-party pack author who wrote templates against last month's field names,
it is a reliability guarantee that does not exist.

Three concrete problems drove the refactor:

1. **No public API.** The set of variables available inside a `.j2` template was
   whatever `buildTemplateContext` happened to return. No schema, no stable type,
   no documented contract.

2. **Semantics entangled with assembly.** W1C/CoS shadow-register logic, bus port
   resolution, clock-period computation, and generic XGUI page layout all lived
   inside one method. None could be unit-tested without running a full generation.

3. **Two diverging width evaluators.** The webview used a hardened arithmetic
   parser; the generator path used `new Function`, an `eval`-class hazard that
   could silently diverge from the webview's result for the same expression.

---

## The template context as a public API

The refactor treats the object passed to every Nunjucks template as a **versioned
public API** — the Template Context. It is:

- **Defined by a JSON Schema** (`src/generator/contract/template_context.schema.json`)
  that specifies every field, its type, and whether it is required.
- **Generated into TypeScript types** (`templateContext.types.ts`) from that
  schema by `npm run generate-types`, so the compiler enforces the shape in code.
- **Validated at runtime** with AJV before any template render. If the context is
  missing a required field or has a field with the wrong type, generation fails
  with an actionable error that names the violated constraint, not a Nunjucks
  stack trace.
- **Versioned with SemVer.** The current contract is `1.0.0`. Within a major
  version the contract is append-only: fields can be added but not renamed,
  removed, or retyped. A pack written against `1.0.0` must keep working when
  IPCraft ships `1.3.0`.

---

## Resolver decomposition

The 270-line method was replaced by five pure, synchronous *resolvers*, each
responsible for one slice of the context:

| Resolver | Produces |
|---|---|
| `clockResetResolver` | `clock_port`, `reset_port`, `reset_active_high`, `clocks_with_period` |
| `genericsResolver` | `generics`, `xgui_pages` |
| `shadowRegistersResolver` | `registers`, `sw_registers`, `hw_registers`, `w1c_registers`, `cos_registers` |
| `addressingResolver` | `data_width`, `reg_width`, `addr_width` |
| `busResolver` | `bus_ports`, `bus_prefix`, `bus_type`, `user_ports`, `interrupt_ports`, `expanded_bus_interfaces`, `secondary_bus_interfaces`, `secondary_bus_ports`, `elaborate_port_widths` |

Each resolver takes a `ResolverInput` (the normalized IP core, the bus definitions
library, and the bus rule registry) and returns a plain object. They are pure
functions: no I/O, no side effects, no throws for validation failures. Because
they are pure and independent, each can be unit-tested in isolation with a fixture
IP core object — no template rendering required.

The orchestrator in `buildTemplateContext` runs them in sequence and merges their
outputs with the remaining scalar fields (`name`, `vendor`, `memory_maps`, etc.)
before passing the result to the AJV gate.

---

## The bus rule registry

Bus protocol knowledge used to be stored in three frozen `Map` literals in
`registerProcessor.ts`: a VLNV-to-name map, an alias map, and a set of
memory-mapped template types. Adding or changing a bus protocol meant editing
core generator source.

The `BusRuleRegistry` replaces them with a registry of `BusRuleProvider` objects.
Each provider declares the VLNV names and aliases it handles and whether it is a
memory-mapped protocol. The built-in providers (`axil`, `axi4`, `avmm`, `axis`,
`avst`) are registered at startup. `normalizeBusType` and `isMemoryMapped` become
registry lookups.

---

## Shadow registers and W1C / CoS semantics

Write-1-to-clear (W1C) and Change-of-State (CoS) register logic was previously
interleaved with the context assembly loop, making it impossible to test without
building a full context. It also threw exceptions when a `monitorChangeOf`
reference was invalid, surfacing the error as a generation failure rather than an
inline editor warning.

`shadowRegistersResolver` encapsulates this logic as a unit-testable function.
`buildShadowRegisters` still throws for hard structural errors (the contract with
the templates is unchanged). `validateShadowRegisters` returns
`ContractDiagnostic[]` for future UI integration so the same rules can be shown
as inline warnings in the register editor without aborting generation.

---

## Consolidated width evaluation

There is now exactly one width evaluator: `src/shared/evalWidthExpr.ts`. Both the
webview canvas preview and the generator import this module. The previous
`new Function` implementation in the generator path is deleted. This eliminates a
class of divergence bugs where the canvas would preview a different port width
than the generator would emit.

---

## The BYOT contract for pack authors

A scaffold pack author interacts with two things:

1. **The template context variables**, documented in the
   [scaffold packs how-to](../how-to/scaffold-packs.md). These are stable within
   a contract major version. A field that exists in `1.0.0` will exist in `1.4.0`
   with the same type and meaning.

2. **The `apiVersion` field in `scaffold.yml`**, which declares the contract range
   the pack targets:

   ```yaml
   apiVersion: "^1.0"
   ```

   IPCraft checks this range against `CONTRACT_VERSION` using semver semantics
   before any rendering begins. A pack targeting `^2.0` is rejected immediately
   with a clear error message naming the pack, its declared range, and the running
   contract version. This means a pack author is informed of a breaking change the
   first time they try to use the pack after an upgrade, not partway through
   generation.

The **pack conformance kit** (`src/test/integration/conformance.test.ts`) provides
a self-service verification harness. A third-party pack author can run it against
their own pack by setting `CONFORMANCE_PACK_DIR` and `CONFORMANCE_FIXTURE` to
verify that their pack loads, its `apiVersion` is compatible with the running
contract, and it generates without a contract violation — all without involving
IPCraft.

---

## What the contract does not cover

The contract governs the *shape* of the context object. It does not:

- Guarantee that a specific template file (e.g. `bus_axil.vhdl.j2`) exists in the
  built-in library. Template resolution is a separate concern handled by
  `TemplateLoader`.
- Constrain what a pack does with the context variables. A pack can ignore most of
  them and render whatever it needs.
- Cover the testbench generation path. `generateTestbenchFiles` receives the same
  context object but is not (yet) subject to the AJV gate.
