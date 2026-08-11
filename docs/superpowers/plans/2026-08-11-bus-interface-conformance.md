# Bus Interface Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five built-in AXI/Avalon interfaces machine-validatable from
one declarative contract library, surface the same diagnostics in every UI and
generation boundary, and preserve Avalon-ST symbol semantics through vendor
round trips.

**Architecture:** `ipcraft-spec` owns a versioned bus-definition schema and the
five complete contracts. Pure modules under `src/shared/busContracts/` normalize
the library, canonicalize aliases and modes, resolve effective widths and
properties, and return structured diagnostics. Services load that runtime
library once and inject it into parsers, generators, checkers, and the webview;
components only project diagnostics and dispatch atomic edits.

**Tech Stack:** TypeScript, React, JSON Schema, Ajv, js-yaml for read-only
parsing, `yaml` v2 for format-preserving edits, Nunjucks, Jest, Playwright,
GHDL, Icarus Verilog.

**Design reference:**
`docs/superpowers/specs/2026-08-11-bus-interface-conformance-design.md`

## Global Constraints

- Keep source imports relative; repository path aliases are test-only.
- Keep camelCase in TypeScript, React, and JSON Schema. Do not add dual-state
  fallbacks for new fields.
- Preserve the dependency direction `types/pure utilities -> services/hooks ->
components -> roots`; parsers and generators must not import webview code.
- Use `yaml` v2 and the existing `src/yamledit/` path-edit helpers for document
  writes. `js-yaml` remains read-only except for importer-created new documents.
- Carry diagnostic paths as `readonly (string | number)[]`; rendered strings are
  presentation only.
- Evaluate at most 256 dependency-sliced `allowedValues` combinations per
  constraint. Never sample an oversized domain.
- Unknown VLNVs do not fail merely for lacking a contract, but an interface with
  `memoryMapRef` must resolve to a memory-mapped contract in its normalized
  consumer mode.
- Known import violations block writes; unresolved well-formed imports save with
  warnings; known or unresolved generation failures stop before staging or disk
  output.
- Coupled IP Core edits use `updateIpCoreBatch` for one state transition and one
  undo entry. Do not add a Memory Map `__op` or issue multiple outbound updates.
- Do not automatically stage, commit, or push. Each task ends with a review
  checkpoint for the developer.
- Before deleting a hard-coded behavior source, land and run its characterization
  tests.
- After generated types change, run `npm run generate-types` and
  `npm run compile`.
- Jest commands must include `--config config/jest.config.js`.

---

### Task 1: Add bus-contract schemas and generated types

**Files:**

- Create: `ipcraft-spec/schemas/bus_definition.schema.json`
- Modify: `ipcraft-spec/schemas/ip_core.schema.json`
- Modify: `scripts/generate-types.js`
- Modify: `config/webpack.config.js`
- Modify: `scripts/check-vsix.js`
- Generate: `src/domain/busDefinition.types.ts`
- Generate: `src/domain/ipcore.types.ts`
- Modify: `src/webview/types/ipCore.d.ts`
- Modify: `src/generator/types.ts`
- Test: `src/test/suite/services/SpecConformance.test.ts`
- Test: `src/test/suite/domain/roundtrip.test.ts`
- Create: `src/test/suite/services/BusDefinitionSchema.test.ts`

**Interfaces:**

- Produces: generated raw schema types `BusDefinitionFile`,
  `BusDefinitionEntry`, `BusContract`, and `BusContractPort`.
- Produces: `BusInterface.interfaceProperties?: Record<string, number | string |
boolean>` in generated, legacy webview, and generator-facing types.
- Consumes: existing `json-schema-to-typescript` generation path and Ajv test
  setup.

- [ ] **Step 1: Write failing schema tests for the version-1 shape**

  Add Ajv cases covering a complete streaming contract, a legacy definition
  with only `ports`, malformed operations, missing operands, invalid aliases,
  empty role strings, and arbitrary non-empty role strings:

  ```ts
  expect(
    validate({
      TEST_BUS: {
        busType: { vendor: 'acme', library: 'busif', name: 'test', version: '1.0' },
        aliases: [{ kind: 'short', value: 'TEST' }],
        contract: {
          version: 1,
          interfaceKind: 'streaming',
          modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
          interfaceProperties: {},
          constraints: [],
        },
        ports: [
          {
            name: 'data',
            width: 32,
            direction: 'out',
            presence: 'required',
            role: 'data',
            widthPolicy: 'root',
          },
        ],
      },
    })
  ).toBe(true);
  ```

- [ ] **Step 2: Run the new schema tests and confirm the missing schema fails**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts
  ```

  Expected: FAIL because `bus_definition.schema.json` does not exist.

- [ ] **Step 3: Author the discriminated JSON Schema**

  Define these closed version-1 vocabularies in
  `bus_definition.schema.json`:

  ```json
  {
    "interfaceKind": ["memoryMapped", "streaming", "conduit"],
    "presence": ["required", "optional"],
    "widthPolicy": ["root", "derived", "fixed"],
    "canonicalRoles": ["clock", "reset", "data", "byteQualifier", "control"],
    "derivedOperations": [
      "copyPort",
      "multiplyBy",
      "divideBy",
      "multiplyProperties",
      "ceilLog2",
      "bitsForMaximum",
      "maxEncodableValue"
    ],
    "constraintKinds": [
      "range",
      "allowedValues",
      "multipleOf",
      "powerOfTwo",
      "portWidthsEqual",
      "portWidthQuotient",
      "productEqualsPort",
      "portPresenceRequires",
      "propertyRequiredWhenPortPresent",
      "propertyFitsPort"
    ]
  }
  ```

  Encode operations and constraint kinds as `oneOf` discriminated object
  shapes so missing or extra operands fail schema validation. Keep `contract`
  optional for legacy definitions. Validate `role` as a non-empty string so the
  semantic normalizer can degrade unknown workspace roles with a warning.

- [ ] **Step 4: Add `interfaceProperties` to the IP-core schema and round trip**

  Add an object after `portWidthOverrides` whose values are integer, string, or
  boolean and whose description says recognized contracts validate their keys.
  Update the `Endianness` description to distinguish byte lanes from
  Avalon-ST symbol lanes. Add a round-trip assertion:

  ```ts
  const iface = (
    serializeIpCore(parseIpCore(yamlText).ipCore) as {
      busInterfaces: Array<Record<string, unknown>>;
    }
  ).busInterfaces[0];
  expect(iface.interfaceProperties).toEqual({
    dataBitsPerSymbol: 1,
    symbolsPerBeat: 'DATA_WIDTH',
  });
  ```

- [ ] **Step 5: Extend type generation and resource packaging**

  Add `BUS_DEFINITION_SCHEMA_PATH` and `BUS_DEFINITION_OUTPUT_PATH` to
  `scripts/generate-types.js`, call `compile(rawBusDefinition,
'BusDefinitionFile', { additionalProperties: false })`, and copy the new
  schema in webpack. Add it to the VSIX required-schema list. Update the legacy
  webview and generator types deliberately; do not hand-edit generated files.

- [ ] **Step 6: Generate types and verify schema, compilation, and packaging**

  Run:

  ```bash
  npm run generate-types
  npm run compile
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/SpecConformance.test.ts src/test/suite/domain/roundtrip.test.ts
  ```

  Expected: generated `busDefinition.types.ts`, successful webpack compilation,
  and all listed tests passing.

- [ ] **Step 7: Review checkpoint**

  Run `git diff --check` and inspect only the schema/type-generation changes.
  Leave the worktree unstaged.

---

### Task 2: Encode all five built-in contracts and their compatibility aliases

**Files:**

- Modify: `ipcraft-spec/bus_definitions/axi4_lite.yml`
- Modify: `ipcraft-spec/bus_definitions/axi4_full.yml`
- Modify: `ipcraft-spec/bus_definitions/axi_stream.yml`
- Modify: `ipcraft-spec/bus_definitions/avalon_mm.yml`
- Modify: `ipcraft-spec/bus_definitions/avalon_st.yml`
- Create: `ipcraft-spec/docs/bus-interface-conformance.md`
- Modify: `ipcraft-spec/docs/ip_spec.md`
- Modify: `AGENTS.md`
- Create: `src/test/suite/services/BuiltinBusContracts.test.ts`

**Interfaces:**

- Consumes: raw schema types from Task 1.
- Produces: five complete version-1 contracts with explicit canonical VLNV,
  aliases, `interfaceKind`, `modePolicy`, roles, width policies, properties,
  derivations, and stable rules.

- [ ] **Step 1: Write failing completeness and alias-inventory tests**

  Load all five YAML files and assert every built-in has a version-1 contract,
  every port has a recognized explicit role and width policy, aliases do not
  collide after normalization, and this compatibility matrix is present:

  ```ts
  const compatibilityAliases = {
    AXI4_LITE: ['AXI4L', 'AXI4LITE', 'AXILITE', 'AXIL', 'axi4_lite', 'axi4-lite', 'axi4l'],
    AXI4_FULL: ['AXI4F', 'AXI4FULL', 'AXI4', 'axi4_full', 'axi4-full', 'axi4f'],
    AXI_STREAM: ['AXIS', 'AXI4S', 'AXISTREAM', 'axi_stream', 'axi-stream'],
    AVALON_MEMORY_MAPPED: [
      'AVMM',
      'AVALONMM',
      'AVALONMEMORYMAPPED',
      'AVALON_MEMORY_MAPPED',
      'avalon_mm',
      'avalon-mm',
      'avalon_memory',
    ],
    AVALON_STREAMING: [
      'AVST',
      'AVALONST',
      'AVALONSTREAMING',
      'avalon_st',
      'avalon-st',
      'avalon_stream',
    ],
  } as const;
  ```

  Include structured foreign aliases for
  `xilinx.com:interface:avalon:*`,
  `xilinx.com:interface:avalon-mm:*`,
  `xilinx.com:interface:avalon-st:*`, and
  `altera.com:interface:avalon_streaming:*`.

- [ ] **Step 2: Run the completeness test and confirm it fails**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BuiltinBusContracts.test.ts
  ```

  Expected: FAIL because the shipped definitions do not yet contain contracts,
  complete roles, modes, or aliases.

- [ ] **Step 3: Add canonical metadata and width policies**

  Use `interfaceKind: memoryMapped` for AXI4-Lite, AXI4 Full, and Avalon-MM;
  `interfaceKind: streaming` for AXI4-Stream and Avalon-ST. Use
  `master`/`slave` for AXI and Avalon-MM, and `source`/`sink` with
  `master -> source`, `slave -> sink` aliases for Avalon-ST. Mark clocks,
  resets, data, byte qualifiers, and all remaining control ports explicitly.

- [ ] **Step 4: Encode stable built-in rules**

  Use these rule IDs and severities as the contract inventory:

  | Contract    | Required error rules                                                                                                           | Warning rules               |
  | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
  | AXI4-Lite   | `AXI4L_DATA_WIDTH`, `AXI4L_DATA_EQUAL`, `AXI4L_WSTRB_WIDTH`, `AXI4L_ADDRESS_EQUAL`, fixed control widths                       | none                        |
  | AXI4 Full   | `AXI4_DATA_WIDTH`, `AXI4_DATA_EQUAL`, `AXI4_WSTRB_WIDTH`, `AXI4_ID_WIDTHS`, fixed sideband widths, presence dependencies       | none                        |
  | AXI4-Stream | `AXIS_DATA_BYTE_ALIGNED`, `AXIS_TKEEP_WIDTH`, `AXIS_TSTRB_WIDTH`, fixed handshake widths                                       | `AXIS_PREFERRED_DATA_WIDTH` |
  | Avalon-MM   | `AVALON_MM_DATA_WIDTH`, `AVALON_MM_DATA_EQUAL`, `AVALON_MM_BYTEENABLE_WIDTH`, fixed controls                                   | none                        |
  | Avalon-ST   | `AVALON_ST_DATA_LAYOUT`, `AVALON_ST_EMPTY_WIDTH`, `AVALON_ST_PACKET_PORTS`, `AVALON_ST_READY_LATENCY`, `AVALON_ST_MAX_CHANNEL` | none                        |

  Declare `dataBitsPerSymbol` default `8`, derived `symbolsPerBeat`,
  `readyLatency` default `0`, and derived `maxChannel` in Avalon-ST.
  Keep `firstSymbolInHighOrderBits` out of `interfaceProperties`.

- [ ] **Step 5: Document the machine contract for people and agents**

  In `ipcraft-spec/docs/bus-interface-conformance.md`, include concrete
  `TDATA/TKEEP`, Avalon `data/empty`, one-bit-symbol, parameterized, and vendor
  conversion examples. Add a short pointer in `AGENTS.md`; do not duplicate the
  rule tables there. Link the reference from `ip_spec.md`.

- [ ] **Step 6: Validate all built-ins**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/BuiltinBusContracts.test.ts
  ```

  Expected: all five definitions pass schema validation and the completeness
  invariant without warnings.

- [ ] **Step 7: Review checkpoint**

  Run `git diff --check`; compare the contract tables against the approved
  design, especially AXI4-Lite 32/64-bit widths, AXI4-Stream byte lanes, and
  Avalon-ST arbitrary symbol widths.

---

### Task 3: Normalize the runtime library and canonicalize types and modes

**Files:**

- Create: `src/shared/busContracts/types.ts`
- Create: `src/shared/busContracts/normalize.ts`
- Create: `src/shared/busContracts/canonicalize.ts`
- Create: `src/shared/busContracts/index.ts`
- Create: `src/test/suite/shared/busContractNormalize.test.ts`
- Create: `src/test/suite/shared/busContractCanonicalize.test.ts`

**Interfaces:**

- Consumes: `BusDefinitionFile` from Task 1 and definition data from Task 2.
- Produces:

  ```ts
  export type DocumentPath = readonly (string | number)[];
  export type InterfaceKind = 'memoryMapped' | 'streaming' | 'conduit';
  export type CanonicalPortRole = 'clock' | 'reset' | 'data' | 'byteQualifier' | 'control';

  export interface BusDefinitionSource {
    sourceFile: string;
    sourceKind: 'builtin' | 'workspace' | 'configured' | 'ipLocal';
    definitions: BusDefinitionFile;
  }

  export interface BusLibraryDiagnostic {
    code: string;
    severity: 'error' | 'warning';
    sourceFile: string;
    path: DocumentPath;
    message: string;
  }

  export interface NormalizedBusLibrary {
    definitions: Readonly<Record<string, BusDefinitionContract>>;
    aliases: readonly NormalizedBusAlias[];
    diagnostics: readonly BusLibraryDiagnostic[];
  }

  type RawPropertyDeclarations = NonNullable<BusContract['interfaceProperties']>;
  export type NormalizedDerivedWidth = NonNullable<BusContractPort['derivedWidth']>;
  export type NormalizedPropertyDerivation = NonNullable<RawPropertyDeclarations[string]['derive']>;
  export type NormalizedBusConstraint = NonNullable<BusContract['constraints']>[number];

  export interface BusDefinitionContract {
    key: string;
    canonicalVlnv: string;
    interfaceKind: InterfaceKind;
    modePolicy: NormalizedModePolicy;
    ports: readonly NormalizedBusPort[];
    interfaceProperties: Readonly<Record<string, NormalizedPropertyDeclaration>>;
    constraints: readonly NormalizedBusConstraint[];
    sourceFile: string;
  }

  export interface NormalizedModePolicy {
    producer: string;
    consumer: string;
    aliases: Readonly<Record<string, string>>;
  }

  export interface NormalizedBusAlias {
    kind: 'short' | 'vlnv';
    canonicalVlnv: string;
    shortValue?: string;
    vendor?: string;
    library?: string;
    name?: string;
    version?: string;
  }

  export interface NormalizedBusPort {
    name: string;
    width?: number | string;
    direction?: 'in' | 'out';
    presence: 'required' | 'optional';
    role: CanonicalPortRole;
    widthPolicy: 'root' | 'derived' | 'fixed';
    derivedWidth?: NormalizedDerivedWidth;
  }

  export interface NormalizedPropertyDeclaration {
    type: 'integer' | 'boolean' | 'string';
    default?: number | boolean | string;
    minimum?: number;
    maximum?: number;
    allowedValues?: readonly (number | boolean | string)[];
    derive?: NormalizedPropertyDerivation;
  }

  export interface CanonicalBusMatch {
    key: string;
    canonicalVlnv: string;
    contract: BusDefinitionContract;
    matchedBy: 'canonicalVlnv' | 'shortAlias' | 'structuredAlias';
  }

  export function normalizeBusLibrary(inputs: readonly BusDefinitionSource[]): NormalizedBusLibrary;
  export function canonicalizeBusType(
    type: string,
    library: NormalizedBusLibrary
  ): CanonicalBusMatch | null;
  export function normalizeInterfaceMode(
    contract: BusDefinitionContract,
    mode: string
  ): string | null;
  export function isConsumerInterface(contract: BusDefinitionContract, mode: string): boolean;
  ```

- [ ] **Step 1: Write failing normalization tests**

  Cover exact VLNV construction, short-alias trim/case normalization,
  structured wildcard versions, alias collision errors, derivation cycles,
  undeclared references, missing roles, and unknown workspace roles. Assert:

  ```ts
  expect(result.definitions.TEST.ports[0].role).toBe('control');
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'BUS_DEF_UNKNOWN_PORT_ROLE',
      severity: 'warning',
      sourceFile: '/workspace/test.yml',
      path: ['TEST', 'ports', 0, 'role'],
    })
  );
  ```

- [ ] **Step 2: Run the tests and confirm missing exports fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractNormalize.test.ts src/test/suite/shared/busContractCanonicalize.test.ts
  ```

  Expected: FAIL because `src/shared/busContracts/` does not exist.

- [ ] **Step 3: Implement semantic normalization**

  Convert raw schema types into immutable normalized entries. Treat malformed
  contracts, conflicting aliases, cycles, and undeclared operands as errors that
  exclude that entry. Treat missing roles and unknown workspace roles as
  `control`; record a warning only for an explicit unknown value. Reject any
  warning from a bundled built-in in its repository test.

- [ ] **Step 4: Implement exact canonicalization and mode normalization**

  Apply this order without substring matching:

  ```ts
  const match =
    matchCanonicalVlnv(trimmed, library) ??
    matchShortAlias(trimmed.toLowerCase(), library) ??
    matchStructuredVlnv(parseVlnv(trimmed), library) ??
    null;
  ```

  Structured aliases compare vendor, library, and name exactly and accept only
  an exact declared version or `"*"`. `normalizeInterfaceMode` returns the
  canonical producer/consumer mode or `null`; it never guesses from a protocol
  name.

- [ ] **Step 5: Verify the pure library**

  Run the two Jest files from Step 2. Expected: PASS with no VS Code, React,
  filesystem, generator, or webview imports in `src/shared/busContracts/`.

- [ ] **Step 6: Review checkpoint**

  Run:

  ```bash
  rg -n "includes\('(axi|stream|avalon)" src/shared/busContracts
  git diff --check
  ```

  Expected: no protocol substring matcher and no whitespace errors.

---

### Task 4: Resolve effective widths and validate conformance

**Files:**

- Create: `src/shared/busContracts/expression.ts`
- Create: `src/shared/busContracts/activePorts.ts`
- Create: `src/shared/busContracts/resolve.ts`
- Create: `src/shared/busContracts/validate.ts`
- Modify: `src/shared/busContracts/types.ts`
- Modify: `src/shared/busContracts/index.ts`
- Modify: `src/domain/parse.ts`
- Test: `src/test/suite/domain/roundtrip.test.ts`
- Create: `src/test/suite/shared/busContractResolve.test.ts`
- Create: `src/test/suite/shared/busConformance.test.ts`

**Interfaces:**

- Consumes: normalized contracts from Task 3 and `widthExprAst`.
- Produces:

  ```ts
  export type ResolutionState = 'concrete' | 'symbolic' | 'unresolved' | 'invalid';

  export interface ResolvedNumericValue {
    state: ResolutionState;
    value?: number;
    expression?: WidthExprNode;
    reason?: string;
  }

  export interface ResolveBusInterfaceInput {
    busInterface: BusInterface;
    busIndex: number;
    parameters: readonly Parameter[];
    library: NormalizedBusLibrary;
  }

  export interface ValidateBusInterfacesInput {
    busInterfaces: readonly BusInterface[];
    parameters: readonly Parameter[];
    library: NormalizedBusLibrary;
  }

  export interface BusConformanceDiagnostic {
    code: string;
    ruleId: string;
    severity: 'error' | 'warning';
    state: ResolutionState;
    interfaceName: string;
    path: DocumentPath;
    message: string;
    suggestedValue?: number;
  }

  export interface BusInterfaceResolution {
    match: CanonicalBusMatch | null;
    normalizedMode: string | null;
    portWidths: Readonly<Record<string, ResolvedNumericValue>>;
    properties: Readonly<Record<string, ResolvedSemanticValue>>;
    activePorts: readonly ResolvedBusPort[];
    diagnostics: readonly BusConformanceDiagnostic[];
  }

  export type ResolvedSemanticValue =
    | ResolvedNumericValue
    | {
        state: ResolutionState;
        value?: boolean | string;
        reason?: string;
      };

  export interface ResolvedBusPort extends NormalizedBusPort {
    effectiveDirection?: 'in' | 'out';
    effectiveWidth: ResolvedNumericValue;
  }

  export function resolveBusInterface(input: ResolveBusInterfaceInput): BusInterfaceResolution;
  export function validateBusInterfaces(
    input: ValidateBusInterfacesInput
  ): readonly BusConformanceDiagnostic[];
  ```

- [ ] **Step 1: Write failing four-state and built-in table tests**

  Add `it.each` cases for every rule ID from Task 2. Include concrete, symbolic,
  unresolved, and invalid outcomes; compatible and incompatible derived
  overrides; fixed overrides; unknown property keys; mode aliases; and unknown
  VLNVs. Include the required examples:

  ```ts
  it.each([
    [32, 4, true],
    [64, 8, true],
    [20, 3, false],
  ])('validates AXIS TDATA=%i TKEEP=%i', (data, keep, valid) => {
    /* explicit fixture assertion */
  });

  expect(
    resolveAvalon(
      { data: 4, empty: 2 },
      {
        dataBitsPerSymbol: 1,
        symbolsPerBeat: 4,
      }
    ).diagnostics
  ).toEqual([]);
  ```

- [ ] **Step 2: Write failing domain-cap and memory-map diagnostic tests**

  Build a two-parameter 16-by-16 domain that evaluates exactly 256 combinations
  and a 17-by-16 domain that returns:

  ```ts
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE',
      state: 'unresolved',
      severity: 'warning',
    })
  );
  ```

  Also assert an unknown, streaming, or wrong-mode interface with
  `memoryMapRef` reports `BUS_MEMORY_MAP_UNSUPPORTED` at
  `['busInterfaces', index, 'memoryMapRef']`.

- [ ] **Step 3: Run the new resolver tests and confirm they fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractResolve.test.ts src/test/suite/shared/busConformance.test.ts
  ```

  Expected: FAIL because the resolver and validator exports are absent.

- [ ] **Step 4: Implement expression resolution and structural proof**

  Reuse `parse` and `evaluate` from `widthExprAst`. Reduce constant subtrees,
  normalize parameter-name case exactly as the parameter table does, and compare
  canonical ASTs for structural equality. Do not use `eval`, regex arithmetic,
  or algebraic guessing. A relation is `symbolic` only when the normalized AST
  structure proves it.

- [ ] **Step 5: Implement active ports, property defaults, and derivations**

  Resolve in the approved order: declared width -> explicit override ->
  parameter expression -> property defaults/derivations -> derived width ->
  presence constraints. Derive omitted legacy Avalon-ST values as follows:

  ```ts
  symbolsPerBeat = dataWidth % dataBitsPerSymbol === 0 ? dataWidth / dataBitsPerSymbol : unresolved;
  maxChannel = 2 ** channelWidth - 1;
  emptyWidth = Math.ceil(Math.log2(symbolsPerBeat));
  ```

  Reject zero, negative, fractional, or overflowed widths.

- [ ] **Step 6: Implement bounded constraint evaluation and diagnostics**

  For each constraint, collect only referenced parameters, form their Cartesian
  product, and stop before evaluation if its size exceeds 256. Validate defaults
  and every declared combination within the cap. Unknown
  `interfaceProperties` keys are errors only when a contract resolved.

- [ ] **Step 7: Preserve `interfaceProperties` in domain normalization**

  Read only canonical `interfaceProperties` into normalized bus interfaces and
  leave opaque keys untouched. Add a round-trip test proving no property map is
  dropped or materialized when absent.

- [ ] **Step 8: Verify the resolver**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractResolve.test.ts src/test/suite/shared/busConformance.test.ts src/test/suite/domain/roundtrip.test.ts
  ```

  Expected: all four states, the 256 cap, five built-in rule tables, and
  structured paths pass.

- [ ] **Step 9: Review checkpoint**

  Run `git diff --check` and confirm the pure modules import neither `vscode`,
  React, components, nor generator templates.

---

### Task 5: Load and transport one normalized runtime contract library

**Files:**

- Modify: `src/services/BusLibraryService.ts`
- Modify: `src/services/ImportResolver.ts`
- Modify: `src/services/ResourceRoots.ts`
- Modify: `src/providers/IpCoreEditorProvider.ts`
- Modify: `src/webview/ipcore/types/messages.ts`
- Modify: `src/webview/ipcore/hooks/useIpCoreState.ts`
- Modify: `src/generator/IpCoreScaffolder.ts`
- Modify: `src/generator/resolvers/types.ts`
- Test: `src/test/suite/services/BusLibraryService.test.ts`
- Test: `src/test/suite/services/ImportResolver.test.ts`
- Create: `src/test/suite/services/IpCoreEditorProvider.test.ts`
- Test: `src/test/suite/generator/IpCoreScaffolder.test.ts`

**Interfaces:**

- Consumes: `normalizeBusLibrary` from Task 3.
- Produces: `ResolvedImports.busLibrary?: NormalizedBusLibrary` and
  `ResolverInput.busLibrary: NormalizedBusLibrary` across the process boundary.
- Produces: deterministic precedence `built-in < workspace < configured user <
per-IP useBusLibrary` by exact definition key/canonical VLNV.

- [ ] **Step 1: Write failing service tests for normalization and diagnostics**

  Update fixtures to include complete raw definition objects. Assert bundled
  malformed contracts throw, malformed workspace contracts are excluded with
  source paths, unknown workspace roles remain with warnings, and later sources
  win deterministically.

- [ ] **Step 2: Run focused service tests and confirm raw-record expectations fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusLibraryService.test.ts src/test/suite/services/ImportResolver.test.ts
  ```

  Expected: FAIL until services return the normalized runtime shape.

- [ ] **Step 3: Preserve source identity while loading**

  Replace anonymous `Object.assign` merging with ordered
  `BusDefinitionSource[]` entries:

  ```ts
  const source: BusDefinitionSource = {
    sourceFile: filePath,
    sourceKind,
    definitions: parsed,
  };
  ```

  Parse files with `js-yaml`, validate each with the packaged schema, normalize
  them once, and cache the resulting serializable `NormalizedBusLibrary`.

- [ ] **Step 4: Send the normalized library to the webview**

  Narrow the message/import types from `Record<string, unknown>` to
  `NormalizedBusLibrary`. Ensure update messages and revision filtering remain
  unchanged except for the payload type. Add a provider test that inspects the
  posted update message.

- [ ] **Step 5: Inject the same library into generator resolver input**

  Make `IpCoreScaffolder.ensureBusDefinitions` assemble all sources first,
  including per-IP definitions, and retain both normalized contracts and raw
  port data through one `NormalizedBusLibrary`. Do not reload or renormalize per
  resolver.

- [ ] **Step 6: Verify loading and transport**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusLibraryService.test.ts src/test/suite/services/ImportResolver.test.ts src/test/suite/services/IpCoreEditorProvider.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts
  npm run compile
  ```

  Expected: normalized contracts and load diagnostics reach both generator and
  webview without broad contexts or layer-reversing imports.

- [ ] **Step 7: Review checkpoint**

  Run `git diff --check` and inspect the extension/webview message pair together
  for protocol compatibility.

---

### Task 6A: Adopt canonical contracts in shared and extension-side consumers

**Files:**

- Test: `src/test/suite/webview/busDefinitions.test.ts`
- Modify: `src/test/suite/shared/busVlnv.test.ts`
- Modify: `src/test/suite/generator/resolvers/busRegistry.test.ts`
- Create: `src/test/suite/shared/busContractMigration.characterization.test.ts`
- Create: `src/test/suite/shared/busPortNameSet.test.ts`
- Modify: `src/shared/busVlnv.ts`
- Modify: `src/shared/busPortNameSet.ts`
- Modify: `src/generator/buses/types.ts`
- Modify: `src/generator/buses/registry.ts`
- Modify: `src/generator/buses/builtin.ts`
- Modify: `src/generator/registerProcessor.ts`
- Modify: `src/generator/resolvers/addressing.ts`
- Modify: `src/generator/resolvers/bus.ts`
- Modify: `src/generator/resolvers/interrupts.ts`
- Modify: `src/generator/validation/hdlCrossCheck.ts`
- Modify: `src/parser/HwTclParser.ts`
- Modify: `src/parser/ComponentXmlParser.ts`

**Interfaces:**

- Consumes: `canonicalizeBusType`, `normalizeInterfaceMode`, normalized port
  definitions, and the runtime library transported in Task 5.
- Produces: shared and extension-side consumers that accept an injected
  `NormalizedBusLibrary`, plus an exact template registry keyed by canonical
  VLNV. No shared, parser, or generator module imports webview code or owns
  aliases, modes, roles, or memory-mapped classification.

- [ ] **Step 1: Land the shared characterization gate before changing lookup behavior**

  Store the legacy port expectations as test-owned data, then assert both the
  current hard-coded lookup and the normalized built-ins match each shared
  port's name, direction, presence, role, and width. Record the known Avalon-MM
  differences as explicit expected deltas. Add one alias closure table combining
  all four current sources: `busVlnv.test.ts`, `busDefinitions.test.ts`, every
  `lookupBusDef` branch, and `src/generator/buses/builtin.ts`. Assert each
  spelling resolves to the same canonical contract and `interfaceKind`.

- [ ] **Step 2: Run characterization tests against the old tables**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/webview/busDefinitions.test.ts src/test/suite/shared/busVlnv.test.ts src/test/suite/generator/resolvers/busRegistry.test.ts
  ```

  Expected: PASS before any production lookup path changes. The test-owned
  expectations remain after the hard-coded module is deleted in Task 6B.

- [ ] **Step 3: Replace memory-map and mode predicates**

  Change `busSupportsMemoryMap`, `busSupportsInterruptAssociation`,
  `getBusTypeForTemplate`, `hasMemoryMappedSlaveInterface`, addressing, and
  interrupt resolution to consume a canonical match and call:

  ```ts
  const eligible =
    match.contract.interfaceKind === 'memoryMapped' &&
    normalizeInterfaceMode(match.contract, iface.mode) === match.contract.modePolicy.consumer &&
    (iface.array?.count === undefined || iface.array.count <= 1);
  ```

  Remove literal `slave` gates from `addressing.ts` and
  `registerProcessor.ts`. Keep generator template selection separate and keyed
  by exact canonical VLNV.

- [ ] **Step 4: Migrate parser, checker, generator, and shared utilities**

  Add an injected `NormalizedBusLibrary` parameter to each pure parser/helper
  that needs protocol lookup. Update command/provider/service callers to supply
  the loaded library. Remove imports from `src/webview/` in `HwTclParser`,
  `ComponentXmlParser`, `hdlCrossCheck`, and `busPortNameSet`. Add direct tests
  proving `busPortNameSet` uses canonical ports and preserves a contract-less
  custom interface's physical ports.

- [ ] **Step 5: Retire extension-side alias and classification ownership**

  Remove alias arrays and `isMemoryMapped` from the generator registry; retain
  only exact canonical template-provider mapping required by the Nunjucks packs.
  Keep `src/webview/ipcore/data/busDefinitions.ts` temporarily as the webview's
  characterized adapter until Task 6B.

- [ ] **Step 6: Verify the extension-side cutover and dependency direction**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/shared/busPortNameSet.test.ts src/test/suite/shared/busVlnv.test.ts src/test/suite/generator/resolvers/busRegistry.test.ts src/test/suite/generator/registerProcessor.test.ts src/test/suite/generator/resolvers/addressing.test.ts src/test/suite/generator/validation/hdlCrossCheck.test.ts src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts src/test/suite/parser/ComponentXmlParser.test.ts
  rg -n "webview/ipcore/data/busDefinitions|includes\('(axi|stream|avalon)|mode.*slave" src/parser src/generator src/shared
  npm run compile
  ```

  Expected: tests pass; no shared/parser/generator import from webview remains;
  no protocol substring or literal-consumer gate remains in those layers. Review
  any unrelated `slave` occurrence manually rather than deleting it
  mechanically.

- [ ] **Step 7: Review checkpoint**

  Run `git diff --check` and review the extension-side behavior and layering
  fix independently. Leave the hard-coded webview table and its consumers for
  Task 6B.

---

### Task 6B: Migrate webview consumers and delete the hard-coded table

**Files:**

- Modify: `src/test/suite/shared/busContractMigration.characterization.test.ts`
- Delete after cases move to the characterization test:
  `src/test/suite/webview/busDefinitions.test.ts`
- Modify: `src/test/suite/webview/useCanvasValidation.test.ts`
- Create: `src/test/browser/bus-contract-library.spec.ts`
- Modify: `src/webview/ipcore/IpCoreApp.tsx`
- Modify: `src/webview/ipcore/hooks/useGroupPorts.ts`
- Modify: `src/webview/ipcore/hooks/useCanvasValidation.ts`
- Modify: `src/webview/ipcore/components/canvas/IpBlockCanvas.tsx`
- Modify: `src/webview/ipcore/components/canvas/GroupingMappingStep.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/BusPanel.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/ConduitFields.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/ConduitPanel.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/busInterfaceMetadata.ts`
- Modify: `src/webview/ipcore/components/canvas/inspector/controls/BusTypeFields.tsx`
- Modify: `src/webview/ipcore/utils/protocolMatcher.ts`
- Delete after characterization passes: `src/webview/ipcore/data/busDefinitions.ts`

**Interfaces:**

- Consumes: the `NormalizedBusLibrary` delivered to the webview in Task 5 and
  the test-owned legacy expectations established in Task 6A.
- Produces: narrow canonical lookup props for grouping, validation, canvas, and
  inspector consumers. The webview no longer has a protocol table parallel to
  `ipcraft-spec`.

- [ ] **Step 1: Re-run the shared characterization gate before webview changes**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/webview/busDefinitions.test.ts
  ```

  Expected: PASS with the hard-coded table still present.

- [ ] **Step 2: Write failing webview regression coverage**

  Extend `useCanvasValidation.test.ts` and add
  `bus-contract-library.spec.ts`. Inject the normalized library with AXI4-Stream
  and Avalon-MM interfaces. Assert grouping and inspector metadata use canonical
  roles, then expand Avalon-MM and assert the canonical optional `clk`/`reset`
  behavior and the intentional canonical-YAML port set. Assert selecting a
  bundle or subport still opens and focuses the correct inspector field.

- [ ] **Step 3: Run the new UI coverage and confirm the canonical Avalon-MM expectations fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/useCanvasValidation.test.ts
  npm run test:browser -- src/test/browser/bus-contract-library.spec.ts
  ```

  Expected: FAIL while the webview still prefers the hard-coded Avalon-MM table.

- [ ] **Step 4: Migrate every webview consumer through narrow props**

  Have `IpCoreApp` derive lookup adapters from its transported
  `NormalizedBusLibrary`, then pass only the library or focused lookup callbacks
  to consumers that need them. Replace `role`/`endianRole` dual fields with the
  one normalized `role`. Keep `IpCoreApp` and `IpBlockCanvas` focused on
  composition and preserve selection, grouping, optional-port toggles, and
  inspector focus.

- [ ] **Step 5: Delete the hard-coded table after both gates pass**

  Move the durable alias/port cases from `busDefinitions.test.ts` into the
  test-owned expectations in
  `busContractMigration.characterization.test.ts`, remove its import of the old
  module, then delete `busDefinitions.test.ts` and `busDefinitions.ts`. Do not
  delete an expected legacy value merely because the new canonical Avalon-MM
  value differs; keep each intentional delta named in the characterization
  fixture.

- [ ] **Step 6: Verify the webview cutover and visible canvas behavior**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx src/test/suite/components/CanvasInspector.BusInterfaceMatrix.test.tsx
  npm run test:browser -- src/test/browser/bus-contract-library.spec.ts src/test/browser/bus-interface-matrix-select.spec.ts src/test/browser/subport-click-toggle.spec.ts
  rg -n "webview/ipcore/data/busDefinitions|from .*data/busDefinitions" src
  npm run compile
  ```

  Expected: unit and browser tests pass, no production or test import references
  the deleted module, and the browser assertions expose the intentional
  Avalon-MM canvas changes independently from the extension-side refactor.

- [ ] **Step 7: Review checkpoint**

  Run `git diff --check` and review only the webview migration, deleted table,
  retained characterization expectations, and intentional canvas deltas.

---

### Task 7: Enforce conformance in generation, imports, and the explicit checker

**Files:**

- Create: `src/shared/issues.ts`
- Create: `src/services/BusConformanceService.ts`
- Modify: `src/generator/IpCoreScaffolder.ts`
- Modify: `src/generator/loadIpCore.ts`
- Modify: `src/services/GenerationEngine.ts`
- Modify: `src/providers/IpCoreGenerateHandler.ts`
- Modify: `src/commands/ConsistencyCheckCommands.ts`
- Modify: `src/commands/ImportCommands.ts`
- Modify: `src/providers/IpCoreSourcePreviewProvider.ts`
- Modify: `src/shared/messages/ipCore.ts`
- Modify: `src/webview/ipcore/types/messages.ts`
- Create: `src/test/suite/services/BusConformanceService.test.ts`
- Test: `src/test/suite/generator/IpCoreScaffolder.test.ts`
- Test: `src/test/suite/services/GenerationEngine.test.ts`
- Test: `src/test/suite/commands/ConsistencyCheckCommands.test.ts`
- Create: `src/test/suite/commands/ImportCommands.test.ts`
- Create: `src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts`

**Interfaces:**

- Consumes: `validateBusInterfaces` and the runtime library.
- Produces:

  ```ts
  export type IssueSource = 'schema' | 'protocol' | 'references' | 'hdl' | 'hwTcl' | 'componentXml';

  export interface IpcraftIssue {
    code: string;
    severity: 'error' | 'warning';
    source: IssueSource;
    path: readonly (string | number)[];
    message: string;
    interfaceName?: string;
  }

  export interface ConformanceReport {
    issues: readonly IpcraftIssue[];
    hasKnownErrors: boolean;
    hasUnresolved: boolean;
  }

  export function checkBusConformance(
    ipCore: IpCoreData,
    library: NormalizedBusLibrary
  ): ConformanceReport;
  ```

- [ ] **Step 1: Write the enforcement-table tests before adding gates**

  Cover these exact decisions:

  | Boundary              | Known error |         Unresolved | Warning |
  | --------------------- | ----------: | -----------------: | ------: |
  | Save edited `.ip.yml` |       allow |              allow |   allow |
  | Save import result    |       block | allow with warning |   allow |
  | Generate/export       |       block |              block |   allow |
  | Explicit checker      |        fail |               fail |  report |

  Assert an unknown alias carrying `memoryMapRef` produces
  `BUS_MEMORY_MAP_UNSUPPORTED` and blocks before `generateAll` constructs a
  staging result.

- [ ] **Step 2: Run the focused tests and confirm no gate exists**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusConformanceService.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts src/test/suite/services/GenerationEngine.test.ts
  ```

  Expected: FAIL because generation currently proceeds after schema validation.

- [ ] **Step 3: Implement one service adapter and issue conversion**

  Keep policy out of the pure resolver. Convert each
  `BusConformanceDiagnostic` to `IpcraftIssue` with `source: 'protocol'`, and
  expose explicit predicates:

  ```ts
  export const blocksGeneration = (report: ConformanceReport): boolean =>
    report.hasKnownErrors || report.hasUnresolved;

  export const blocksImportWrite = (report: ConformanceReport): boolean => report.hasKnownErrors;
  ```

- [ ] **Step 4: Gate the scaffolder before resolving memory maps or templates**

  In `generateAll`, finish merging the runtime bus library, validate the loaded
  IP, and return a failure containing structured issues before
  `resolveMemoryMaps`, `buildTemplateContext`, dry-run staging, or any filesystem
  output. Ensure `GenerationEngine` and `IpCoreGenerateHandler` forward issues
  in `generateResult` instead of flattening them to one opaque string.

- [ ] **Step 5: Add protocol results to the explicit checker**

  Run conformance before HDL/vendor cross-checks, adapt existing findings into
  `IpcraftIssue`, and return one ordered issue list. Deduplicate by
  `code + JSON.stringify(path) + source`; do not parse dotted paths.

- [ ] **Step 6: Gate command imports and preview saves**

  Parse the proposed YAML in memory, load the same runtime contract library for
  the source directory, then apply import policy before calling
  `writeImportedFile`. Known errors show the diagnostics and write neither
  `.ip.yml` nor companion `.mm.yml`. Unresolved cases write and display warnings.
  Preview messages carry the report so the webview can disable Save without a
  second protocol implementation.

- [ ] **Step 7: Verify no partial-output path remains**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusConformanceService.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts src/test/suite/services/GenerationEngine.test.ts src/test/suite/commands/ConsistencyCheckCommands.test.ts src/test/suite/commands/ImportCommands.test.ts src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts
  ```

  Expected: known-invalid import/generation tests assert zero write calls;
  unresolved import asserts one atomic IP write and warning; generation remains
  blocked.

- [ ] **Step 8: Review checkpoint**

  Run `git diff --check` and inspect every call to `writeImportedFile`,
  `generateAll`, and staging creation to confirm validation precedes mutation.

---

### Task 8: Replace fragmented validation UI with one actionable Issues panel

**Files:**

- Create: `src/webview/ipcore/types/issues.ts`
- Create: `src/webview/ipcore/hooks/useIssuesSession.ts`
- Create: `src/webview/ipcore/components/canvas/IssuesPanel.tsx`
- Modify: `src/webview/ipcore/hooks/useCanvasValidation.ts`
- Modify: `src/webview/ipcore/hooks/useConsistencySession.ts`
- Modify: `src/webview/ipcore/types/consistency.ts`
- Modify: `src/webview/ipcore/components/IpCoreShell.tsx`
- Modify: `src/webview/ipcore/components/IpCoreRightPanel.tsx`
- Modify: `src/webview/ipcore/components/IpCoreToolbar.tsx`
- Modify: `src/webview/ipcore/components/canvas/IpBlockCanvas.tsx`
- Modify: `src/webview/ipcore/components/canvas/CanvasBusBundle.tsx`
- Modify: `src/webview/ipcore/components/canvas/CanvasBusSubPort.tsx`
- Modify: `src/webview/ipcore/IpCoreApp.tsx`
- Modify: `src/webview/ipcore/hooks/useIpCoreBridge.ts`
- Create: `src/test/suite/webview/issues.test.ts`
- Test: `src/test/suite/webview/useCanvasValidation.test.ts`
- Create: `src/test/suite/components/IssuesPanel.test.tsx`
- Create: `src/test/suite/components/IpCoreToolbar.test.tsx`
- Create: `src/test/suite/components/IpCoreShell.test.tsx`

**Interfaces:**

- Consumes: structured `IpcraftIssue[]` from Task 7 and immediate local schema,
  reference, and protocol issues.
- Produces:

  ```ts
  export interface IssueFocusRequest {
    path: readonly (string | number)[];
    nonce: number;
  }

  export function issueKey(issue: IpcraftIssue): string;
  export function issuesToCanvasAnnotations(issues: readonly IpcraftIssue[]): CanvasAnnotations;
  ```

- [ ] **Step 1: Write failing projection and panel tests**

  Assert protocol paths map `['busInterfaces', 1]` to `bus:1` and
  `['busInterfaces', 1, 'portWidthOverrides', 'empty']` to both `bus:1` and the
  logical `empty` subport. Assert grouping order `Schema`, `Protocol`,
  `References`, `HDL consistency`, `Vendor artifact consistency`; duplicate
  keys collapse; error and warning counts remain distinct.

- [ ] **Step 2: Run UI tests and confirm the Issues components are absent**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/issues.test.ts src/test/suite/components/IssuesPanel.test.tsx
  ```

  Expected: FAIL on missing module/components.

- [ ] **Step 3: Implement the pure UI issue adapters**

  Preserve source paths as arrays. Convert existing reference errors and
  consistency findings once at their boundary, then merge them with immediate
  protocol results. Deduplicate with:

  ```ts
  export const issueKey = (issue: IpcraftIssue): string =>
    `${issue.source}|${issue.code}|${JSON.stringify(issue.path)}`;
  ```

- [ ] **Step 4: Build the Issues panel and selection behavior**

  Replace the footer labeled `Reference Validation Errors` and the separate
  consistency overlay with `IssuesPanel`. Clicking a row closes competing
  overlays, selects the canvas element, expands a bus when needed, and publishes
  an `IssueFocusRequest`. Keep staging overlay precedence; Issues occupies the
  right slot when explicitly opened or when generation is blocked.

- [ ] **Step 5: Add toolbar counts and blocked-generation behavior**

  Show separate error/warning totals. When `generateResult.success === false`
  includes issues, open the panel and focus the first error, falling back to the
  first warning. Keep auto consistency checks silent: update counts without
  opening the panel.

- [ ] **Step 6: Annotate bundles and logical subports from the same issues**

  Remove protocol-specific warning construction from `useCanvasValidation` once
  the shared validator supplies it. Merge issue annotations with remaining local
  structural annotations, preserving existing canvas dot/tool-tip rendering.

- [ ] **Step 7: Gate import-preview Save in the shell**

  Add `importSaveBlocked` and `onOpenIssues` props. Disable `Save as .ip.yml`
  only for known errors; keep it enabled for unresolved warnings and add an
  accessible title explaining the warning state.

- [ ] **Step 8: Verify the unified UI**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/issues.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/IssuesPanel.test.tsx src/test/suite/components/IpCoreToolbar.test.tsx src/test/suite/components/IpCoreShell.test.tsx
  npm run compile
  ```

  Expected: one issue model drives counts, panel rows, canvas markers, preview
  save state, and blocked-generation focus.

- [ ] **Step 9: Review checkpoint**

  Run `git diff --check`; verify `IpCoreApp`, `IpCoreShell`, and
  `IpBlockCanvas` remain composition-focused and issue transformation lives in
  the hook/type modules.

---

### Task 9: Add contract-aware bus editing and atomic derived-width cleanup

**Files:**

- Create: `src/webview/ipcore/hooks/useBusContractEditor.ts`
- Create: `src/webview/ipcore/components/canvas/inspector/buses/BusContractFields.tsx`
- Modify: `src/webview/ipcore/components/canvas/CanvasInspector.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/BusPanel.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/ConduitFields.tsx`
- Modify: `src/webview/ipcore/hooks/useIpCoreState.ts`
- Modify: `src/webview/ipcore/IpCoreApp.tsx`
- Create: `src/test/suite/webview/useBusContractEditor.test.ts`
- Test: `src/test/suite/webview/useIpCoreState.test.ts`
- Modify: `src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx`
- Create: `src/test/suite/components/CanvasInspector.BusContractFields.test.tsx`

**Interfaces:**

- Consumes: `BusInterfaceResolution`, contract metadata, `IssueFocusRequest`, and
  existing `BatchUpdate`.
- Produces:

  ```ts
  export interface EditableContractField {
    path: readonly (string | number)[];
    name: string;
    value: number | string | boolean | undefined;
    error?: string;
  }

  export interface ReadonlyContractField {
    name: string;
    formula: string;
    resolvedValue?: number;
    state: ResolutionState;
  }

  export type BusContractMutation = [Array<string | number>, unknown];

  export interface BusContractEditModel {
    rootWidths: readonly EditableContractField[];
    properties: readonly EditableContractField[];
    derivedWidths: readonly ReadonlyContractField[];
    fixedWidths: readonly ReadonlyContractField[];
  }

  export function buildRootWidthMutations(
    busIndex: number,
    portName: string,
    value: number | string,
    resolution: BusInterfaceResolution
  ): BusContractMutation[];
  ```

- [ ] **Step 1: Write failing editor-model tests**

  For AXI4-Stream, assert `TDATA` is editable, `TKEEP` displays
  `TDATA / 8 = 8` read-only, and editing `TDATA` from 32 to 64 returns one batch:

  ```ts
  expect(mutations).toEqual([
    [['busInterfaces', 0, 'portWidthOverrides', 'TDATA'], 64],
    [['busInterfaces', 0, 'portWidthOverrides', 'TKEEP'], undefined],
    [['busInterfaces', 0, 'portWidthOverrides', 'TSTRB'], undefined],
  ]);
  ```

  Assert load alone preserves matching explicit derived overrides.

- [ ] **Step 2: Run focused tests and confirm no contract editor exists**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/useBusContractEditor.test.ts src/test/suite/components/CanvasInspector.BusContractFields.test.tsx
  ```

  Expected: FAIL on missing editor model/component.

- [ ] **Step 3: Implement the pure edit model and deterministic mutations**

  Build fields from width policies and property declarations. On a root edit,
  always delete every affected explicit derived override; never rewrite it to a
  new redundant number and never materialize an omitted derived value.

- [ ] **Step 4: Render root, semantic, derived, and fixed fields**

  Use existing inspector controls. Show formula and effective value for derived
  fields, expected/actual text for invalid editable fields, and no edit handler
  for derived/fixed values. Render Avalon-ST `dataBitsPerSymbol`,
  `symbolsPerBeat`, `readyLatency`, and `maxChannel` under Configuration.

- [ ] **Step 5: Apply coupled edits with `updateIpCoreBatch`**

  Wire `BusContractFields` through the existing `batchUpdateIpCore` callback in
  `IpCoreApp`. Add a state test proving one `pushUndo`, one state transition, and
  one debounced outbound update for the mutation batch.

- [ ] **Step 6: Focus inspector fields from issue paths**

  Map the final path segments to stable field IDs such as
  `bus-0-property-dataBitsPerSymbol` and `bus-0-width-TDATA`. On a new
  `IssueFocusRequest.nonce`, call `focus()` and `scrollIntoView({ block:
'nearest' })` after the selected inspector renders.

- [ ] **Step 7: Verify editor behavior**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/useBusContractEditor.test.ts src/test/suite/webview/useIpCoreState.test.ts src/test/suite/components/CanvasInspector.BusContractFields.test.tsx src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx
  ```

  Expected: root edits are atomic, derived overrides are deleted
  deterministically, and issue focus reaches the correct field.

- [ ] **Step 8: Review checkpoint**

  Run `git diff --check`; inspect YAML mutation paths and confirm no
  `sendUpdate` loop or new `__op` was introduced.

---

### Task 10: Preserve Avalon-ST properties through `_hw.tcl` import and export

**Files:**

- Modify: `src/parser/HwTclParser.ts`
- Modify: `src/generator/resolvers/bus.ts`
- Modify: `src/generator/templates/altera_hw_tcl.j2`
- Modify: `src/test/suite/parser/HwTclParser.test.ts`
- Modify: `src/test/suite/parser/HwTclParser.altera.test.ts`
- Modify: `src/test/suite/generator/resolvers/bus.test.ts`
- Modify: `src/test/integration/roundtrip.test.ts`
- Modify: `src/test/integration/snapshots.test.ts`

**Interfaces:**

- Consumes: canonical contract lookup and resolved Avalon-ST properties.
- Produces: parser output with canonical `mode: source | sink`, `endianness`, and
  `interfaceProperties`; template context with a deterministic ordered property
  list.

- [ ] **Step 1: Write failing parser cases for current and legacy spellings**

  Parse this fixture and assert the canonical `.ip.yml` shape:

  ```tcl
  add_interface stream avalon_streaming start
  set_interface_property stream dataBitsPerSymbol 1
  set_interface_property stream symbolsPerBeat 5
  set_interface_property stream readyLatency 0
  set_interface_property stream firstSymbolInHighOrderBits true
  add_interface_port stream stream_data data Output 5
  ```

  Expected: `mode: source`, `endianness: big`, and
  `interfaceProperties: { dataBitsPerSymbol: 1, symbolsPerBeat: 5,
readyLatency: 0 }`. Repeat with legacy `bitsPerSymbol`. Add a conflict case
  where both spellings differ and parsing returns a source-located error.

- [ ] **Step 2: Run parser tests and confirm properties are currently dropped**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts
  ```

  Expected: FAIL on missing `interfaceProperties` and canonical streaming mode.

- [ ] **Step 3: Implement contract-driven property import**

  Remove the webview lookup dependency if any remains. Read only properties
  declared by the matched contract, coerce declared integer/boolean values, map
  `bitsPerSymbol` to `dataBitsPerSymbol`, and map
  `firstSymbolInHighOrderBits` solely to `endianness`. Derive omitted
  `symbolsPerBeat` only when data width divides by symbol width.

- [ ] **Step 4: Emit canonical properties in Platform Designer Tcl**

  Project resolved properties as an ordered array and render:

  ```jinja2
  {% for prop in iface.interface_properties %}
  set_interface_property {{ iface.name }} {{ prop.name }} {{ prop.tcl_value }}
  {% endfor %}
  set_interface_property {{ iface.name }} firstSymbolInHighOrderBits {% if iface.endianness == 'big' %}true{% else %}false{% endif %}
  ```

  Do not emit `bitsPerSymbol`. Preserve symbolic parameter references in Tcl
  form where supported.

- [ ] **Step 5: Add one-bit-symbol round-trip coverage**

  Import `_hw.tcl` -> generate `.ip.yml` -> regenerate `_hw.tcl` -> re-import,
  then assert `data=5`, `dataBitsPerSymbol=1`, `symbolsPerBeat=5`,
  `readyLatency=0`, and `endianness=big` remain unchanged.

- [ ] **Step 6: Verify parser, generator, and snapshots**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts src/test/suite/generator/resolvers/bus.test.ts
  npm run test:integration:snapshots -- --runInBand
  ```

  Expected: unit and snapshot tests pass with current-property spelling only.

- [ ] **Step 7: Review checkpoint**

  Run `git diff --check`; inspect that `firstSymbolInHighOrderBits` never appears
  as an `.ip.yml` `interfaceProperties` key.

---

### Task 11: Generate Avalon-ST endianness in symbol-sized lanes

**Files:**

- Modify: `src/generator/resolvers/bus.ts`
- Modify: `src/generator/contract/template_context.schema.json`
- Generate: `src/generator/contract/templateContext.types.ts`
- Modify: `src/generator/templates/top.vhdl.j2`
- Modify: `src/generator/templates/top.sv.j2`
- Modify: `src/webview/ipcore/hooks/useCanvasValidation.ts`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/BusPanel.tsx`
- Preserve: `src/webview/ipcore/utils/portEndianness.ts`
- Modify: `src/test/suite/generator/resolvers/bus.test.ts`
- Modify: `src/test/suite/webview/useCanvasValidation.test.ts`
- Modify: `src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx`
- Modify: `src/test/integration/endianness.test.ts`

**Interfaces:**

- Consumes: resolved `dataBitsPerSymbol` and normalized port roles.
- Produces template entries with explicit lane semantics:

  ```ts
  interface EndianSwapPort {
    name: string;
    internal_name: string;
    direction: string;
    width: number | string;
    swap_kind: 'lane' | 'bit';
    lane_width: number | string;
    is_parameterized: boolean;
  }
  ```

- [ ] **Step 1: Write failing resolver and UI cases for a five-bit stream**

  Resolve a big-endian Avalon-ST source with `data=5`,
  `dataBitsPerSymbol=1`, and `symbolsPerBeat=5`. Assert its data port has
  `swap_kind: 'lane'`, `lane_width: 1`, and `needs_swap: true`. Assert webview
  validation emits no byte-multiple warning and the bus endianness selector is
  enabled. Retain the existing warning/disabled behavior for a five-bit
  standalone port.

- [ ] **Step 2: Run focused tests and confirm byte-only behavior fails**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/resolvers/bus.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx
  ```

  Expected: FAIL because `needsByteSwap` rejects width 5.

- [ ] **Step 3: Replace byte-only bus swap metadata**

  Keep raw standalone ports at `lane_width: 8`. For interface data roles, use
  `8` for AXI/Avalon-MM and resolved `dataBitsPerSymbol` for Avalon-ST. Require
  `width % laneWidth === 0` and more than one lane. Byte qualifiers retain
  one-bit lane reversal aligned to their data lanes.

- [ ] **Step 4: Render generic lane-reversal loops**

  In both top templates, map destination lane `i` to source lane
  `laneCount - 1 - i` using `lane_width`. Fixed and parameterized variants must
  avoid a `/ 8` assertion for symbol-lane swaps. Keep existing generated
  `swap_bytes_<width>` helpers only for fixed eight-bit lane swaps if they remain
  simpler than the generic loop.

- [ ] **Step 5: Extend the template-context schema and regenerate types**

  Replace the byte/bit-only enum with lane/bit and require `lane_width` for lane
  swaps. Update descriptions, run type generation, and fix compile errors rather
  than hand-editing `templateContext.types.ts`.

- [ ] **Step 6: Add VHDL and SystemVerilog integration fixtures**

  Extend `src/test/integration/endianness.test.ts` with the five-bit stream.
  Assert generated RTL contains five lane assignments in reverse order, contains
  no byte-alignment guard for that port, and compiles/elaborates under the
  suite's available GHDL/Icarus gates.

- [ ] **Step 7: Verify endianness behavior**

  Run:

  ```bash
  npm run generate-types
  npm run compile
  npx jest --config config/jest.config.js src/test/suite/generator/resolvers/bus.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx
  npx jest --config config/jest.integration.js src/test/integration/endianness.test.ts --runInBand
  ```

- [ ] **Step 8: Review checkpoint**

  Run `git diff --check`; confirm `portEndianness.ts` stayed byte-oriented and
  only contract-resolved bus data gained symbol lanes.

---

### Task 12: Preserve Avalon-ST identity and properties in custom IP-XACT

**Files:**

- Modify: `src/generator/VivadoComponentXmlGenerator.ts`
- Modify: `src/generator/templates/amd_component_xml.j2`
- Modify: `src/generator/VivadoBusDefInstaller.ts`
- Modify: `src/parser/ComponentXmlParser.ts`
- Modify: `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts`
- Modify: `src/test/suite/parser/ComponentXmlParser.test.ts`
- Modify: `src/test/integration/roundtrip.test.ts`

**Interfaces:**

- Consumes: canonical Avalon-ST contract, resolved properties, and existing
  custom bus-definition/abstraction-definition generation.
- Produces: standard IP-XACT bus-interface parameters plus deterministic IPCraft
  vendor metadata in namespace `urn:ipcraft:interface-contract:1`.

- [ ] **Step 1: Write failing custom Avalon-ST export tests**

  Generate `component.xml` for the five-bit, one-bit-symbol stream and assert:

  ```ts
  expect(xml).toContain('spirit:vendor="ipcraft"');
  expect(xml).toContain('spirit:name="avalon_st"');
  expect(xml).not.toContain('spirit:name="axis"');
  expect(xml).toContain('xmlns:ipcraft="urn:ipcraft:interface-contract:1"');
  expect(xml).toContain('<ipcraft:property name="dataBitsPerSymbol" value="1"');
  expect(xml).toContain('<ipcraft:property name="symbolsPerBeat" value="5"');
  ```

  Assert bundled bus/abstraction files are generated and physical ports are not
  padded or relabeled as AXI4-Stream.

- [ ] **Step 2: Write failing import and conflict tests**

  Parse the exported XML and assert canonical properties/endianness return. Add
  a fixture where a standard IP-XACT property differs from the mirrored IPCraft
  property and assert a blocking diagnostic rather than precedence guessing.

- [ ] **Step 3: Run focused XML tests and confirm metadata is absent**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/parser/ComponentXmlParser.test.ts
  ```

  Expected: FAIL on missing parameters/vendor extension or incorrect identity.

- [ ] **Step 4: Extend custom bus artifact generation**

  Treat canonical Avalon-ST as custom for AMD packaging even though it is a
  built-in IPCraft contract. Generate its bus definition and abstraction
  definition once per VLNV. Set IP-XACT addressability from `interfaceKind`, not
  from the bus name.

- [ ] **Step 5: Emit deterministic standard and mirrored properties**

  Sort canonical property names lexicographically. Emit standard bus-interface
  parameters where the current IP-XACT writer supports them, with
  `firstSymbolInHighOrderBits` derived from `endianness`. Mirror contract version,
  canonical `endianness`, and the complete canonical property map as:

  ```xml
  <ipcraft:interfaceContract version="1">
    <ipcraft:property name="dataBitsPerSymbol" value="1"/>
    <ipcraft:property name="endianness" value="big"/>
    <ipcraft:property name="symbolsPerBeat" value="5"/>
  </ipcraft:interfaceContract>
  ```

- [ ] **Step 6: Import standard parameters and verify the mirror**

  Map standard `firstSymbolInHighOrderBits` back to canonical `endianness` and
  standard semantic parameters to `interfaceProperties`. Use the mirror to
  recover ignored parameters, but report any standard/mirror disagreement as a
  known error with an XML source location.

- [ ] **Step 7: Add full XML round-trip coverage**

  Extend `roundtrip.test.ts`:

  ```text
  .ip.yml Avalon-ST -> component.xml + custom bus files -> parsed .ip.yml
  ```

  Assert VLNV, mode, data width, symbol properties, ready latency, channel
  maximum, and endianness are identical.

- [ ] **Step 8: Verify IP-XACT output and re-import**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/parser/ComponentXmlParser.test.ts
  npx jest --config config/jest.integration.js src/test/integration/roundtrip.test.ts --runInBand
  ```

  Expected: custom Avalon-ST remains custom, round trips losslessly, and never
  appears as AXI4-Stream.

- [ ] **Step 9: Review checkpoint**

  Run `git diff --check`; inspect XML ordering snapshots and ensure one canonical
  metadata representation is emitted.

---

### Task 13: Migrate examples, finish browser coverage, and activate enforcement

**Files:**

- Modify as diagnostics require: `ipcraft-spec/examples/**/*.ip.yml`
- Modify: `ipcraft-spec/examples/comprehensive_avalon/comprehensive_avalon.ip.yml`
- Modify: `ipcraft-spec/examples/comprehensive_avalon/README.md`
- Modify: `ipcraft-spec/examples/comprehensive_axi/README.md`
- Modify: `CHANGELOG.md`
- Modify or create: `src/test/suite/services/AllExamplesConformance.test.ts`
- Modify or create: `src/test/browser/ipcore-issues.spec.ts`
- Modify: documentation/snapshot fixtures affected by canonical modes and ports

**Interfaces:**

- Consumes: the complete validator, UI, importer, and generator behavior from
  Tasks 1-12.
- Produces: enforcement enabled for all shipped examples and end-to-end evidence
  for the user-visible workflow.

- [ ] **Step 1: Add an all-examples audit test before editing fixtures**

  Recursively load every shipped `.ip.yml`, resolve its effective bus library,
  and print diagnostics grouped by file. Fail on known errors or unresolved
  generation constraints. Explicitly assert the legacy comprehensive Avalon
  channel derives `maxChannel: 3` without rewriting the YAML.

- [ ] **Step 2: Run the audit and record each intentional migration**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/AllExamplesConformance.test.ts
  ```

  Expected: any failures identify exact array paths. Change only examples proven
  invalid by the contract; do not normalize unrelated formatting.

- [ ] **Step 3: Update examples and documentation deliberately**

  Add explicit Avalon-ST properties where legacy derivation is ambiguous,
  convert new/example streaming modes to `source`/`sink`, and correct invalid
  derived overrides. Document the observable Avalon-MM canvas port/optionality
  changes and the Avalon-ST generated-RTL lane-order change in `CHANGELOG.md`.

- [ ] **Step 4: Add browser coverage for the complete error workflow**

  Inject invalid AXI4-Stream YAML through `window.__RENDER__`, then assert the
  canvas bundle marker, subport marker, toolbar error count, grouped Protocol
  issue, issue-click selection/focus, and blocked-generation panel behavior.
  Add an unresolved-import preview case where Save remains enabled with a
  warning.

- [ ] **Step 5: Run the complete focused test matrix**

  Run:

  ```bash
  npm run generate-types
  npm run compile
  npm run type-check
  npm run lint
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/BuiltinBusContracts.test.ts src/test/suite/shared/busContractNormalize.test.ts src/test/suite/shared/busContractCanonicalize.test.ts src/test/suite/shared/busContractResolve.test.ts src/test/suite/shared/busConformance.test.ts src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/services/AllExamplesConformance.test.ts
  npm run test:browser -- src/test/browser/ipcore-issues.spec.ts
  npm run test:integration:hdl
  npm run test:integration:quartus
  npm run test:integration:vivado
  ```

  Expected: zero compile/type/lint errors; all unit/browser suites pass; available
  HDL/vendor integration gates pass or report only their repository-defined tool
  skip condition.

- [ ] **Step 6: Run repository-wide regression checks**

  Run:

  ```bash
  npm run test:unit
  git diff --check
  git status --short
  ```

  Expected: unit suite passes, no whitespace errors, and the status contains only
  intentional source, schema, generated type, documentation, fixture, and
  snapshot changes.

- [ ] **Step 7: Final review checkpoint**

  Present the full diff and verification outputs to the developer. Do not stage,
  commit, or push; let the developer decide integration and commit boundaries.
