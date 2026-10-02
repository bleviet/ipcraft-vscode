# Bus Interface Audit Remediation Design

## Goal

Validate the post-implementation audit of bus-interface conformance work and
repair the confirmed behavioral, duplication, coverage, and architecture
findings without broadening the document revision protocol or destabilizing the
vendor format boundaries.

## Validated Findings

The following audit findings require changes:

- `BusConformanceService` is a middle man over the shared conformance API.
- `ComponentXmlParser` and `HwTclParser` independently reconstruct optional
  ports, width overrides, and physical-name overrides from observed vendor
  ports.
- `ComponentXmlParser` duplicates typed vendor-property coercion and conflict
  handling already owned by the bus-contract package.
- Declarative contract detection uses the `version` sentinel directly in three
  consumers instead of one named predicate.
- `findCustomBusDef` combines the canonical runtime-library lookup with a
  second raw-definition scan even though production generation assembles the
  normalized library first.
- IPCraft's IP-XACT mirror currently includes resolved default properties and
  an unconditional little-endian value, causing re-import to materialize
  values that were never authored.
- The Vivado and Quartus integration suites consume generated contract data but
  do not explicitly assert non-default semantic properties or bundled custom
  bus artifacts.
- The three vendor format boundaries exceed the repository's 500-line review
  trigger without a recorded cohesion decision.

The following audit observations do not require changes:

- `sourceRevision` correlates asynchronous conformance and generation results
  with the exact source they validated. It does not filter document updates or
  modify the V-3/V-4 `docVersion` protocol.
- The non-bus port endianness check is byte-oriented by definition, so its
  multiple-of-eight rule is not a duplicate of contract-selected bus lane
  semantics.
- The dirty `ipcraft-spec` submodule is expected feature work and remains under
  review rather than being reset or discarded.
- Pending bus-library suppression is already covered by the focused
  `defers contract-dependent interrupt validation until the bus library
  arrives` test, which calls the real validator without a library.

## Shared Contract Boundaries

Add a pure observed-port reconciliation module under
`src/shared/busContracts/`. It accepts normalized contract ports, observed
logical/physical names and widths, plus the physical prefix. It returns the
three document-facing selections:

- enabled optional logical ports;
- width overrides whose observed values differ from numeric contract defaults,
  including symbolic vendor widths;
- physical-name suffix overrides keyed with the contract's canonical spelling.

Both vendor importers adapt their source representation to this narrow input.
The shared function contains no XML, Tcl, filesystem, or parser dependencies.
The ongoing extraction rule is concrete: logic that does not inspect or emit
XML/Tcl syntax and does not depend on vendor source ordering belongs in
`src/shared/busContracts/` when it has a second consumer.

Extend `importVendorContractMetadata` so it remains the single typed importer
for declared semantic properties, legacy `bitsPerSymbol`, symbol-count
derivation, ordering, and standard-versus-mirror conflicts. A present
version-one IPCraft mirror also carries authorship: only mirrored property keys
and mirrored endianness become authored `.ip.yml` state. When no supported
mirror exists, standard vendor properties remain importable as authored source
metadata.

Add `isDeclarativeContract(contract)` as the named version-one predicate and
use it in property resolution, component XML import, and component XML export.

## Lossless IP-XACT Export and Import

Standard IP-XACT parameters continue to receive every concretely resolved
semantic property required by the vendor tool. This preserves vendor behavior
and keeps generated metadata self-contained.

The IPCraft extension mirrors only property keys explicitly present in
`iface.interfaceProperties`; their values come from the validated contract
resolution. It mirrors `endianness` only when the source interface explicitly
contains `little` or `big`. The version-one mirror element is still emitted for
eligible custom declarative contracts even when it has no property children,
because its presence distinguishes an IPCraft export with no authored semantic
selections from third-party standard metadata.

On re-import, property and endianness precedence is:

| Supported mirror | Standard value | Mirror value | Import result |
| --- | --- | --- | --- |
| Absent | Absent | Not applicable | Import nothing |
| Absent | Present | Not applicable | Import the standard value as authored metadata |
| Empty or key absent | Present | Absent | Validate the standard value, then discard it as an exported resolved default |
| Key present | Absent | Present | Import the mirrored value |
| Key present | Same effective value | Present | Import the mirrored value |
| Key present | Different effective value | Present | Fail with a source-located conflict |
| Key undeclared by contract | Any | Present | Fail with a source-located unknown-property error |

Mirror absence is never itself a conflict. An empty version-one mirror
round-trips to no `interfaceProperties` and no `endianness` even though standard
vendor parameters remain present.

## Generator Lookup and Service Cleanup

Delete `src/services/BusConformanceService.ts`. Extension-side consumers import
`checkBusConformance`, `blocksGeneration`, `blocksImportWrite`, and report types
from the shared modules. Enforcement-policy tests move to the shared test area.

`findCustomBusDef` uses only `canonicalizeBusType` after excluding native Vivado
types. Legacy contract-less definitions remain supported because normalization
represents them with `version: null`; they do not require a raw-definition
fallback. A malformed non-builtin definition rejected by `BusLibraryService`
will no longer be resurrected from the raw definition map during Vivado
generation; generation must remain blocked by its library diagnostics. A
characterization test records this intentional enforcement change. Tests that
construct valid custom definitions must include those definitions in their
injected normalized library, matching production wiring.

## Integration Coverage

The comprehensive Avalon example will include one non-default, explicitly
authored symbol configuration on its sink stream. The configuration uses
one-bit symbols while leaving `symbolsPerBeat` to derive from the existing
16-bit data width. This distinguishes authored mirror metadata from resolved
standard metadata while leaving existing packet-width behavior intact.

Because that example feeds shared fixture generation, the expected fallout
includes the generated-output snapshot, Vivado and Quartus artifact assertions,
round-trip coverage, HDL integration outputs, and the example README. The
existing data width and optional packet ports must remain unchanged and will be
asserted directly. Documentation screenshots are updated only if their rendered
content changes.

The Vivado integration suite will assert that the generated comprehensive
fixture contains:

- the version-one IPCraft interface contract;
- the authored one-bit symbol properties;
- the Avalon-ST bus and abstraction definition files installed beside the
  component metadata.

The Quartus integration suite will assert that the corresponding `_hw.tcl`
contains the authored one-bit symbol properties. Existing vendor-tool tests
then validate those exact generated fixtures with Vivado and Platform Designer.

## Module Size Review

`ComponentXmlParser`, `HwTclParser`, and `VivadoComponentXmlGenerator` remain
format-boundary modules: each owns one ordered vendor document transformation
and one public parse or generation entry point. Source-order-sensitive XML/Tcl
assembly remains local, while reusable policy and transformations move to pure
shared modules. The extension-host architecture note will record this cohesion
decision and identify the extraction rule for future additions. This avoids an
unrelated wholesale split while satisfying the repository's responsibility
review requirement.

The same architecture note will record that `sourceRevision` string-compares
the exact source text for asynchronous result correlation and is intentionally
separate from the monotonic V-3/V-4 document-update protocol.

## Verification

Every behavioral change follows red-green-refactor:

1. Add focused failing tests for observed-port reconciliation, mirror
   authorship, explicit little-endian preservation, canonical custom-bus
   lookup, and vendor integration assertions.
2. Implement the smallest shared changes that make each test pass.
3. Run the affected parser, generator, shared-contract, webview, integration
   round-trip, Vivado, and Quartus suites as available.
4. Run `npm run lint`, `npm run type-check`, `npm run compile`, and
   `git diff --check` before reporting completion.

No files will be staged, committed, or pushed automatically.
