# Bus Interface Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check the five built-in AXI and Avalon interfaces against one
declarative contract library. Show the same diagnostics in the editor, the
importers, the generators, and the checker. Keep the Avalon-ST symbol
properties through vendor import and export.

**Architecture:**

- `ipcraft-spec` owns a versioned bus-definition schema and the five
  complete contracts.
- Pure modules in `src/shared/busContracts/` normalize the library, map
  aliases and modes to canonical values, resolve widths and properties, and
  return structured diagnostics.
- Services load the runtime library one time. They give it to the parsers,
  the generators, the checker, and the webview.
- Components only show diagnostics and send atomic edits.

**Tech stack:** TypeScript, React, JSON Schema, Ajv, `js-yaml` (read-only
parse), `yaml` v2 (format-preserving edits), Nunjucks, Jest, Playwright,
GHDL, Icarus Verilog.

**Design reference:**
`docs/superpowers/specs/2026-08-11-bus-interface-conformance-design.md`.
The design defines the terms that this plan uses, for example root width,
derived width, canonical VLNV, and consumer mode.

**Writing style:** This plan follows the writing rules of ASD-STE100
Simplified Technical English (short sentences, one instruction in each
sentence, active voice, one term for each concept). It does not use the STE
dictionary.

## Status

All 106 steps were done and verified on 2026-08-12. Two later reviewed
changes are part of the final behavior. The tasks that they change have a
**Later change** note:

- Task 7: callers use the shared conformance policy in
  `src/shared/busConformance.ts` directly. The temporary
  `BusConformanceService` adapter does not exist.
- Task 12: the IP-XACT vendor extension copies only the properties that the
  user wrote. The standard vendor parameters still contain the resolved
  values.

## How to read this plan

Each task has the same parts:

1. **Files:** the files that the task creates, changes, generates, or
   deletes.
2. **Interfaces:** what the task uses from earlier tasks, and what it gives
   to later tasks.
3. **Steps:** a test-first sequence. Write a failing test, run it, make it
   pass, verify, and stop at a review checkpoint.

## Task map

| Task | Result                                                                         |
| ---- | ------------------------------------------------------------------------------ |
| 1    | Bus-definition schema and generated types                                      |
| 2    | Contracts and aliases for the five built-ins                                   |
| 3    | Normalized library, alias lookup, and mode normalization                       |
| 4    | Width resolution and conformance validation                                    |
| 5    | One runtime library for the extension and the webview                          |
| 6A   | Extension-side consumers use the canonical contracts                           |
| 6B   | Webview consumers use the canonical contracts; the hard-coded table is deleted |
| 7    | Checks at generation, import, and the explicit checker                         |
| 8    | One Issues panel                                                               |
| 9    | Contract-aware bus editor with atomic derived-width cleanup                    |
| 10   | Avalon-ST properties through `_hw.tcl` import and export                       |
| 11   | Avalon-ST endianness in symbol-sized lanes                                     |
| 12   | Avalon-ST identity and properties in custom IP-XACT                            |
| 13   | Example migration, browser tests, and enforcement                              |

## Global rules

These rules apply to all tasks:

- Use relative imports in source files. Path aliases are for tests only.
- Use camelCase in TypeScript, React, and JSON Schema. Do not add fallback
  code for other spellings of new fields.
- Keep the dependency direction:
  `types/pure utilities -> services/hooks -> components -> roots`. Parsers
  and generators must not import webview code.
- Write documents with `yaml` v2 and the path-edit helpers in
  `src/yamledit/`. Use `js-yaml` only to read, or to create a new document in
  an importer.
- Keep diagnostic paths as `readonly (string | number)[]`. A path shown as a
  string is for display only.
- Check a maximum of 256 allowed-value combinations for each constraint.
  Never check a sample of a larger domain.
- An unknown VLNV is not an error only because it has no contract. But an
  interface with `memoryMapRef` must resolve to a memory-mapped contract in
  its consumer mode.
- A known import error stops the write. An unresolved import that is
  well-formed is saved with warnings. A known or unresolved generation
  problem stops before staging and before any file output.
- Coupled IP Core edits use `updateIpCoreBatch`: one state change and one
  undo step. Do not add a Memory Map `__op`. Do not send more than one
  outbound update.
- Do not stage, commit, or push automatically. Each task ends with a review
  checkpoint for the developer.
- Before you delete a hard-coded behavior source, add and run its
  characterization tests.
- After generated types change, run `npm run generate-types` and
  `npm run compile`.
- Add `--config config/jest.config.js` to each Jest command.

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

- Gives: the generated schema types `BusDefinitionFile`,
  `BusDefinitionEntry`, `BusContract`, and `BusContractPort`.
- Gives: `BusInterface.interfaceProperties?: Record<string, number | string |
boolean>` in the generated types, the legacy webview types, and the
  generator types.
- Uses: the existing `json-schema-to-typescript` generation path and the Ajv
  test setup.

- [x] **Step 1: Write failing schema tests for the version-1 shape**

  Add Ajv test cases for:
  - a complete streaming contract;
  - a legacy definition with only `ports`;
  - malformed operations;
  - missing operands;
  - incorrect aliases;
  - empty role strings;
  - non-empty role strings that are not known roles.

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

- [x] **Step 2: Run the new schema tests and make sure that they fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts
  ```

  Expected: FAIL, because `bus_definition.schema.json` does not exist.

- [x] **Step 3: Write the discriminated JSON Schema**

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

  Rules:
  - Write each operation and each constraint kind as one `oneOf` object
    shape. Then a missing or an extra operand fails schema validation.
  - Keep `contract` optional, for legacy definitions.
  - Validate `role` only as a non-empty string. The normalizer then changes
    an unknown workspace role to `control` and reports a warning.

- [x] **Step 4: Add `interfaceProperties` to the IP-core schema and the round trip**
  1. Add an object after `portWidthOverrides`. Its values are integer,
     string, or boolean. Its description says that known contracts check its
     keys.
  2. Change the `Endianness` description. Tell the difference between byte
     lanes and Avalon-ST symbol lanes.
  3. Add this round-trip assertion:

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

- [x] **Step 5: Extend type generation and resource packages**
  1. Add `BUS_DEFINITION_SCHEMA_PATH` and `BUS_DEFINITION_OUTPUT_PATH` to
     `scripts/generate-types.js`.
  2. Call `compile(rawBusDefinition, 'BusDefinitionFile', {
additionalProperties: false })`.
  3. Copy the new schema in the webpack configuration.
  4. Add the schema to the list of required schemas in the VSIX check.
  5. Update the legacy webview types and the generator types by hand. Do not
     edit generated files by hand.

- [x] **Step 6: Generate types and verify the schema, the compile, and the package**

  Run:

  ```bash
  npm run generate-types
  npm run compile
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/SpecConformance.test.ts src/test/suite/domain/roundtrip.test.ts
  ```

  Expected: `busDefinition.types.ts` is generated, webpack compiles, and all
  listed tests pass.

- [x] **Step 7: Review checkpoint**

  Run `git diff --check`. Examine only the schema and type-generation
  changes. Do not stage the changes.

---

### Task 2: Write all five built-in contracts and their compatibility aliases

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

- Uses: the raw schema types from Task 1.
- Gives: five complete version-1 contracts. Each contract has an explicit
  canonical VLNV, aliases, `interfaceKind`, `modePolicy`, port roles, width
  policies, properties, derivations, and stable rules.

- [x] **Step 1: Write failing completeness and alias tests**

  Load all five YAML files. Assert that:
  - each built-in has a version-1 contract;
  - each port has a known, explicit role and a width policy;
  - no two aliases are the same after normalization;
  - this compatibility matrix is present:

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

  Also include these structured foreign aliases:
  - `xilinx.com:interface:avalon:*`
  - `xilinx.com:interface:avalon-mm:*`
  - `xilinx.com:interface:avalon-st:*`
  - `altera.com:interface:avalon_streaming:*`

- [x] **Step 2: Run the completeness test and make sure that it fails**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BuiltinBusContracts.test.ts
  ```

  Expected: FAIL, because the shipped definitions do not have contracts,
  complete roles, modes, or aliases.

- [x] **Step 3: Add canonical metadata and width policies**

  | Bus                             | `interfaceKind` | Producer / consumer | Mode aliases                        |
  | ------------------------------- | --------------- | ------------------- | ----------------------------------- |
  | AXI4-Lite, AXI4 Full, Avalon-MM | `memoryMapped`  | `master` / `slave`  | none                                |
  | AXI4-Stream                     | `streaming`     | `master` / `slave`  | none                                |
  | Avalon-ST                       | `streaming`     | `source` / `sink`   | `master -> source`, `slave -> sink` |

  Mark each clock, reset, data port, and byte qualifier explicitly. Mark all
  other ports as `control`.

- [x] **Step 4: Write the stable built-in rules**

  Use these rule IDs and severities:

  | Contract    | Required error rules                                                                                                           | Warning rules               |
  | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
  | AXI4-Lite   | `AXI4L_DATA_WIDTH`, `AXI4L_DATA_EQUAL`, `AXI4L_WSTRB_WIDTH`, `AXI4L_ADDRESS_EQUAL`, fixed control widths                       | none                        |
  | AXI4 Full   | `AXI4_DATA_WIDTH`, `AXI4_DATA_EQUAL`, `AXI4_WSTRB_WIDTH`, `AXI4_ID_WIDTHS`, fixed sideband widths, presence dependencies       | none                        |
  | AXI4-Stream | `AXIS_DATA_BYTE_ALIGNED`, `AXIS_TKEEP_WIDTH`, `AXIS_TSTRB_WIDTH`, fixed handshake widths                                       | `AXIS_PREFERRED_DATA_WIDTH` |
  | Avalon-MM   | `AVALON_MM_DATA_WIDTH`, `AVALON_MM_DATA_EQUAL`, `AVALON_MM_BYTEENABLE_WIDTH`, fixed controls                                   | none                        |
  | Avalon-ST   | `AVALON_ST_DATA_LAYOUT`, `AVALON_ST_EMPTY_WIDTH`, `AVALON_ST_PACKET_PORTS`, `AVALON_ST_READY_LATENCY`, `AVALON_ST_MAX_CHANNEL` | none                        |

  In Avalon-ST, declare these properties:
  - `dataBitsPerSymbol`, default `8`;
  - `symbolsPerBeat`, derived;
  - `readyLatency`, default `0`;
  - `maxChannel`, derived.

  Do not put `firstSymbolInHighOrderBits` in `interfaceProperties`.

- [x] **Step 5: Document the machine contract for people and agents**
  1. In `ipcraft-spec/docs/bus-interface-conformance.md`, add examples for
     `TDATA`/`TKEEP`, Avalon `data`/`empty`, 1-bit symbols,
     parameterization, and vendor conversion.
  2. Add a short pointer in `AGENTS.md`. Do not copy the rule tables into
     it.
  3. Link the reference from `ip_spec.md`.

- [x] **Step 6: Validate all built-ins**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/BuiltinBusContracts.test.ts
  ```

  Expected: all five definitions pass schema validation and the completeness
  test, with no warnings.

- [x] **Step 7: Review checkpoint**

  Run `git diff --check`. Compare the contract tables with the approved
  design. Examine these rules carefully:
  - AXI4-Lite data is 32 or 64 bits;
  - AXI4-Stream uses byte lanes;
  - Avalon-ST symbols can have any width.

---

### Task 3: Normalize the runtime library and map types and modes to canonical values

**Files:**

- Create: `src/shared/busContracts/types.ts`
- Create: `src/shared/busContracts/normalize.ts`
- Create: `src/shared/busContracts/canonicalize.ts`
- Create: `src/shared/busContracts/index.ts`
- Create: `src/test/suite/shared/busContractNormalize.test.ts`
- Create: `src/test/suite/shared/busContractCanonicalize.test.ts`

**Interfaces:**

- Uses: `BusDefinitionFile` from Task 1 and the definition data from Task 2.
- Gives:

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

- [x] **Step 1: Write failing normalization tests**

  Test these cases:
  - construction of the exact VLNV;
  - short aliases with extra spaces and different letter case;
  - structured aliases with a wildcard version;
  - alias collisions (errors);
  - derivation cycles;
  - references to undeclared items;
  - missing roles;
  - unknown workspace roles.

  Assert:

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

- [x] **Step 2: Run the tests and make sure that the missing exports fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractNormalize.test.ts src/test/suite/shared/busContractCanonicalize.test.ts
  ```

  Expected: FAIL, because `src/shared/busContracts/` does not exist.

- [x] **Step 3: Write the normalization**

  Convert the raw schema types into immutable normalized entries:
  - **Error, and remove the entry:** a malformed contract, conflicting
    aliases, a cycle, or an undeclared operand.
  - **Change to `control`:** a missing role or an unknown workspace role.
    Report a warning only for an explicit unknown value.
  - In the repository test, fail on each warning from a bundled built-in.

- [x] **Step 4: Write the exact type lookup and the mode normalization**

  Use this order. Do not use substring matches:

  ```ts
  const match =
    matchCanonicalVlnv(trimmed, library) ??
    matchShortAlias(trimmed.toLowerCase(), library) ??
    matchStructuredVlnv(parseVlnv(trimmed), library) ??
    null;
  ```

  - A structured alias compares the vendor, the library, and the name
    exactly. It accepts only the exact declared version or `"*"`.
  - `normalizeInterfaceMode` returns the canonical producer or consumer mode,
    or `null`. It never guesses from a protocol name.

- [x] **Step 5: Verify the pure library**

  Run the two Jest files from Step 2.

  Expected: PASS. `src/shared/busContracts/` has no imports from VS Code,
  React, the file system, the generator, or the webview.

- [x] **Step 6: Review checkpoint**

  Run:

  ```bash
  rg -n "includes\('(axi|stream|avalon)" src/shared/busContracts
  git diff --check
  ```

  Expected: no protocol substring match and no whitespace errors.

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

- Uses: the normalized contracts from Task 3 and `widthExprAst`.
- Gives:

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

- [x] **Step 1: Write failing tests for the four states and the built-in rules**

  Add `it.each` cases for each rule ID from Task 2. Include:
  - `concrete`, `symbolic`, `unresolved`, and `invalid` results;
  - correct and incorrect derived overrides;
  - fixed overrides;
  - unknown property keys;
  - mode aliases;
  - unknown VLNVs.

  Include these required examples:

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

- [x] **Step 2: Write failing tests for the domain limit and the memory-map diagnostic**
  1. Make a two-parameter domain of 16 by 16 values. Make sure that it
     checks exactly 256 combinations.
  2. Make a domain of 17 by 16 values. Make sure that it returns:

  ```ts
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE',
      state: 'unresolved',
      severity: 'warning',
    })
  );
  ```

  3. Make sure that an interface with `memoryMapRef` reports
     `BUS_MEMORY_MAP_UNSUPPORTED` at
     `['busInterfaces', index, 'memoryMapRef']` when its contract is unknown,
     streaming, or in the wrong mode.

- [x] **Step 3: Run the new resolver tests and make sure that they fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractResolve.test.ts src/test/suite/shared/busConformance.test.ts
  ```

  Expected: FAIL, because the resolver and validator exports do not exist.

- [x] **Step 4: Write expression resolution and structural proof**
  - Use `parse` and `evaluate` from `widthExprAst`.
  - Reduce constant subtrees.
  - Normalize the letter case of parameter names in the same way as the
    parameter table.
  - Compare canonical syntax trees to find structural equality.
  - Do not use `eval`, regular-expression arithmetic, or algebraic guesses.
  - A relation is `symbolic` only when the normalized syntax tree proves it.

- [x] **Step 5: Write active ports, property defaults, and derivations**

  Resolve values in the approved order:
  1. declared width;
  2. explicit override;
  3. parameter expression;
  4. property defaults and derivations;
  5. derived width;
  6. presence constraints.

  Calculate missing legacy Avalon-ST values as follows:

  ```ts
  symbolsPerBeat = dataWidth % dataBitsPerSymbol === 0 ? dataWidth / dataBitsPerSymbol : unresolved;
  maxChannel = 2 ** channelWidth - 1;
  emptyWidth = Math.ceil(Math.log2(symbolsPerBeat));
  ```

  Reject widths that are zero, negative, fractional, or too large.

- [x] **Step 6: Write the limited constraint evaluation and the diagnostics**

  For each constraint:
  1. Find only the parameters that the constraint uses.
  2. Make all combinations of their values.
  3. If there are more than 256 combinations, stop before the evaluation.
  4. Otherwise, check the defaults and each declared combination.

  An unknown `interfaceProperties` key is an error only when a contract was
  found.

- [x] **Step 7: Keep `interfaceProperties` in domain normalization**

  Read only the canonical `interfaceProperties` into the normalized bus
  interfaces. Do not change unknown keys. Add a round-trip test. Make sure
  that the test proves that no property map is lost, and that no map is added
  when it is not present.

- [x] **Step 8: Verify the resolver**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractResolve.test.ts src/test/suite/shared/busConformance.test.ts src/test/suite/domain/roundtrip.test.ts
  ```

  Expected: the four states, the 256 limit, the five built-in rule tables,
  and the structured paths pass.

- [x] **Step 9: Review checkpoint**

  Run `git diff --check`. Make sure that the pure modules do not import
  `vscode`, React, components, or generator templates.

---

### Task 5: Load and send one normalized runtime contract library

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

- Uses: `normalizeBusLibrary` from Task 3.
- Gives: `ResolvedImports.busLibrary?: NormalizedBusLibrary` and
  `ResolverInput.busLibrary: NormalizedBusLibrary` on both sides of the
  process boundary.
- Gives: a deterministic precedence, from lowest to highest:
  `built-in < workspace < configured user < per-IP useBusLibrary`. The
  precedence uses the exact definition key and canonical VLNV.

- [x] **Step 1: Write failing service tests for normalization and diagnostics**

  Change the fixtures to contain complete raw definition objects. Assert
  that:
  - a malformed bundled contract throws an error;
  - a malformed workspace contract is removed, and its source path is
    reported;
  - an unknown workspace role stays, with a warning;
  - a later source always wins over an earlier source.

- [x] **Step 2: Run the service tests and make sure that the raw-record expectations fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusLibraryService.test.ts src/test/suite/services/ImportResolver.test.ts
  ```

  Expected: FAIL, until the services return the normalized runtime shape.

- [x] **Step 3: Keep the source identity when you load files**

  Replace the anonymous `Object.assign` merge with an ordered list of
  `BusDefinitionSource` entries:

  ```ts
  const source: BusDefinitionSource = {
    sourceFile: filePath,
    sourceKind,
    definitions: parsed,
  };
  ```

  1. Parse each file with `js-yaml`.
  2. Validate each file with the packaged schema.
  3. Normalize all files one time.
  4. Cache the resulting serializable `NormalizedBusLibrary`.

- [x] **Step 4: Send the normalized library to the webview**
  1. Change the message and import types from `Record<string, unknown>` to
     `NormalizedBusLibrary`.
  2. Do not change the update messages or the revision filter, except for
     the payload type.
  3. Add a provider test that examines the posted update message.

- [x] **Step 5: Give the same library to the generator resolver input**

  Make `IpCoreScaffolder.ensureBusDefinitions` collect all sources first,
  including per-IP definitions. Keep the normalized contracts and the raw
  port data in one `NormalizedBusLibrary`. Do not load or normalize the
  library again for each resolver.

- [x] **Step 6: Verify the load and the transport**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusLibraryService.test.ts src/test/suite/services/ImportResolver.test.ts src/test/suite/services/IpCoreEditorProvider.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts
  npm run compile
  ```

  Expected: the normalized contracts and the load diagnostics reach the
  generator and the webview. There are no broad contexts and no imports in
  the wrong layer direction.

- [x] **Step 7: Review checkpoint**

  Run `git diff --check`. Examine the extension message and the webview
  message together, for protocol compatibility.

---

### Task 6A: Use canonical contracts in shared and extension-side consumers

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

- Uses: `canonicalizeBusType`, `normalizeInterfaceMode`, the normalized port
  definitions, and the runtime library from Task 5.
- Gives:
  - shared and extension-side consumers that receive a
    `NormalizedBusLibrary` as a parameter;
  - an exact template registry with canonical VLNV keys.
- After this task, no shared, parser, or generator module imports webview
  code. None of them owns aliases, modes, roles, or the memory-mapped
  classification.

- [x] **Step 1: Add the shared characterization test before you change the lookup**
  1. Keep the legacy port expectations as data in the test.
  2. Assert that the old hard-coded lookup and the normalized built-ins
     agree for each shared port: name, direction, presence, role, and width.
  3. Record the known Avalon-MM differences as explicit expected changes.
  4. Add one alias table that combines all four current sources:
     `busVlnv.test.ts`, `busDefinitions.test.ts`, each `lookupBusDef`
     branch, and `src/generator/buses/builtin.ts`.
  5. Assert that each spelling resolves to the same canonical contract and
     `interfaceKind`.

- [x] **Step 2: Run the characterization tests against the old tables**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/webview/busDefinitions.test.ts src/test/suite/shared/busVlnv.test.ts src/test/suite/generator/resolvers/busRegistry.test.ts
  ```

  Expected: PASS before you change any production lookup path. The
  expectations stay in the test after Task 6B deletes the hard-coded module.

- [x] **Step 3: Replace the memory-map and mode checks**

  Change these functions to use a canonical match:
  - `busSupportsMemoryMap`;
  - `busSupportsInterruptAssociation`;
  - `getBusTypeForTemplate`;
  - `hasMemoryMappedSlaveInterface`;
  - address resolution and interrupt resolution.

  Each one calls:

  ```ts
  const eligible =
    match.contract.interfaceKind === 'memoryMapped' &&
    normalizeInterfaceMode(match.contract, iface.mode) === match.contract.modePolicy.consumer &&
    (iface.array?.count === undefined || iface.array.count <= 1);
  ```

  Remove the literal `slave` tests from `addressing.ts` and
  `registerProcessor.ts`. Keep the generator template selection separate,
  with the exact canonical VLNV as the key.

- [x] **Step 4: Migrate the parser, the checker, the generator, and the shared utilities**
  1. Add a `NormalizedBusLibrary` parameter to each pure parser or helper
     that needs a protocol lookup.
  2. Change the command, provider, and service callers to give the loaded
     library.
  3. Remove the imports from `src/webview/` in `HwTclParser`,
     `ComponentXmlParser`, `hdlCrossCheck`, and `busPortNameSet`.
  4. Add direct tests. Make sure that `busPortNameSet` uses canonical ports
     and keeps the physical ports of a custom interface with no contract.

- [x] **Step 5: Remove extension-side alias and classification ownership**
  - Remove the alias arrays and `isMemoryMapped` from the generator
    registry.
  - Keep only the exact canonical template-provider map that the Nunjucks
    packs need.
  - Keep `src/webview/ipcore/data/busDefinitions.ts` until Task 6B. For now,
    it is the characterized adapter of the webview.

- [x] **Step 6: Verify the extension-side change and the dependency direction**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/shared/busPortNameSet.test.ts src/test/suite/shared/busVlnv.test.ts src/test/suite/generator/resolvers/busRegistry.test.ts src/test/suite/generator/registerProcessor.test.ts src/test/suite/generator/resolvers/addressing.test.ts src/test/suite/generator/validation/hdlCrossCheck.test.ts src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts src/test/suite/parser/ComponentXmlParser.test.ts
  rg -n "webview/ipcore/data/busDefinitions|includes\('(axi|stream|avalon)|mode.*slave" src/parser src/generator src/shared
  npm run compile
  ```

  Expected:
  - the tests pass;
  - no shared, parser, or generator file imports from the webview;
  - these layers have no protocol substring test and no literal consumer
    test.

  If `rg` finds a `slave` that is not related, examine it manually. Do not
  delete it automatically.

- [x] **Step 7: Review checkpoint**

  Run `git diff --check`. Review the extension-side behavior and the layer
  fix as one unit. Do not change the hard-coded webview table and its
  consumers. Task 6B changes them.

---

### Task 6B: Migrate the webview consumers and delete the hard-coded table

**Files:**

- Modify: `src/test/suite/shared/busContractMigration.characterization.test.ts`
- Delete (after its cases move to the characterization test):
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
- Delete (after the characterization passes):
  `src/webview/ipcore/data/busDefinitions.ts`

**Interfaces:**

- Uses: the `NormalizedBusLibrary` that Task 5 sends to the webview, and the
  legacy expectations in the test from Task 6A.
- Gives: narrow canonical lookup props for the grouping, validation, canvas,
  and Inspector consumers. After this task, the webview has no protocol
  table that copies `ipcraft-spec`.

- [x] **Step 1: Run the shared characterization test again before you change the webview**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/webview/busDefinitions.test.ts
  ```

  Expected: PASS, with the hard-coded table still present.

- [x] **Step 2: Write failing webview regression tests**

  Extend `useCanvasValidation.test.ts` and add
  `bus-contract-library.spec.ts`:
  1. Give the normalized library with AXI4-Stream and Avalon-MM interfaces.
  2. Assert that grouping and Inspector metadata use canonical roles.
  3. Expand Avalon-MM. Assert that `clk` and `reset` are optional, and that
     the port list is the canonical YAML port list.
  4. Assert that a selection of a bundle or a subport still opens the
     correct Inspector field and gives it the focus.

- [x] **Step 3: Run the new UI tests and make sure that the canonical Avalon-MM expectations fail**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/useCanvasValidation.test.ts
  npm run test:browser -- src/test/browser/bus-contract-library.spec.ts
  ```

  Expected: FAIL, because the webview still uses the hard-coded Avalon-MM
  table.

- [x] **Step 4: Migrate each webview consumer through narrow props**
  1. In `IpCoreApp`, make lookup adapters from the received
     `NormalizedBusLibrary`.
  2. Give only the library, or focused lookup callbacks, to the consumers
     that need them.
  3. Replace the two fields `role` and `endianRole` with the one normalized
     `role`.
  4. Keep `IpCoreApp` and `IpBlockCanvas` for composition only.
  5. Keep the selection, grouping, optional-port toggle, and Inspector focus
     behavior.

- [x] **Step 5: Delete the hard-coded table after both tests pass**
  1. Move the permanent alias and port cases from `busDefinitions.test.ts`
     into the expectations in
     `busContractMigration.characterization.test.ts`.
  2. Remove the import of the old module from that test.
  3. Delete `busDefinitions.test.ts` and `busDefinitions.ts`.

  Do not delete a legacy expectation only because the new canonical
  Avalon-MM value is different. Keep each intentional change named in the
  characterization fixture.

- [x] **Step 6: Verify the webview change and the visible canvas behavior**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busContractMigration.characterization.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx src/test/suite/components/CanvasInspector.BusInterfaceMatrix.test.tsx
  npm run test:browser -- src/test/browser/bus-contract-library.spec.ts src/test/browser/bus-interface-matrix-select.spec.ts src/test/browser/subport-click-toggle.spec.ts
  rg -n "webview/ipcore/data/busDefinitions|from .*data/busDefinitions" src
  npm run compile
  ```

  Expected:
  - the unit tests and the browser tests pass;
  - no production file or test file refers to the deleted module;
  - the browser assertions show the intentional Avalon-MM canvas changes
    separately from the extension-side change.

- [x] **Step 7: Review checkpoint**

  Run `git diff --check`. Review only the webview migration, the deleted
  table, the kept characterization expectations, and the intentional canvas
  changes.

---

### Task 7: Enforce conformance in generation, imports, and the explicit checker

> **Later change:** the policy module is `src/shared/busConformance.ts`, and
> its tests are in `src/test/suite/shared/busConformance.test.ts`. Callers
> use it directly. The `BusConformanceService` adapter below was temporary
> and does not exist in the final code.

**Files:**

- Create: `src/shared/issues.ts`
- Create: `src/services/BusConformanceService.ts` (see the later change)
- Modify: `src/generator/IpCoreScaffolder.ts`
- Modify: `src/generator/loadIpCore.ts`
- Modify: `src/services/GenerationEngine.ts`
- Modify: `src/providers/IpCoreGenerateHandler.ts`
- Modify: `src/commands/ConsistencyCheckCommands.ts`
- Modify: `src/commands/ImportCommands.ts`
- Modify: `src/providers/IpCoreSourcePreviewProvider.ts`
- Modify: `src/shared/messages/ipCore.ts`
- Modify: `src/webview/ipcore/types/messages.ts`
- Create: `src/test/suite/services/BusConformanceService.test.ts` (see the
  later change)
- Test: `src/test/suite/generator/IpCoreScaffolder.test.ts`
- Test: `src/test/suite/services/GenerationEngine.test.ts`
- Test: `src/test/suite/commands/ConsistencyCheckCommands.test.ts`
- Create: `src/test/suite/commands/ImportCommands.test.ts`
- Create: `src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts`

**Interfaces:**

- Uses: `validateBusInterfaces` and the runtime library.
- Gives:

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

- [x] **Step 1: Write the enforcement-table tests before you add the checks**

  Test these exact decisions:

  | Boundary              | Known error |         Unresolved | Warning |
  | --------------------- | ----------: | -----------------: | ------: |
  | Save edited `.ip.yml` |       allow |              allow |   allow |
  | Save import result    |       block | allow with warning |   allow |
  | Generate/export       |       block |              block |   allow |
  | Explicit checker      |        fail |               fail |  report |

  Assert that an unknown alias with `memoryMapRef` gives
  `BUS_MEMORY_MAP_UNSUPPORTED`, and stops before `generateAll` makes a
  staging result.

- [x] **Step 2: Run the tests and make sure that no check exists**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusConformanceService.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts src/test/suite/services/GenerationEngine.test.ts
  ```

  Expected: FAIL, because generation continues after schema validation.

- [x] **Step 3: Write one policy adapter and the issue conversion**
  - Keep the policy out of the pure resolver.
  - Convert each `BusConformanceDiagnostic` to an `IpcraftIssue` with
    `source: 'protocol'`.
  - Export explicit decision functions:

  ```ts
  export const blocksGeneration = (report: ConformanceReport): boolean =>
    report.hasKnownErrors || report.hasUnresolved;

  export const blocksImportWrite = (report: ConformanceReport): boolean => report.hasKnownErrors;
  ```

- [x] **Step 4: Stop the scaffolder before memory-map and template resolution**

  In `generateAll`:
  1. Complete the merge of the runtime bus library.
  2. Validate the loaded IP.
  3. If a check fails, return a failure with structured issues. Do this
     before `resolveMemoryMaps`, `buildTemplateContext`, the dry-run staging,
     and any file output.

  Make sure that `GenerationEngine` and `IpCoreGenerateHandler` send the
  issues in `generateResult`. They must not change the issues into one
  string.

- [x] **Step 5: Add the protocol results to the explicit checker**
  1. Run the conformance check before the HDL and vendor cross-checks.
  2. Convert the existing findings into `IpcraftIssue`.
  3. Return one ordered issue list.
  4. Remove duplicates with the key
     `code + JSON.stringify(path) + source`. Do not parse dotted paths.

- [x] **Step 6: Check command imports and preview saves**
  1. Parse the proposed YAML in memory.
  2. Load the same runtime contract library for the source directory.
  3. Apply the import policy before the call to `writeImportedFile`:
     - **Known error:** show the diagnostics. Do not write the `.ip.yml`
       file or the related `.mm.yml` file.
     - **Unresolved:** write the files and show warnings.
  4. Put the report in the preview messages. The webview can then disable
     Save without a second protocol implementation.

- [x] **Step 7: Make sure that no path writes partial output**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusConformanceService.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts src/test/suite/services/GenerationEngine.test.ts src/test/suite/commands/ConsistencyCheckCommands.test.ts src/test/suite/commands/ImportCommands.test.ts src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts
  ```

  Expected:
  - the tests for known-incorrect import and generation assert zero write
    calls;
  - the unresolved-import test asserts one atomic IP write and one warning;
  - generation stays blocked.

- [x] **Step 8: Review checkpoint**

  Run `git diff --check`. Examine each call to `writeImportedFile`,
  `generateAll`, and staging creation. Make sure that validation comes
  before each change to files.

---

### Task 8: Replace the separate validation UIs with one Issues panel

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

- Uses: the structured `IpcraftIssue[]` from Task 7, and the immediate
  local schema, reference, and protocol issues.
- Gives:

  ```ts
  export interface IssueFocusRequest {
    path: readonly (string | number)[];
    nonce: number;
  }

  export function issueKey(issue: IpcraftIssue): string;
  export function issuesToCanvasAnnotations(issues: readonly IpcraftIssue[]): CanvasAnnotations;
  ```

- [x] **Step 1: Write failing projection and panel tests**

  Assert that:
  - the protocol path `['busInterfaces', 1]` maps to `bus:1`;
  - the path `['busInterfaces', 1, 'portWidthOverrides', 'empty']` maps to
    `bus:1` and to the logical subport `empty`;
  - the groups are in this order: `Schema`, `Protocol`, `References`,
    `HDL consistency`, `Vendor artifact consistency`;
  - issues with the same key become one issue;
  - the error count and the warning count stay separate.

- [x] **Step 2: Run the UI tests and make sure that the Issues components do not exist**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/issues.test.ts src/test/suite/components/IssuesPanel.test.tsx
  ```

  Expected: FAIL, because the module and the components do not exist.

- [x] **Step 3: Write the pure UI issue adapters**
  1. Keep source paths as arrays.
  2. Convert the existing reference errors and consistency findings one time,
     at their boundary.
  3. Merge them with the immediate protocol results.
  4. Remove duplicates with this key:

  ```ts
  export const issueKey = (issue: IpcraftIssue): string =>
    `${issue.source}|${issue.code}|${JSON.stringify(issue.path)}`;
  ```

- [x] **Step 4: Build the Issues panel and its selection behavior**
  1. Replace the footer `Reference Validation Errors` and the separate
     consistency overlay with `IssuesPanel`.
  2. When the user clicks a row:
     1. close the other overlays;
     2. select the canvas element;
     3. expand the bus, if necessary;
     4. publish an `IssueFocusRequest`.
  3. The staging overlay keeps its priority. The Issues panel uses the right
     panel when the user opens it, or when generation is blocked.

- [x] **Step 5: Add toolbar counts and the blocked-generation behavior**
  - Show the error count and the warning count separately.
  - If `generateResult.success === false` and the result contains issues,
    open the panel. Give the focus to the first error. If there is no error,
    give the focus to the first warning.
  - Automatic consistency checks stay silent. They update the counts, but do
    not open the panel.

- [x] **Step 6: Mark bundles and logical subports from the same issues**
  1. Remove the protocol-specific warning code from `useCanvasValidation`,
     because the shared validator now supplies these warnings.
  2. Merge the issue annotations with the remaining local structural
     annotations.
  3. Keep the existing canvas dot and tooltip display.

- [x] **Step 7: Control the import-preview Save button in the shell**
  1. Add the props `importSaveBlocked` and `onOpenIssues`.
  2. Disable `Save as .ip.yml` only for known errors.
  3. For unresolved warnings, keep Save enabled and add an accessible title
     that explains the warning state.

- [x] **Step 8: Verify the unified UI**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/issues.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/IssuesPanel.test.tsx src/test/suite/components/IpCoreToolbar.test.tsx src/test/suite/components/IpCoreShell.test.tsx
  npm run compile
  ```

  Expected: one issue model controls the counts, the panel rows, the canvas
  markers, the preview Save state, and the focus after blocked generation.

- [x] **Step 9: Review checkpoint**

  Run `git diff --check`. Make sure that `IpCoreApp`, `IpCoreShell`, and
  `IpBlockCanvas` stay focused on composition. The issue conversion must be
  in the hook and type modules.

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

- Uses: `BusInterfaceResolution`, the contract metadata,
  `IssueFocusRequest`, and the existing `BatchUpdate`.
- Gives:

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

- [x] **Step 1: Write failing editor-model tests**

  For AXI4-Stream, assert that:
  - `TDATA` is editable;
  - `TKEEP` is read-only and shows `TDATA / 8 = 8`;
  - a change of `TDATA` from 32 to 64 gives one batch:

  ```ts
  expect(mutations).toEqual([
    [['busInterfaces', 0, 'portWidthOverrides', 'TDATA'], 64],
    [['busInterfaces', 0, 'portWidthOverrides', 'TKEEP'], undefined],
    [['busInterfaces', 0, 'portWidthOverrides', 'TSTRB'], undefined],
  ]);
  ```

  Also assert that a load alone keeps the correct explicit derived
  overrides.

- [x] **Step 2: Run the tests and make sure that no contract editor exists**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/useBusContractEditor.test.ts src/test/suite/components/CanvasInspector.BusContractFields.test.tsx
  ```

  Expected: FAIL, because the editor model and the component do not exist.

- [x] **Step 3: Write the pure edit model and the deterministic mutations**

  Make the fields from the width policies and the property declarations.
  When the user edits a root width:
  - always delete each explicit derived override that depends on it;
  - never write a new redundant number into a derived override;
  - never add a derived value that the document does not contain.

- [x] **Step 4: Show root, property, derived, and fixed fields**
  - Use the existing Inspector controls.
  - For derived fields, show the formula and the effective value.
  - For an editable field with an incorrect value, show the expected and the
    actual value.
  - Do not add an edit handler to derived or fixed values.
  - Show the Avalon-ST fields `dataBitsPerSymbol`, `symbolsPerBeat`,
    `readyLatency`, and `maxChannel` under **Configuration**.

- [x] **Step 5: Apply coupled edits with `updateIpCoreBatch`**
  1. Connect `BusContractFields` to the existing `batchUpdateIpCore`
     callback in `IpCoreApp`.
  2. Add a state test. Make sure that the mutation batch causes one
     `pushUndo`, one state change, and one debounced outbound update.

- [x] **Step 6: Give the focus to Inspector fields from issue paths**
  1. Map the last path segments to stable field IDs, for example
     `bus-0-property-dataBitsPerSymbol` and `bus-0-width-TDATA`.
  2. When `IssueFocusRequest.nonce` changes, wait until the selected
     Inspector is shown. Then call `focus()` and `scrollIntoView({ block:
'nearest' })`.

- [x] **Step 7: Verify the editor behavior**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/webview/useBusContractEditor.test.ts src/test/suite/webview/useIpCoreState.test.ts src/test/suite/components/CanvasInspector.BusContractFields.test.tsx src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx
  ```

  Expected: root edits are atomic, derived overrides are deleted in a
  deterministic way, and the issue focus reaches the correct field.

- [x] **Step 8: Review checkpoint**

  Run `git diff --check`. Examine the YAML mutation paths. Make sure that
  there is no `sendUpdate` loop and no new `__op`.

---

### Task 10: Keep Avalon-ST properties through `_hw.tcl` import and export

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

- Uses: the canonical contract lookup and the resolved Avalon-ST properties.
- Gives:
  - parser output with the canonical `mode: source | sink`, `endianness`,
    and `interfaceProperties`;
  - a template context with an ordered property list.

- [x] **Step 1: Write failing parser tests for the current and the legacy spellings**

  Parse this fixture:

  ```tcl
  add_interface stream avalon_streaming start
  set_interface_property stream dataBitsPerSymbol 1
  set_interface_property stream symbolsPerBeat 5
  set_interface_property stream readyLatency 0
  set_interface_property stream firstSymbolInHighOrderBits true
  add_interface_port stream stream_data data Output 5
  ```

  Expected result:
  - `mode: source`;
  - `endianness: big`;
  - `interfaceProperties: { dataBitsPerSymbol: 1, symbolsPerBeat: 5,
readyLatency: 0 }`.

  Do the same test with the legacy name `bitsPerSymbol`. Add a conflict
  test: both names are present with different values, and the parser returns
  an error with the source location.

- [x] **Step 2: Run the parser tests and make sure that the properties are lost now**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts
  ```

  Expected: FAIL, because `interfaceProperties` and the canonical streaming
  mode are missing.

- [x] **Step 3: Write the contract-based property import**
  1. Remove the webview lookup dependency, if it still exists.
  2. Read only the properties that the matched contract declares.
  3. Convert declared integer and boolean values to their types.
  4. Map `bitsPerSymbol` to `dataBitsPerSymbol`.
  5. Map `firstSymbolInHighOrderBits` only to `endianness`.
  6. Calculate a missing `symbolsPerBeat` only when the data width divides
     by the symbol width with no remainder.

- [x] **Step 4: Write the canonical properties into Platform Designer Tcl**

  Give the resolved properties to the template as an ordered array, and
  write them:

  ```jinja2
  {% for prop in iface.interface_properties %}
  set_interface_property {{ iface.name }} {{ prop.name }} {{ prop.tcl_value }}
  {% endfor %}
  set_interface_property {{ iface.name }} firstSymbolInHighOrderBits {% if iface.endianness == 'big' %}true{% else %}false{% endif %}
  ```

  Do not write `bitsPerSymbol`. Keep symbolic parameter references in Tcl
  form where Tcl supports them.

- [x] **Step 5: Add a round-trip test for 1-bit symbols**

  Do this sequence: import `_hw.tcl` -> write `.ip.yml` -> generate
  `_hw.tcl` again -> import again. Assert that these values do not change:
  `data=5`, `dataBitsPerSymbol=1`, `symbolsPerBeat=5`, `readyLatency=0`,
  and `endianness=big`.

- [x] **Step 6: Verify the parser, the generator, and the snapshots**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts src/test/suite/generator/resolvers/bus.test.ts
  npm run test:integration:snapshots -- --runInBand
  ```

  Expected: the unit tests and the snapshot tests pass. The output uses only
  the current property names.

- [x] **Step 7: Review checkpoint**

  Run `git diff --check`. Make sure that `firstSymbolInHighOrderBits` never
  appears as an `interfaceProperties` key in `.ip.yml`.

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
- Do not change: `src/webview/ipcore/utils/portEndianness.ts`
- Modify: `src/test/suite/generator/resolvers/bus.test.ts`
- Modify: `src/test/suite/webview/useCanvasValidation.test.ts`
- Modify: `src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx`
- Modify: `src/test/integration/endianness.test.ts`

**Interfaces:**

- Uses: the resolved `dataBitsPerSymbol` and the normalized port roles.
- Gives: template entries with explicit lane data:

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

- [x] **Step 1: Write failing resolver and UI tests for a 5-bit stream**

  Resolve a big-endian Avalon-ST source with `data=5`,
  `dataBitsPerSymbol=1`, and `symbolsPerBeat=5`. Assert that:
  - its data port has `swap_kind: 'lane'`, `lane_width: 1`, and
    `needs_swap: true`;
  - the webview validation shows no multiple-of-8 warning;
  - the bus endianness selector is enabled.

  Keep the existing warning and the disabled selector for a 5-bit
  standalone port.

- [x] **Step 2: Run the tests and make sure that the byte-only behavior fails**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/resolvers/bus.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx
  ```

  Expected: FAIL, because `needsByteSwap` rejects the width 5.

- [x] **Step 3: Replace the byte-only bus swap data**

  | Port                  | `lane_width`                   |
  | --------------------- | ------------------------------ |
  | Standalone port       | 8                              |
  | AXI or Avalon-MM data | 8                              |
  | Avalon-ST data        | resolved `dataBitsPerSymbol`   |
  | Byte qualifier        | 1 (one bit for each data lane) |

  A lane swap needs `width % laneWidth === 0` and more than one lane.

- [x] **Step 4: Write generic lane-reversal loops**

  In the two top-level templates, map destination lane `i` to source lane
  `laneCount - 1 - i`, with `lane_width` as the lane size.
  - The fixed and the parameterized forms must not contain a `/ 8`
    assertion for symbol-lane swaps.
  - Keep the generated `swap_bytes_<width>` functions only for fixed swaps
    with 8-bit lanes, if they are simpler than the generic loop.

  > **Later fix:** the templates call `swap_bytes_<width>` for every fixed
  > lane swap with a lane width of 8, also for 8-bit Avalon-ST symbols. The
  > resolver must declare the function for the same set of ports. Commit
  > `2ecd467` makes the resolver use the same rule as the templates, and adds
  > a GHDL/Icarus compile test for a big-endian Avalon-ST stream with 8-bit
  > symbols.

- [x] **Step 5: Extend the template-context schema and generate the types again**
  1. Replace the byte/bit enum with lane/bit.
  2. Make `lane_width` required for lane swaps.
  3. Update the descriptions.
  4. Run the type generation. Fix the compile errors. Do not edit
     `templateContext.types.ts` by hand.

- [x] **Step 6: Add VHDL and SystemVerilog integration fixtures**

  Add the 5-bit stream to `src/test/integration/endianness.test.ts`. Assert
  that the generated RTL:
  - has five lane assignments in reverse order;
  - has no multiple-of-8 check for that port;
  - compiles or elaborates with the GHDL and Icarus tools that the suite
    uses.

- [x] **Step 7: Verify the endianness behavior**

  Run:

  ```bash
  npm run generate-types
  npm run compile
  npx jest --config config/jest.config.js src/test/suite/generator/resolvers/bus.test.ts src/test/suite/webview/useCanvasValidation.test.ts src/test/suite/components/CanvasInspector.ConduitPanel.test.tsx
  npx jest --config config/jest.integration.js src/test/integration/endianness.test.ts --runInBand
  ```

- [x] **Step 8: Review checkpoint**

  Run `git diff --check`. Make sure that `portEndianness.ts` still uses
  bytes, and that only contract-resolved bus data uses symbol lanes.

---

### Task 12: Keep Avalon-ST identity and properties in custom IP-XACT

> **Later change:** the IPCraft vendor extension copies only the properties
> that the user wrote in `interfaceProperties`. The standard IP-XACT
> parameters still contain the resolved values. Step 5 below describes the
> first version, which copied the complete property map.

**Files:**

- Modify: `src/generator/VivadoComponentXmlGenerator.ts`
- Modify: `src/generator/templates/amd_component_xml.j2`
- Modify: `src/generator/VivadoBusDefInstaller.ts`
- Modify: `src/parser/ComponentXmlParser.ts`
- Modify: `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts`
- Modify: `src/test/suite/parser/ComponentXmlParser.test.ts`
- Modify: `src/test/integration/roundtrip.test.ts`

**Interfaces:**

- Uses: the canonical Avalon-ST contract, the resolved properties, and the
  existing custom bus-definition and abstraction-definition generation.
- Gives: standard IP-XACT bus-interface parameters, and IPCraft vendor data
  with a fixed format in the namespace `urn:ipcraft:interface-contract:1`.

- [x] **Step 1: Write failing custom Avalon-ST export tests**

  Generate `component.xml` for the 5-bit stream with 1-bit symbols. Assert:

  ```ts
  expect(xml).toContain('spirit:vendor="ipcraft"');
  expect(xml).toContain('spirit:name="avalon_st"');
  expect(xml).not.toContain('spirit:name="axis"');
  expect(xml).toContain('xmlns:ipcraft="urn:ipcraft:interface-contract:1"');
  expect(xml).toContain('<ipcraft:property name="dataBitsPerSymbol" value="1"');
  expect(xml).toContain('<ipcraft:property name="symbolsPerBeat" value="5"');
  ```

  Also assert that:
  - the bundled bus-definition and abstraction-definition files are
    generated;
  - the physical ports are not padded;
  - the physical ports are not given AXI4-Stream names.

- [x] **Step 2: Write failing import and conflict tests**
  1. Parse the exported XML. Assert that the canonical properties and the
     endianness come back.
  2. Add a fixture where a standard IP-XACT property is different from the
     IPCraft copy. Assert a blocking diagnostic. The parser must not select
     one of the two values.

- [x] **Step 3: Run the XML tests and make sure that the metadata is missing**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/parser/ComponentXmlParser.test.ts
  ```

  Expected: FAIL, because the parameters or the vendor extension are
  missing, or the interface identity is incorrect.

- [x] **Step 4: Extend the custom bus file generation**
  - Treat canonical Avalon-ST as a custom bus for AMD packages, although it
    is a built-in IPCraft contract.
  - Generate its bus definition and abstraction definition one time for each
    VLNV.
  - Set the IP-XACT addressability from `interfaceKind`, not from the bus
    name.

- [x] **Step 5: Write the standard properties and the IPCraft copy**
  1. Sort the canonical property names alphabetically.
  2. Write standard bus-interface parameters where the IP-XACT writer
     supports them. Write `firstSymbolInHighOrderBits` from `endianness`.
  3. Write a copy of the contract version, the canonical `endianness`, and
     the properties in this format (see the later change above):

  ```xml
  <ipcraft:interfaceContract version="1">
    <ipcraft:property name="dataBitsPerSymbol" value="1"/>
    <ipcraft:property name="endianness" value="big"/>
    <ipcraft:property name="symbolsPerBeat" value="5"/>
  </ipcraft:interfaceContract>
  ```

- [x] **Step 6: Import the standard parameters and check the copy**
  1. Map the standard `firstSymbolInHighOrderBits` back to the canonical
     `endianness`.
  2. Map the standard property parameters to `interfaceProperties`.
  3. Use the IPCraft copy to recover parameters that a tool removed.
  4. If the standard parameters and the copy do not agree, report a known
     error with the XML source location.

- [x] **Step 7: Add a full XML round-trip test**

  Extend `roundtrip.test.ts` with this sequence:

  ```text
  .ip.yml Avalon-ST -> component.xml + custom bus files -> parsed .ip.yml
  ```

  Assert that the VLNV, the mode, the data width, the symbol properties,
  the ready latency, the maximum channel, and the endianness do not change.

- [x] **Step 8: Verify the IP-XACT output and the import**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/parser/ComponentXmlParser.test.ts
  npx jest --config config/jest.integration.js src/test/integration/roundtrip.test.ts --runInBand
  ```

  Expected: custom Avalon-ST stays custom, the round trip loses no data, and
  the interface never appears as AXI4-Stream.

- [x] **Step 9: Review checkpoint**

  Run `git diff --check`. Examine the XML order in the snapshots. Make sure
  that the output contains only one canonical metadata format.

---

### Task 13: Migrate examples, complete browser tests, and start enforcement

**Files:**

- Modify (when diagnostics require it): `ipcraft-spec/examples/**/*.ip.yml`
- Modify: `ipcraft-spec/examples/comprehensive_avalon/comprehensive_avalon.ip.yml`
- Modify: `ipcraft-spec/examples/comprehensive_avalon/README.md`
- Modify: `ipcraft-spec/examples/comprehensive_axi/README.md`
- Modify: `CHANGELOG.md`
- Modify or create: `src/test/suite/services/AllExamplesConformance.test.ts`
- Modify or create: `src/test/browser/ipcore-issues.spec.ts`
- Modify: the documentation and snapshot fixtures that the canonical modes
  and ports change

**Interfaces:**

- Uses: the complete validator, UI, importer, and generator behavior from
  Tasks 1-12.
- Gives: enforcement for all shipped examples, and end-to-end proof of the
  user workflow.

- [x] **Step 1: Add an audit test for all examples before you change fixtures**
  1. Load each shipped `.ip.yml` file recursively.
  2. Resolve its effective bus library.
  3. Print the diagnostics, grouped by file.
  4. Fail on known errors and on unresolved generation constraints.
  5. Assert that the legacy comprehensive Avalon channel resolves to
     `maxChannel: 3`, and that the test does not change the YAML.

- [x] **Step 2: Run the audit and record each intentional migration**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/AllExamplesConformance.test.ts
  ```

  Expected: each failure gives an exact array path. Change only the
  examples that the contract proves incorrect. Do not change unrelated
  formatting.

- [x] **Step 3: Update the examples and the documentation on purpose**
  1. Add explicit Avalon-ST properties where the legacy calculation is
     ambiguous.
  2. Change new and example streaming modes to `source`/`sink`.
  3. Correct incorrect derived overrides.
  4. In `CHANGELOG.md`, document these visible changes:
     - the Avalon-MM canvas port list and optional ports;
     - the Avalon-ST lane order in generated RTL.

- [x] **Step 4: Add browser tests for the complete error workflow**
  1. Give incorrect AXI4-Stream YAML through `window.__RENDER__`.
  2. Assert these results:
     - the canvas bundle marker;
     - the subport marker;
     - the toolbar error count;
     - the issue in the Protocol group;
     - the selection and focus after a click on the issue;
     - the panel behavior after blocked generation.
  3. Add an unresolved import-preview test. Assert that Save stays enabled
     and shows a warning.

- [x] **Step 5: Run the complete test matrix**

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

  Expected:
  - no compile, type, or lint errors;
  - all unit and browser tests pass;
  - the HDL and vendor integration tests pass, or report only the tool-skip
    condition that the repository defines.

- [x] **Step 6: Run the regression checks for the full repository**

  Run:

  ```bash
  npm run test:unit
  git diff --check
  git status --short
  ```

  Expected: the unit tests pass, there are no whitespace errors, and the
  status shows only intentional source, schema, generated-type,
  documentation, fixture, and snapshot changes.

- [x] **Step 7: Final review checkpoint**

  Show the full diff and the verification output to the developer. Do not
  stage, commit, or push. The developer decides the integration and the
  commit boundaries.
