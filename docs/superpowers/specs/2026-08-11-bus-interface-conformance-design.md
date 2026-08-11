# Bus Interface Conformance Design

**Status:** Approved — revised after three code-review passes; implementation
plan pending.

This document defines declarative bus-interface contracts, shared conformance
validation, editor diagnostics, and lossless vendor import/export behavior for
IPCraft. It covers all five built-in bus definitions and makes the same contract
mechanism available to project-defined buses.

## Problem

IPCraft currently describes the signals and default widths of its built-in bus
interfaces, but it does not describe or enforce the relationships that make those
signals protocol-conformant. `portWidthOverrides` accepts arbitrary integer or
string values. JSON Schema validation proves only that the document has the right
shape; HDL and vendor consistency checks compare declarations with generated or
imported artifacts but do not prove that the interface itself is legal.

This permits examples such as an 8-bit AXI4-Lite data interface or an AXI4-Stream
`TKEEP` width unrelated to `TDATA` to pass the current schema. It also loses
Avalon-ST semantics such as `dataBitsPerSymbol`, `symbolsPerBeat`, and
`readyLatency` when importing `_hw.tcl`.

The webview also contains hard-coded copies of built-in bus definitions. Those
copies can and currently do disagree with `ipcraft-spec`, so the extension,
editor, importer, and generator do not share one protocol authority.

Replacing those copies is an observable canvas migration, not a pure refactor.
For example, the canonical Avalon-MM YAML marks `clk` and `reset` optional, has
eight logical ports absent from the webview table (`byteenable_n`,
`debugaccess`, `lock`, `writeresponsevalid`, `readdatavalid_n`,
`waitrequest_n`, `read_n`, and `write_n`), and does not contain the webview-only
`chipselect`. The implementation must make and test those behavior changes
deliberately.

## Goals

- Make `ipcraft-spec` the single source of truth for the five built-in bus
  contracts: AXI4-Lite, AXI4 Full, AXI4-Stream, Avalon-MM, and Avalon-ST.
- Canonicalize documented short aliases and foreign vendor VLNVs through
  explicit definition data before exact contract lookup.
- Express common width, presence, and interface-property rules declaratively,
  without embedding protocol-specific branches throughout TypeScript code.
- Validate the same effective interface in the editor, explicit checker,
  importers, generators, exporters, and CI.
- Preserve valid parameterized interfaces while distinguishing proven,
  unresolved, and invalid widths.
- Preserve Avalon-ST symbol semantics across `_hw.tcl`, `.ip.yml`, generated
  `_hw.tcl`, and custom IP-XACT packaging.
- Give users actionable, source-located diagnostics on the canvas, in the
  inspector, and in one consolidated Issues panel.
- Give LLM-based agents a compact orientation backed by a detailed canonical
  reference and machine-readable constraints.
- Allow project bus definitions to opt into the same constraint vocabulary.

## Non-goals

- Proving dynamic RTL behavior such as handshake stability, ordering, burst
  legality, or timing at runtime.
- Implementing an arbitrary expression or scripting language in bus definitions.
- Silently repairing invalid documents or changing a protocol during import or
  export.
- Automatically converting Avalon-ST into AXI4-Stream.
- Generating an Avalon-ST-to-AXI4-Stream data packing adapter in this feature.
- Replacing vendor protocol checkers or simulation assertions.

## Selected approach

Bus definition YAML gains a small, versioned declarative contract model. A
single pure TypeScript resolver and validator interprets the model. This was
chosen over protocol-specific TypeScript validators and over a general-purpose
constraint expression language.

Protocol-specific validators would be easy to start but would duplicate policy,
make custom bus constraints impossible without code changes, and encourage
different importer, UI, and generator behavior. A general expression language
would be flexible but would add parsing, security, diagnostics, and
compatibility complexity beyond the required relationships.

## Ownership and dependency direction

The dependency direction is:

```text
ipcraft-spec bus definitions and schemas
  -> pure contract types, normalizer, width resolver, and validator
  -> loading, import, checking, and generation services
  -> hooks and typed message construction
  -> components and application roots
```

`ipcraft-spec` owns:

- the hand-authored bus-definition JSON Schema;
- the five built-in bus definition YAML files;
- the short-name and foreign-VLNV aliases for those built-ins;
- the canonical port-role, interface-mode, and interface-kind metadata;
- declarations of interface properties;
- root, derived, and fixed port-width policies;
- constraints and stable rule identifiers; and
- the detailed bus-interface conformance reference.

The extension owns filesystem discovery and precedence through
`BusLibraryService`. It validates and normalizes built-in and workspace bus
definitions into a typed `BusDefinitionContract` library. The normalized runtime
library, rather than the raw files or hard-coded webview tables, crosses the
existing extension/webview message boundary.

The new `ipcraft-spec/schemas/bus_definition.schema.json` is authored directly
as JSON Schema. The current submodule contains generated Pydantic schema
artifacts but no Python model or schema-generation path to extend. Therefore
`npm run generate-types` is extended to generate
`src/domain/busDefinition.types.ts` from the hand-authored bus-definition
schema. The schema is copied and packaged with the other resource schemas.

The pure conformance module must have no dependency on VS Code, React,
filesystem access, generator templates, or components. Its inputs are a bus
contract, one interface declaration, active ports, effective parameter values,
and resolution options. Its outputs are resolved port widths, resolved semantic
properties, and structured diagnostics.

The webview's hard-coded built-in definition tables are removed. `IpCoreApp`
receives the runtime library and injects narrow lookup and validation functions
into hooks and components. Protocol matching, grouping, ungrouping, layout,
inspection, import preview, and generation therefore use the same definitions.

As part of that move, `HwTclParser` must stop importing `lookupBusDef` from the
webview directory. Parser, generator, and webview consumers instead depend on
the shared normalized contract lookup, restoring the intended dependency
direction.

## Specification model

### `.ip.yml` interface properties

`BusInterface` gains an optional camelCase `interfaceProperties` object for
semantic values that are not physical signals:

```yaml
busInterfaces:
  - name: streamOut
    type: ipcraft:busif:avalon_st:1.0
    mode: source
    physicalPrefix: source_
    portWidthOverrides:
      data: 32
    interfaceProperties:
      dataBitsPerSymbol: 8
      symbolsPerBeat: 4
      readyLatency: 0
```

`portWidthOverrides` continues to describe physical logical-port widths.
`interfaceProperties` describes protocol meaning. The schema permits numeric
parameter references where the corresponding property declaration permits
them, using the same width-expression subset supported by IPCraft parameters.

Because property names are contract-specific, `ip_core.schema.json` validates
the object and scalar value shapes but cannot enumerate all valid keys. For a
recognized contract, the conformance validator rejects an unknown
`interfaceProperties` key and reports the valid keys. For a genuinely unknown
VLNV or a legacy custom definition without a contract, the map is opaque,
preserved, and does not produce protocol diagnostics.

### Canonical endianness

`BusInterface.endianness` remains the single canonical `.ip.yml` field for
interface lane ordering. Avalon-ST `firstSymbolInHighOrderBits` is a vendor
import/export representation of that field and is not also stored in
`interfaceProperties`.

The meaning of interface endianness is protocol-aware. AXI and Avalon-MM use
eight-bit byte lanes. Avalon-ST uses lanes of `dataBitsPerSymbol` bits, so an
interface with one-bit symbols reverses symbol lanes rather than groups of eight
bits. Raw standalone-port endianness remains byte-oriented. Importers map the
vendor property to `endianness`; Altera generation maps `endianness` back to
`firstSymbolInHighOrderBits`.

This is an intentional generated-RTL compatibility change for Avalon-ST. Today,
the generator and canvas validation treat every data role as byte-lane based, so
a five-bit, one-bit-symbol big-endian stream produces no reordering. After this
migration, it reverses five one-bit symbol lanes. The implementation must make
the swap unit explicit in generated template context rather than reuse the
byte-only `needsByteSwap` decision. The standalone-port
`portEndiannessApplies` helper remains byte-oriented; Avalon-ST bus controls and
diagnostics use the resolved contract and symbol width instead.

### Bus contract version and compatibility

The bus-definition schema recognizes a version-1 contract. The constraint
section remains optional for legacy custom definitions. All five shipped
built-ins are required by repository tests to declare a complete version-1
contract.

Malformed contracts are rejected when loading the library. A malformed custom
definition is excluded and reported with its source file and schema path; it
must not crash the editor or weaken a built-in definition.

### Port width policies

Each width-bearing port has one of three policies:

- `root`: a width selected directly by the interface author, such as AXI-Stream
  `TDATA` or Avalon-ST `data`;
- `derived`: a width computed from a root port or semantic property, such as
  `TKEEP`, `WSTRB`, or Avalon-ST `empty`; or
- `fixed`: a protocol-defined constant width, such as `VALID`, `READY`, and AXI
  response/control fields.

Derived widths use named operations with typed operands. Version 1 supports
only the operations needed by the built-ins:

- copy another port's width;
- multiply or divide a port/property width by a positive integer;
- multiply two semantic properties;
- `ceil(log2(value))`;
- require enough bits to encode a declared maximum value; and
- derive the maximum value encodable by a port width (`2^width - 1`).

This is not a general expression language. Contract normalization rejects
unknown operations, missing operands, division by zero, circular derivations,
and references to undeclared ports or properties.

An explicit override of a derived port is accepted for compatibility only when
it equals the computed width. An override of a fixed port is an error unless it
equals the fixed width. Matching redundant overrides are preserved until the
user changes the related root value; loading a document never rewrites it. See
"Root and derived width behavior" for the deterministic root-edit cleanup rule.

### Interface property declarations

A contract may declare semantic properties with:

- type (`integer`, `boolean`, or `string` where required);
- default value;
- minimum and maximum values;
- allowed values;
- whether the property becomes required when a named port is active; and
- whether omission can be resolved from active port widths and other
  properties.

Avalon-ST version 1 declares at least `dataBitsPerSymbol`, `symbolsPerBeat`,
`readyLatency`, and `maxChannel`. `firstSymbolInHighOrderBits` is excluded
because `BusInterface.endianness` is its canonical representation. Additional
properties such as error descriptions can be added later without expanding the
constraint language.

### Port roles

Every built-in port declares exactly one canonical role:

- `clock` and `reset` identify association ports that the canvas may hide;
- `data` identifies protocol payloads whose lane ordering is meaningful;
- `byteQualifier` identifies one-bit-per-byte masks that follow byte-lane
  ordering; and
- `control` covers other protocol signals.

The normalizer carries this single `role` field to all consumers. It does not
produce separate `role` and `endianRole` fields. Legacy custom ports without a
role normalize to `control`. An unrecognized role on a workspace definition
also normalizes to `control` and produces a `BUS_DEF_UNKNOWN_PORT_ROLE` warning
with the source file and schema-style document path, such as
`["ports", 3, "role"]`; this annotation typo does not exclude the entire
definition from the canvas. The bus-definition schema therefore validates
`role` as a non-empty string, while semantic normalization recognizes the
canonical vocabulary. Repository tests require every built-in port to have a
recognized explicit role and treat any built-in role warning as a failure.

The five built-ins explicitly mark `clk`/`ACLK` as `clock`,
`reset`/`ARESETn` as `reset`, and all remaining ports with their appropriate
roles.

### Interface modes

Each contract declares its canonical producer and consumer modes and the mode
aliases it accepts. AXI4, AXI4-Lite, AXI4-Stream, and Avalon-MM use
`master`/`slave`; Avalon-ST uses `source`/`sink`. For legacy Avalon-ST documents,
`master` normalizes in memory to `source` and `slave` to `sink` without rewriting
the document merely because it was opened. New imports and UI-created
Avalon-ST interfaces serialize `source` or `sink`.

Port directions in a definition are expressed from the declared producer mode
and are reversed for the consumer mode. Presence dependencies are evaluated
after mode normalization. A mode outside the contract's canonical modes or
declared aliases is an error.

### Interface kind and addressability

Every version-1 contract declares one `interfaceKind`: `memoryMapped`,
`streaming`, or `conduit`. This metadata replaces protocol-name inference. A
single, non-array interface may carry `memoryMapRef` and act as an interrupt
association target only when its resolved contract is `memoryMapped` and its
normalized mode is the consumer mode. A custom bus can opt into this behavior
by declaring a version-1 memory-mapped contract. An unknown VLNV or legacy
contract-less custom definition is not assumed to be memory-mapped.

If an interface declares `memoryMapRef` but contract lookup fails, its resolved
`interfaceKind` is not `memoryMapped`, or its normalized mode is not the
contract's consumer mode, validation emits blocking
`BUS_MEMORY_MAP_UNSUPPORTED` at that interface's `memoryMapRef` path. Generation
must stop before addressing or register-file resolution rather than silently
falling back to a default data width or omitting the register file.

### Constraint vocabulary

Version 1 supports named constraints for:

- numeric range, allowed values, and integer multiple;
- equal port widths;
- quotient, product, and `ceil(log2())` relationships;
- port presence dependencies;
- property-required-when-port-present dependencies; and
- recommendation severity for preferred but not mandatory shapes.

Every constraint has a stable `ruleId`, default diagnostic code, severity, and
message template. Known protocol violations are errors. Standards or ecosystem
preferences that are not protocol requirements are warnings.

A representative definition fragment is:

```yaml
AVALON_STREAMING:
  busType:
    vendor: ipcraft
    library: busif
    name: avalon_st
    version: '1.0'
  aliases:
    - kind: short
      value: AVST
    - kind: vlnv
      vendor: altera.com
      library: interface
      name: avalon_streaming
      version: '*'
  contract:
    version: 1
    interfaceKind: streaming
    modePolicy:
      producer: source
      consumer: sink
      aliases:
        master: source
        slave: sink
    interfaceProperties:
      dataBitsPerSymbol:
        type: integer
        default: 8
        minimum: 1
      symbolsPerBeat:
        type: integer
        minimum: 1
    constraints:
      - ruleId: avalonStDataLayout
        code: AVALON_ST_DATA_LAYOUT
        kind: productEqualsPort
        port: data
        properties: [dataBitsPerSymbol, symbolsPerBeat]
        severity: error
  ports:
    - name: clk
      presence: optional
      role: clock
      widthPolicy: fixed
      width: 1
    - name: reset
      presence: optional
      role: reset
      widthPolicy: fixed
      width: 1
    - name: data
      width: 32
      role: data
      widthPolicy: root
    - name: empty
      width: 2
      role: control
      widthPolicy: derived
      derivedWidth:
        operation: ceilLog2
        property: symbolsPerBeat
```

The bus-definition JSON Schema fixes these field names and the operand shape for
each `kind` and `operation`. Implementations do not accept alternate spellings or
untyped operand objects.

## Built-in conformance rules

The first contract version enforces the following static declaration rules.

### AXI4-Lite

- `WDATA` and `RDATA` have equal widths and are either 32 or 64 bits.
- `WSTRB` is `WDATA / 8`.
- Write and read address widths agree.
- Single-bit handshake and control ports are fixed.
- `AWPROT` and `ARPROT` are 3 bits; `BRESP` and `RRESP` are 2 bits.
- Required read and write channel ports cannot be removed from the built-in
  full AXI4-Lite interface definition.

### AXI4 Full

- Data widths are 8 through 1024 bits in powers of two.
- `WDATA` and `RDATA` have equal widths.
- `WSTRB` is `WDATA / 8`.
- `BID` matches `AWID`, and `RID` matches `ARID`.
- Burst, size, lock, cache, protection, quality-of-service, response, last, and
  handshake fields use their protocol-defined widths.
- Presence dependencies prevent a response or sideband port from being active
  without the channel it qualifies.

### AXI4-Stream

- `TDATA` is a positive multiple of eight bits.
- When active, `TKEEP` and `TSTRB` are each `TDATA / 8`.
- `TVALID`, `TREADY`, and `TLAST` are one bit.
- Power-of-two byte widths from 8 through 1024 are recommendations, not
  mandatory constraints.
- Optional sidebands retain their declared fixed or configurable policies.

### Avalon-MM

- Active read and write data ports agree in width.
- Data width is byte-aligned, a power of two, and no more than 1024 bits.
- `byteenable` is the active data width divided by eight.
- Read/write control, wait, response-valid, and response fields retain their
  defined widths.
- Address-unit and byte-enable relationships are validated where the contract
  has enough information; dynamic behavior and address translation remain out
  of scope.

### Avalon-ST

- Effective `data` width equals
  `dataBitsPerSymbol * symbolsPerBeat`.
- `dataBitsPerSymbol` and `symbolsPerBeat` are positive and need not be powers
  of two.
- If omitted for a legacy document, `dataBitsPerSymbol` defaults to 8 and
  `symbolsPerBeat` is derived from the effective data width when divisible.
- Explicit properties take precedence over defaults and must satisfy the data
  width product.
- When active, `empty` is `ceil(log2(symbolsPerBeat))`, requires more than one
  symbol per beat, and requires packet support. `startofpacket` and
  `endofpacket` are enabled as a pair; `empty` additionally depends on
  `endofpacket`.
- `readyLatency` is a non-negative integer and is relevant when `ready` is
  active.
- When `channel` is active and `maxChannel` is omitted, it is derived as the
  maximum value representable by the channel width (`2^channelWidth - 1`). An
  explicit `maxChannel` must be non-negative and fit within that width.
- Signal widths remain within the ranges declared by the Avalon-ST contract.

The Avalon-ST symbol rules follow Altera's current interface specification,
which defines `dataBitsPerSymbol` and `symbolsPerBeat` independently and does
not restrict symbol size to a power of two:
<https://docs.altera.com/r/docs/683091/22.3/avalon-interface-specifications/synchronous-interface>.

## Effective-width resolution

Contract selection has a separate table-driven canonicalization step:

1. An exact canonical built-in or custom VLNV selects that contract.
2. A declared short alias such as `AXI4L` maps to its canonical VLNV.
3. A structured foreign-VLNV alias matches vendor, library, and name exactly;
   its version is either exact or the explicit `"*"` wildcard.
4. A genuinely unknown VLNV has no protocol contract. It receives structural,
   schema, and HDL consistency checks, but the lack of a contract does not by
   itself block generation.

The initial alias inventory is a compatibility boundary, not a minimal sample.
Before deleting the open-ended matchers, the implementation records every
spelling accepted by the existing `busVlnv.test.ts`, `busDefinitions.test.ts`,
and `lookupBusDef` branches. This includes the tested foreign Avalon VLNVs and
the existing short or name spellings `AXI4L`, `AXI4F`, `AXIS`, `AXI4S`,
`AVALON_MM`, `avalon_memory`, and the supported underscore and hyphen variants.
Short aliases are matched case-insensitively after trimming; structured VLNV
aliases are matched by their declared components and explicit version policy.
Future aliases require a definition-data change rather than another substring
branch.

Substring checks such as looking for `axi`, `stream`, or `avalon` are never
protocol or conformance decisions. The alias data lives with the bus definition
in `ipcraft-spec`. The same canonicalizer and resolved `interfaceKind` replace
the current independent webview and generator alias logic, including the
substring-based `busSupportsMemoryMap` and derived
`busSupportsInterruptAssociation` decisions in `src/shared/busVlnv.ts` and the
hard-coded `BusRuleRegistry.isMemoryMapped` classification. Narrow helper
functions may remain, but they consume resolved contract metadata rather than a
raw type string.

The migration also removes literal `mode === "slave"` gates from
`src/generator/resolvers/addressing.ts` and the `getBusTypeForTemplate` and
`hasMemoryMappedSlaveInterface` paths in `src/generator/registerProcessor.ts`.
Those sites test the resolved contract's normalized consumer mode, so a custom
memory-mapped contract is not skipped merely because it uses a different mode
name.

For every active port, resolution proceeds as follows:

1. Read the declared bus-definition width and policy.
2. Apply a matching `portWidthOverrides` value.
3. Resolve parameter references with the existing `widthExprAst` parser and
   evaluator.
4. Evaluate parameter defaults and the declared `allowedValues` domain under
   the bounded policy below.
5. Resolve semantic property defaults and derivations.
6. Resolve derived port widths.
7. Apply presence and conformance constraints.

Resolution returns one of four states:

- `concrete`: a known positive integer;
- `symbolic`: the required relationship is structurally provable;
- `unresolved`: the declaration lacks enough information for proof; or
- `invalid`: the expression, override, derivation, or constraint is illegal.

Equivalent symbolic relationships are accepted where the AST can prove them.
Every concrete default and declared allowed value must conform. If a default
conforms but arbitrary external parameter overrides cannot be proven, validation
emits a warning rather than rejecting an otherwise valid parametric IP. If no
conforming default exists and the relationship cannot be proven, the document
remains editable but generation and export are blocked.

Allowed-value evaluation is bounded per constraint, not across the entire IP.
The resolver first computes the distinct parameters referenced by that
constraint, then evaluates their Cartesian product. It evaluates at most 256
combinations. A larger domain returns `unresolved` with
`CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE`; it is never silently sampled or treated as
proven. This preserves correctness for relationships involving multiple
parameters without unbounded combinatorial work.

Version 1 does not generate elaboration-time protocol assertions for arbitrary
external parameter overrides. The diagnostic explicitly states when only the
declared default and allowed-value domain were checked.

## Diagnostics and enforcement

Diagnostics are structured and stable:

```ts
type DocumentPath = readonly (string | number)[];

interface BusConformanceDiagnostic {
  code: string;
  ruleId: string;
  severity: 'error' | 'warning';
  interfaceName: string;
  path: DocumentPath;
  message: string;
  suggestedValue?: number;
}
```

The array path is the machine identity used for YAML edits, canvas selection,
inspector focus, deduplication, and future quick fixes. Presentation adapters
render it as a dotted or indexed string; consumers never parse a rendered path
back into segments.

Examples include:

```text
AXI4L_DATA_WIDTH
["busInterfaces", 0, "portWidthOverrides", "WDATA"]
AXI4-Lite WDATA must be 32 or 64 bits; received 24.

AVALON_ST_EMPTY_WIDTH
["busInterfaces", 1, "portWidthOverrides", "empty"]
empty must be ceil(log2(symbolsPerBeat)); expected 2, received 1.
```

The enforcement policy is:

| Boundary                      | Known violation      | Unresolved constraint | Recommendation |
| ----------------------------- | -------------------- | --------------------- | -------------- |
| YAML and canvas editing       | Show error           | Show warning          | Show warning   |
| Save `.ip.yml`                | Allow                | Allow                 | Allow          |
| Import result                 | Do not write         | Write with warning    | Allow          |
| HDL generation/export         | Block before writing | Block before writing  | Allow          |
| Explicit consistency/CI check | Fail                 | Fail                  | Report only    |

The validation layer never silently changes values. An editor command may offer
an explicit atomic update, but the user initiates it. Importers do not silently
coerce a known-invalid standard interface, change its VLNV, flatten it, or leave
a partial output file. An unresolved but well-formed import is saved with
warnings so the user can resolve it in `.ip.yml`; the generator remains the
strict proof boundary. Generators validate before staging or writing any output.

## Editor and checker experience

Protocol diagnostics use the existing canvas annotation mechanism. An
interface-level error maps to its bus bundle. A port-specific error also maps to
the expanded logical subport. The bundle and subport show severity markers and
tooltips using the same diagnostic message.

The bus inspector exposes root widths and declared `interfaceProperties` as
editable values. Derived widths are visible but read-only, with their formula
and resolved value. Fixed values are read-only. Invalid editable fields show
expected and actual values inline. A coupled editor operation, such as changing
AXI `WDATA`, updates dependent explicit overrides in one batch, one document
transition, and one undo entry.

Coupled IP Core edits use the existing `updateIpCoreBatch` path. They do not add
a Memory Map `__op` variant or issue multiple `sendUpdate` calls.

The current reference-error footer becomes one consolidated **Issues** panel.
It groups diagnostics by source:

- Schema
- Protocol
- References
- HDL consistency
- Vendor artifact consistency

Clicking an issue selects the matching canvas element and focuses the relevant
inspector field when one exists. The toolbar reports error and warning counts.
Attempting blocked generation opens the Issues panel and selects the first
blocking diagnostic.

Immediate webview validation and the explicit checker both call the same pure
conformance code. The explicit checker adds authoritative extension-side schema,
HDL, and vendor-artifact checks. Results are deduplicated by diagnostic code and
document path; it must not contain a second implementation of protocol rules.

Import preview runs conformance validation before `Save as .ip.yml`. Known
violations remain visible on the preview canvas and disable saving. Unresolved
diagnostics remain visible as warnings but permit saving for later repair. No
destination is modified when a known blocking violation exists.

## Root and derived width behavior

Users normally specify only semantic choices and root widths. For example:

```yaml
portWidthOverrides:
  TDATA: 64
```

is sufficient for an AXI4-Stream interface with active `TKEEP`; its effective
`TKEEP` width is eight. An explicit compatible override is accepted and
preserved:

```yaml
portWidthOverrides:
  TDATA: 64
  TKEEP: 8
```

An explicit `TKEEP: 4` is rejected. This is derivation from the contract, not
silent document correction.

Serialization writes root selections and explicitly authored semantic
properties. It does not materialize every derived width. Existing matching
dependent overrides remain untouched until a user operation changes their root,
at which point `updateIpCoreBatch` always deletes every affected explicit
derived override in the same atomic edit. The effective value then comes from
the contract. This deterministic rule keeps formatting and snapshot behavior
stable.

## `_hw.tcl` import and Avalon-ST fidelity

`HwTclParser` must capture the supported Avalon-ST interface properties rather
than preserving only one vendor field. It maps `firstSymbolInHighOrderBits` to
the canonical `endianness` field. It recognizes the current
`dataBitsPerSymbol` name and the legacy `bitsPerSymbol` spelling that appears in
vendor artifacts; both normalize to `dataBitsPerSymbol` in `.ip.yml`. If both
source spellings occur and have different effective values, import fails with a
source-located diagnostic rather than guessing.

For a stream with one-bit symbols and an `N`-bit data port, the lossless result
is:

```yaml
busInterfaces:
  - name: streamOut
    type: ipcraft:busif:avalon_st:1.0
    mode: source
    portWidthOverrides:
      data: N
    interfaceProperties:
      dataBitsPerSymbol: 1
      symbolsPerBeat: N
```

If `symbolsPerBeat` is absent but the data width and symbol size resolve,
IPCraft derives it. If all three values are present, their product must agree.
The generated Altera `_hw.tcl` emits the canonical interface properties so the
round trip retains one-bit symbol semantics. It derives
`firstSymbolInHighOrderBits` from `endianness` and applies ordering in
`dataBitsPerSymbol`-sized lanes.

## `component.xml` export and protocol identity

Avalon-ST is not silently mapped to AXI4-Stream. AXI4-Stream is byte-lane based:
`TDATA` is an integral number of bytes, and `TKEEP` and `TSTRB` have one bit per
byte. The protocol reference is Arm IHI 0051B:
<https://documentation-service.arm.com/static/64819f1516f0f201aa6b963c>.

The lossless AMD/IP-XACT export path is:

1. Keep the interface's Avalon-ST VLNV in `component.xml`.
2. Emit and bundle its custom IP-XACT bus definition and abstraction definition.
3. Emit the physical port maps without padding or renaming semantic roles.
4. Preserve `dataBitsPerSymbol`, `symbolsPerBeat`, `readyLatency`, and related
   semantic properties as standard IP-XACT bus-interface parameters. Export
   `firstSymbolInHighOrderBits` only as the vendor representation derived from
   canonical `endianness`.
5. Mirror the complete canonical `interfaceProperties` map, `endianness`, and
   contract version in one
   IPCraft-namespaced vendor extension so a tool that ignores arbitrary
   bus-interface parameters cannot erase IPCraft's round-trip metadata.
6. On re-import, standard IP-XACT parameters are authoritative and the exported
   symbol-order property maps back to `endianness`. A conflicting mirrored value
   is a blocking diagnostic rather than an implicit precedence choice.
7. Install or reference the generated custom bus artifacts through the existing
   custom bus-definition mechanism.

The extension namespace is `urn:ipcraft:interface-contract:1`. Its single
`interfaceContract` element has `version="1"` and contains ordered `property`
elements with `name` and canonical scalar `value` attributes. Properties are
ordered by name for deterministic output. This fixed representation is part of
the round-trip contract rather than a generator-specific choice.

Vivado therefore sees a valid custom interface, not an AXI4-Stream interface.
It cannot connect directly to an AMD AXI4-Stream interconnect, which is the
correct outcome without an adapter.

Even when an `N`-bit Avalon stream is byte-aligned, an Avalon `empty` value can
count invalid one-bit symbols while AXI `TKEEP` qualifies whole bytes. Directly
mapping the signals can lose packet-tail information. Flattening to a conduit or
packing data into AXI4-Stream therefore requires an explicit user-selected
conversion policy. A generated protocol adapter and such export choices are
separate future work.

## Runtime library and custom buses

Built-in and custom definitions follow one data path:

```text
built-in and workspace bus YAML
  -> schema validation and normalization
  -> BusDefinitionContract library
  -> shared width/property resolver and validator
  -> editor, import, generation, export, and CI consumers
```

Workspace precedence remains the responsibility of `BusLibraryService`, but
replacement is by exact library key and VLNV according to existing project
rules. Built-in short names and foreign VLNVs are resolved by the contract's
structured alias table before exact lookup. Conformance lookup never falls back
to substring matching.

A project definition may declare root, derived, and fixed ports, semantic
properties, and any version-1 constraint. It receives the same editor and
generation behavior without a TypeScript protocol branch. A legacy custom
definition without constraints continues to load and receives structural width
validation only.

A genuinely unknown VLNV or legacy custom definition without a contract is not
treated as a protocol violation. Its `interfaceProperties` remain opaque, and
generation is blocked only by other schema, resolution, HDL, or vendor
diagnostics.

## Documentation and agent guidance

Protocol details should not be duplicated in full in root `AGENTS.md`. The
documentation has three layers:

1. The bus definition contracts are the machine authority.
2. `ipcraft-spec/docs/bus-interface-conformance.md` is the human and LLM
   reference, with tables and concrete `TKEEP`, `empty`, parameterization, and
   vendor-conversion examples.
3. Root `AGENTS.md` contains a compact orientation that directs agents to the
   canonical reference and lists only high-risk facts.

The agent orientation states that AXI4 and AXI4-Lite are memory-mapped and have
no `TDATA`; AXI4-Stream uses byte lanes; Avalon-ST has explicit symbol semantics;
defaults do not prove overrides legal; and agents must invoke the shared
validator instead of recreating rules in prompts or templates.

JSON Schema descriptions, stable rule identifiers, and diagnostics provide
additional context to agents operating directly on `.ip.yml` and bus definition
files.

## Compatibility and migration

- `interfaceProperties` is optional in existing `.ip.yml` files.
- Legacy Avalon-ST documents default to eight-bit symbols and derive
  `symbolsPerBeat` only when the data width permits an unambiguous result.
- A legacy Avalon-ST interface with `channel` but no `maxChannel` derives the
  maximum encodable channel value from the channel width. The shipped two-bit
  example therefore resolves to `maxChannel: 3` without a document rewrite.
- Legacy Avalon-ST `master`/`slave` modes normalize in memory to
  `source`/`sink`; new UI edits and imports serialize canonical streaming modes.
- `firstSymbolInHighOrderBits` remains a vendor import/export spelling only;
  existing `.ip.yml` continues to store the fact in `endianness`.
- Constraint sections are optional for existing project bus definitions.
- Every built-in definition must have a complete version-1 contract before
  enforcement is activated.
- Valid explicit dependent overrides are preserved.
- Editing a root width deterministically removes affected explicit derived
  overrides through `updateIpCoreBatch`.
- Unknown property names are errors for a recognized contract but remain opaque
  for an unknown or contract-less custom bus.
- Existing invalid documents display diagnostics and are never rewritten on
  load.
- Big-endian Avalon-ST generated RTL changes from byte-only behavior to
  `dataBitsPerSymbol`-lane reversal. In particular, non-byte-multiple streams
  such as five one-bit symbols now reorder their symbol lanes instead of
  silently receiving no reordering. This is an intentional compatibility change
  and must be called out in release notes.
- Saving remains possible during incomplete edits; generation and export do not
  proceed without proof.
- All shipped examples are validated and corrected deliberately before the
  enforcement gate is enabled.

The runtime-library migration intentionally changes canvas behavior wherever
the old hard-coded table disagrees with `ipcraft-spec`. In particular,
Avalon-MM optionality and port choices follow the canonical YAML. These changes
must be visible in release notes and covered by explicit tests rather than
hidden as snapshot churn.

The migration does not include a permanent warn-only mode. Audit during
implementation is used to find existing violations; release behavior follows
the enforcement table above.

## Verification strategy

### Schema and contract tests

- Accept complete built-in and custom version-1 contracts.
- Reject unknown operations, invalid operands, cycles, illegal references, and
  malformed interface property declarations.
- Accept an unknown workspace port role with a source-located warning and
  normalize it to `control`; fail repository tests if a built-in produces that
  warning.
- Reject invalid mode policies, interface kinds, ambiguous aliases, and
  unsupported alias wildcards.
- Prove that the hand-authored bus-definition schema generates the expected
  `busDefinition.types.ts` types through `npm run generate-types`.
- Prove that all five shipped built-ins carry complete contracts.
- Prove that a legacy custom definition without constraints remains loadable.

### Pure resolver and validator tests

- Use table-driven valid, invalid, warning, and unresolved cases for every
  built-in rule.
- Cover concrete defaults, every value in each dependency-sliced
  `allowedValues` domain within the cap, symbolic equality, compatible and
  incompatible explicit derived overrides, unresolved expressions, and illegal
  fixed overrides.
- Cover dependency-sliced allowed-value products below the 256-combination cap
  and the explicit unresolved diagnostic above it.
- Cover exact canonical VLNVs, short aliases, structured foreign VLNVs with
  exact or wildcard versions, and genuinely unknown VLNVs.
- Add a closure characterization table containing every bus spelling exercised
  by the existing `busVlnv.test.ts` and `busDefinitions.test.ts` suites plus
  every explicit `lookupBusDef` spelling branch. Prove each resolves to the same
  canonical contract and `interfaceKind` before the substring matchers are
  removed.
- Derive memory-map and interrupt-association eligibility from the resolved
  `interfaceKind`, mode, and array shape. Cover a custom version-1 memory-mapped
  bus with a non-`slave` consumer mode and prove unknown or contract-less buses
  do not opt in.
- Cover mode normalization and direction reversal for Avalon-ST source/sink and
  legacy master/slave inputs.
- Reject an unknown `interfaceProperties` key for a recognized contract while
  preserving the same key for a contract-less custom bus.
- Include at least these examples:
  - AXI4-Stream `TDATA=32`, `TKEEP=4` is valid.
  - AXI4-Stream `TDATA=20` is invalid.
  - AXI4-Stream `TDATA=64` derives `TKEEP=8` when omitted.
  - Four Avalon symbols of eight bits with `empty=2` are valid.
  - Four Avalon symbols of one bit with `data=4` and `empty=2` are valid.
  - A two-bit Avalon `channel` with no explicit property derives
    `maxChannel=3`.
  - Big-endian one-bit Avalon symbols reverse symbol lanes rather than bytes.
  - A one-bit-symbol stream whose `data`, `dataBitsPerSymbol`, and
    `symbolsPerBeat` disagree is invalid.

### Service and integration tests

- Load built-in and workspace definitions with deterministic precedence.
- Before deleting the webview tables, characterize every port, direction,
  presence, and role shared with the normalized runtime definitions. Record the
  known Avalon-MM differences as intentional expected deltas.
- Prove that parser, generator, and webview consumers use the shared contract
  lookup and that `HwTclParser` no longer imports from the webview layer.
- Validate every shipped `.ip.yml` example.
- Prove `_hw.tcl` import retains current and legacy symbol properties and blocks
  contradictory values without writing output.
- Prove an unresolved but well-formed parameterized import can be saved with a
  warning, while generation remains blocked.
- Prove Altera regeneration retains the imported semantic properties.
- Extend `src/test/integration/endianness.test.ts` with five-bit,
  one-bit-symbol, big-endian Avalon-ST fixtures for VHDL and SystemVerilog.
  Assert the generated RTL reverses five symbol lanes, does not apply a
  byte-multiple guard, and compiles or elaborates under the integration suite's
  available HDL tools.
- Prove `component.xml` keeps one-bit-symbol Avalon-ST as a custom interface,
  emits custom bus artifacts, and never labels it AXI4-Stream.
- Prove invalid or unresolved generation fails before any staging or filesystem
  output.
- Prove an interface with `memoryMapRef` and an unknown, streaming, or
  wrong-mode contract reports `BUS_MEMORY_MAP_UNSUPPORTED` and cannot generate;
  it must not silently select the default addressing width or omit the register
  file.
- Prove `addressing.ts`, `getBusTypeForTemplate`, and
  `hasMemoryMappedSlaveInterface` recognize the normalized consumer mode of a
  custom memory-mapped contract rather than requiring the literal `slave`.
- Prove the explicit checker returns protocol diagnostics together with schema,
  reference, HDL, and vendor-artifact diagnostics.

### Webview tests

- Show interface and subport severity markers on the canvas.
- Show expected and actual values in the inspector.
- Group and deduplicate diagnostics in the Issues panel.
- Select and focus the affected interface or field when an issue is clicked.
- Keep derived values read-only and update their display after a root edit.
- Prove a five-bit, one-bit-symbol Avalon-ST interface permits big-endian
  selection and does not emit the byte-multiple warning. Retain the existing
  byte-alignment warning and disabled-control behavior for a five-bit standalone
  port.
- Apply coupled changes through `updateIpCoreBatch` as one state transition and
  one undo entry, without multiple outbound updates.
- Prove a root edit deletes affected explicit derived overrides rather than
  updating or materializing them.
- Disable saving an invalid import preview and open the Issues panel on blocked
  generation.

After schema-derived type generation, run compile, unit tests, relevant
integration tests, lint, and repository formatting checks. Enforcement is not
enabled until all built-ins and shipped examples pass the shared validator.

## Delivery sequence

1. Add the hand-authored bus-definition schema, `.ip.yml`
   `interfaceProperties`, `npm run generate-types` integration, five built-in
   contracts with roles/modes/interface kinds/aliases, and the canonical
   reference in `ipcraft-spec`.
2. Implement and unit-test pure alias canonicalization, contract normalization,
   width/property resolution, mode handling, structured-path diagnostics, and
   conformance validation.
3. Characterize the shared behavior and intentional Avalon-MM differences
   between the current hard-coded webview tables and normalized contracts. Then
   make `BusLibraryService` produce the canonical runtime library, migrate all
   consumers, replace `busVlnv.ts` and generator memory-map classification with
   resolved `interfaceKind` and consumer-mode metadata, remove literal `slave`
   gates in `addressing.ts` and `registerProcessor.ts`, remove `HwTclParser`'s
   webview dependency, and finally delete the hard-coded tables.
4. Integrate diagnostics into the canvas, inspector, unified Issues panel, and
   explicit checker.
5. Add `_hw.tcl` property import and Altera round-trip generation.
6. Add lossless Avalon-ST custom IP-XACT parameter and bus-definition export.
7. Add preflight gates to import writing, staging, generation, export, and CI.
8. Validate and deliberately migrate all shipped examples, then activate full
   enforcement.

Each step must preserve existing format-preserving YAML edits, message protocol
atomicity, undo granularity, selection, focus, and custom bus behavior.

## Reference material

- Arm, _AMBA AXI4-Stream Protocol Specification_, IHI 0051B:
  <https://documentation-service.arm.com/static/64819f1516f0f201aa6b963c>
- Arm, _AMBA AXI and ACE Protocol Specification_:
  <https://documentation-service.arm.com/static/68b03beb01ae952d9559f9eb>
- Arm, _AMBA AXI4-Lite Protocol Specification_, relevant AXI4-Lite width rules:
  <https://documentation-service.arm.com/static/64256e84314e245d086bc88f?token=>
- Altera, _Avalon Interface Specifications_, synchronous streaming interface
  properties:
  <https://docs.altera.com/r/docs/683091/22.3/avalon-interface-specifications/synchronous-interface>
- Intel, _Avalon Streaming Interface Signal Roles_:
  <https://www.intel.com/content/www/us/en/docs/programmable/683609/23-3/streaming-interface-signal-roles.html>
- Intel, _Data Transfers Using readyLatency_:
  <https://www.intel.com/content/www/us/en/docs/programmable/683091/22-3/data-transfers-using-readylatency.html>
- Intel, _Avalon Streaming Demultiplexer IP Input Interface_:
  <https://www.intel.com/content/www/us/en/docs/programmable/683609/24-3/streaming-demultiplexer-ip-input-interface.html>
