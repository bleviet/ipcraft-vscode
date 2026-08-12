# Bus Interface Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed audit defects while preserving vendor behavior,
authored document state, and the existing V-3/V-4 revision protocol.

**Architecture:** Vendor parsers adapt XML/Tcl syntax into pure bus-contract
inputs. Shared contract modules own reusable reconciliation, typed metadata,
and declarative-contract policy. Vendor generators emit resolved standard
metadata for tools and authored-only IPCraft mirror metadata for lossless
re-import.

**Tech Stack:** TypeScript, Jest with `config/jest.config.js`, integration Jest
with `config/jest.integration.js`, IP-XACT XML, Quartus `_hw.tcl`, YAML bus
contracts.

## Global Constraints

- Work only in `.worktrees/bus-interface-conformance`; preserve all existing
  uncommitted work.
- Do not stage, commit, or push files automatically.
- Keep TypeScript and schema properties camelCase; snake_case remains confined
  to Nunjucks template contexts.
- Preserve V-3/V-4 `docVersion`, `editId`, `baseDocVersion`, and
  `sourceEditId` behavior.
- Keep standard IP-XACT parameters resolved for vendor consumption, but mirror
  only authored semantic keys and explicitly authored endianness.
- A malformed non-builtin bus definition rejected by normalization must not be
  resurrected by raw generator lookup.
- Logic with a second consumer belongs in `src/shared/busContracts/` when it
  neither reads/emits XML or Tcl syntax nor depends on vendor source ordering.
- Run `npm run lint`, `npm run type-check`, and `npm run compile` before
  completion.

---

### Task 1: Canonical observed-port reconciliation

**Files:**

- Create: `src/shared/busContracts/observedPorts.ts`
- Create: `src/test/suite/shared/observedBusPorts.test.ts`
- Modify: `src/shared/busContracts/index.ts`
- Modify: `src/parser/ComponentXmlParser.ts:589-655`
- Modify: `src/parser/HwTclParser.ts:509-566`
- Verify: `src/test/suite/parser/ComponentXmlParser.test.ts`
- Verify: `src/test/suite/parser/HwTclParser.test.ts`

**Interfaces:**

- Consumes: `readonly NormalizedBusPort[]`, observed logical/physical names and
  widths, and a physical prefix.
- Produces:

  ```ts
  export interface ObservedBusPort {
    logicalName: string;
    physicalName: string;
    width: number | string;
  }

  export interface ObservedBusPortSelections {
    useOptionalPorts?: string[];
    portWidthOverrides?: Record<string, number | string>;
    portNameOverrides?: Record<string, string>;
  }

  export function reconcileObservedBusPorts(
    contractPorts: readonly NormalizedBusPort[],
    observedPorts: readonly ObservedBusPort[],
    physicalPrefix: string
  ): ObservedBusPortSelections;
  ```

- [ ] **Step 1: Write the failing pure-function tests**

  Add table-driven tests with literal expectations. Include mixed-case logical
  names, an enabled optional port, a numeric default-width match, a numeric
  mismatch, a symbolic width, and a renamed physical suffix:

  ```ts
  expect(
    reconcileObservedBusPorts(
      [
        port('DATA', 32, 'required'),
        port('KEEP', 4, 'optional'),
        port('READY', 1, 'required'),
      ],
      [
        { logicalName: 'data', physicalName: 's_data', width: 64 },
        { logicalName: 'keep', physicalName: 's_keep_i', width: 'DATA_W/8' },
        { logicalName: 'ready', physicalName: 'ready_external', width: 1 },
      ],
      's_'
    )
  ).toEqual({
    useOptionalPorts: ['KEEP'],
    portWidthOverrides: { DATA: 64, KEEP: 'DATA_W/8' },
    portNameOverrides: { KEEP: 'keep_i', READY: 'ready_external' },
  });
  ```

  Add a second case proving empty maps and arrays are omitted from the result.

- [ ] **Step 2: Run the new test and verify RED**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/observedBusPorts.test.ts --runInBand
  ```

  Expected: FAIL because `reconcileObservedBusPorts` is not yet exported.

- [ ] **Step 3: Implement the pure reconciler**

  Build one case-insensitive definition map. Preserve each contract port's
  canonical name when constructing result keys. Treat a string observed width
  as an override whenever the contract default is numeric. Compare physical
  suffixes against `logicalName.toLowerCase()`:

  ```ts
  const definitionByUpper = new Map(
    contractPorts.map((port) => [port.name.toUpperCase(), port])
  );
  const present = new Set(observedPorts.map((port) => port.logicalName.toUpperCase()));
  ```

  Return only non-empty properties and export the module through the package
  barrel.

- [ ] **Step 4: Run the pure test and verify GREEN**

  Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Replace both importer copies**

  In `ComponentXmlParser`, adapt `extractPortMap(busIf, modelPortAttrs)` to
  `ObservedBusPort[]` and assign the returned selections to the bus entry.
  Confirm that `entry` is newly constructed for each interface before using
  `Object.assign`; no prior selection maps may survive an empty result.

  In `HwTclParser`, adapt `bi.ports` as follows:

  ```ts
  const observedPorts = bi.ports.map((port) => ({
    logicalName: port.logicalName,
    physicalName: port.portName,
    width: port.width,
  }));
  Object.assign(
    entry,
    reconcileObservedBusPorts(contractMatch.contract.ports, observedPorts, physicalPrefix)
  );
  ```

  Delete the local optional-port, width-override, and name-override loops from
  both parsers.

- [ ] **Step 6: Verify importer behavior remains green**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/observedBusPorts.test.ts src/test/suite/parser/ComponentXmlParser.test.ts src/test/suite/parser/HwTclParser.test.ts --runInBand
  git diff --check
  ```

  Expected: all tests PASS and no whitespace errors.

---

### Task 2: Declarative-contract predicate and vendor metadata precedence

**Files:**

- Create: `src/shared/busContracts/contractVersion.ts`
- Modify: `src/shared/busContracts/index.ts`
- Modify: `src/shared/busContracts/vendorProperties.ts`
- Modify: `src/shared/busContracts/propertyResolution.ts:43`
- Modify: `src/parser/ComponentXmlParser.ts:185-307`
- Modify: `src/test/suite/shared/vendorContractProperties.test.ts`
- Modify: `src/test/suite/parser/ComponentXmlParser.test.ts:1196-1290`

**Interfaces:**

- Produces:

  ```ts
  export function isDeclarativeContract(
    contract: BusDefinitionContract | null | undefined
  ): contract is BusDefinitionContract & { version: 1 };
  ```

- Extends `importVendorContractMetadata` with:

  ```ts
  mirroredProperties?: ReadonlyMap<string, string>;
  ```

  `undefined` means no supported mirror; `new Map()` means a supported empty
  version-one mirror.

**Mirror precedence matrix:**

| Supported mirror | Standard value | Mirror value | Result |
| --- | --- | --- | --- |
| Absent | Absent | N/A | Import nothing |
| Absent | Present | N/A | Import standard value |
| Empty/key absent | Present | Absent | Validate, then discard standard value |
| Key present | Absent | Present | Import mirrored value |
| Key present | Same | Present | Import mirrored value |
| Key present | Different | Present | Throw source-located conflict |
| Key undeclared by contract | Any | Present | Throw source-located unknown-property error |

- [ ] **Step 1: Add failing precedence tests**

  Extend `vendorContractProperties.test.ts` with one literal test per matrix
  row. The empty-mirror case must assert exactly `{}`. The partial case must
  prove that a standard-only `symbolsPerBeat` and ordering value are discarded:

  ```ts
  expect(
    importVendorContractMetadata({
      contract,
      rawProperties: new Map([
        ['dataBitsPerSymbol', '1'],
        ['symbolsPerBeat', '5'],
        ['firstSymbolInHighOrderBits', 'true'],
      ]),
      mirroredProperties: new Map([['dataBitsPerSymbol', '1']]),
      location: 'component.xml busInterfaces.stream',
    })
  ).toEqual({ interfaceProperties: { dataBitsPerSymbol: 1 } });
  ```

  Add a conflict test for standard `symbolsPerBeat=5` versus mirrored `4`.
  Add an absent-standard/absent-mirror case that returns `{}`, and an unknown
  mirrored key case that reports the key and source location.

- [ ] **Step 2: Run precedence tests and verify RED**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/vendorContractProperties.test.ts --runInBand
  ```

  Expected: FAIL because `mirroredProperties` is ignored or unsupported.

- [ ] **Step 3: Implement mirror-aware shared metadata import**

  Parse and validate standard values first. When `mirroredProperties` is
  defined, parse mirror values, compare only keys present in both maps, and
  select authored output exclusively from mirror keys. Derive
  `symbolsPerBeat` from data width only when no supported mirror exists.

  Before selecting values, reject every mirrored key other than `endianness`
  that is absent from `contract.interfaceProperties`. The error must include
  `location`, the mirror key, and that the property is undeclared.

  Use the same rule for `firstSymbolInHighOrderBits` versus mirrored
  `endianness`; absence on either side is not a conflict.

- [ ] **Step 4: Add and implement the named version predicate**

  Add focused assertions for `undefined`, `version: null`, and `version: 1`,
  then implement:

  ```ts
  export function isDeclarativeContract(
    contract: BusDefinitionContract | null | undefined
  ): contract is BusDefinitionContract & { version: 1 } {
    return contract?.version === 1;
  }
  ```

  Replace the direct sentinel in `propertyResolution.ts`.

- [ ] **Step 5: Refactor component XML metadata through the shared importer**

  Change `getMirroredContractProperties` to return `Map<string, string> |
  undefined`, preserving the distinction between absent/unsupported and a
  supported empty mirror. Remove `coerceContractProperty` and the duplicated
  property/ordering reconciliation from `readContractMetadata`.

  Build `rawProperties` from declared contract property names plus
  `firstSymbolInHighOrderBits`, then call:

  ```ts
  return importVendorContractMetadata({
    contract: match.contract,
    rawProperties,
    mirroredProperties: getMirroredContractProperties(busIfEl),
    location: `component.xml busInterfaces.${ifName}`,
  });
  ```

  Gate the call with `isDeclarativeContract(match?.contract)`.

- [ ] **Step 6: Verify shared and parser behavior**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/vendorContractProperties.test.ts src/test/suite/parser/ComponentXmlParser.test.ts src/test/suite/parser/HwTclParser.test.ts src/test/suite/shared/busConformance.test.ts --runInBand
  ```

  Expected: all tests PASS, including legacy `_hw.tcl` symbol aliases and
  component XML conflict diagnostics.

---

### Task 3: Authored-only IP-XACT mirror round trips

**Files:**

- Modify: `src/generator/VivadoComponentXmlGenerator.ts:419-477`
- Modify: `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts:180-225,638-683`
- Modify: `src/test/suite/parser/ComponentXmlParser.test.ts:1143-1194`
- Modify: `src/test/integration/roundtrip.test.ts:261-316`

**Interfaces:**

- Standard IP-XACT properties: all concrete resolved contract properties.
- IPCraft mirror properties: only keys authored in
  `iface.interfaceProperties`, using their validated resolved values.
- Mirrored endianness: only an explicitly authored `little` or `big` value.
- Eligible version-one custom contracts always emit the mirror element, even
  with zero children.

- [ ] **Step 1: Write the named empty-mirror round-trip test**

  Add a test named:

  ```ts
  it('keeps resolved standard properties unauthored through an empty IPCraft mirror', async () => {
    // Export an Avalon-ST interface with data width but no interfaceProperties
    // and no endianness.
  });
  ```

  Assert all three boundaries independently:

  ```ts
  expect(xml).toContain('<spirit:name>dataBitsPerSymbol</spirit:name>');
  expect(xml).toContain('<spirit:name>symbolsPerBeat</spirit:name>');
  expect(xml).toMatch(
    /<ipcraft:interfaceContract version="1">\s*<\/ipcraft:interfaceContract>/
  );
  expect(parsed.busInterfaces?.[0].interfaceProperties).toBeUndefined();
  expect(parsed.busInterfaces?.[0].endianness).toBeUndefined();
  ```

- [ ] **Step 2: Add partial and explicit-little tests**

  Add one custom-contract case with an authored `lanes` value and an unauthored
  default `interleaved: false`. Assert that both appear as standard parameters,
  only `lanes` appears in the mirror, and only `lanes` returns in
  `interfaceProperties`.

  Add one case with explicit `endianness: little` and assert it survives the
  export/import cycle. This distinguishes authored little from absent default
  little.

- [ ] **Step 3: Run generator/parser tests and verify RED**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/parser/ComponentXmlParser.test.ts --runInBand
  ```

  Expected: FAIL because resolved defaults and little endianness are currently
  mirrored unconditionally.

- [ ] **Step 4: Split standard and mirrored property selections**

  Keep `semanticProperties` unchanged for standard parameter emission. Add an
  authored selection:

  ```ts
  const authoredPropertyNames = new Set(Object.keys(iface.interfaceProperties ?? {}));
  const mirroredProperties = semanticProperties.filter((property) =>
    authoredPropertyNames.has(property.name)
  );
  if (iface.endianness === 'little' || iface.endianness === 'big') {
    mirroredProperties.push({ name: 'endianness', value: iface.endianness });
  }
  ```

  Use `isDeclarativeContract(contract)` for the mirror gate. Always emit the
  eligible mirror wrapper; sort only the mirrored values before rendering.

- [ ] **Step 5: Verify GREEN and round-trip coverage**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/parser/ComponentXmlParser.test.ts --runInBand
  npm run test:integration:roundtrip -- --runInBand
  ```

  Expected: all tests PASS; authored properties remain authored, resolved
  defaults remain standard vendor metadata only.

---

### Task 4: Canonical-only custom bus lookup

**Files:**

- Modify: `src/generator/VivadoCustomBusDefinitions.ts:17-64,133-165`
- Modify: `src/generator/VivadoComponentXmlGenerator.ts:309,1031`
- Modify: `src/services/toolchains/VivadoToolchain.ts:134-145`
- Modify: `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts`
- Modify: `src/test/integration/roundtrip.test.ts:286-290`

**Interfaces:**

- `findCustomBusDef(ifaceType, busLibrary): CustomBusInfo | null`
- `generateCustomBusDefs(ipCore, busLibrary): Record<string, string>`
- A valid legacy definition normalized with `version: null` remains eligible.
- A malformed raw-only definition absent from the normalized library returns no
  custom artifact.

- [ ] **Step 1: Write the malformed-definition characterization test**

  Construct a raw definition with valid VLNV metadata but duplicate logical
  ports so `normalizeBusLibrary` rejects it. Call the current public generator
  boundary and assert that it produces no bus-definition files:

  ```ts
  const library = normalizeBusLibrary([
    {
      sourceFile: '/workspace/malformed.yml',
      sourceKind: 'workspace',
      definitions: malformedDefinitions,
    },
  ]);
  expect(library.definitions.MALFORMED).toBeUndefined();
  expect(generateCustomBusDefsCurrent(ip, malformedDefinitions, library)).toEqual({});
  ```

  Rename the existing test-local import alias for the current production export
  to `generateCustomBusDefsCurrent`; this RED test deliberately uses the current
  three-argument API. Step 4 changes the public API to two arguments only after
  the behavior is green.

  This assertion must fail against the current fallback loop, which resurrects
  the raw definition.

- [ ] **Step 2: Write the valid legacy characterization test**

  Normalize a contract-less definition and assert `version` is `null`, then
  assert its bus and abstraction XML files are generated. This test must pass
  before and after fallback removal.

- [ ] **Step 3: Run the focused tests and verify RED for malformed input**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts -t "malformed|legacy contract-less" --runInBand
  ```

  Expected: malformed case FAILS because raw lookup still generates files;
  valid legacy case PASSES.

- [ ] **Step 4: Remove the raw fallback**

  Delete the `Object.values(busDefinitions)` scan. Resolve custom metadata only
  from `canonicalizeBusType`. Keep the existing native Vivado exclusion.

  First retain the existing outer function signatures long enough to make the
  behavioral tests green. Then, as a green refactor, remove the now-unused
  `busDefinitions` argument from `findCustomBusDef` and
  `generateCustomBusDefs`, updating production and test call sites.

- [ ] **Step 5: Inject normalized custom definitions in tests**

  Add a local helper based on the existing test sources:

  ```ts
  function libraryWithDefinitions(definitions: BusDefinitionFile): NormalizedBusLibrary {
    return normalizeBusLibrary([
      ...builtinBusDefinitionSources(),
      {
        sourceFile: '/workspace/test-bus-definitions.yml',
        sourceKind: 'workspace',
        definitions,
      },
    ]);
  }
  ```

  Use it for custom and workspace-sourced definitions instead of relying on the
  removed raw scan. Native `BUS_DEFS` remain available for Vivado-native port
  rendering.

- [ ] **Step 6: Verify canonical and malformed behavior**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/services/BusLibraryService.test.ts --runInBand
  npm run test:integration:roundtrip -- --runInBand
  ```

  Expected: valid normalized legacy/custom definitions generate; malformed
  raw-only definitions do not.

---

### Task 5: Remove the conformance middle man

**Files:**

- Delete: `src/services/BusConformanceService.ts`
- Delete: `src/test/suite/services/BusConformanceService.test.ts`
- Create: `src/test/suite/shared/busConformancePolicy.test.ts`
- Modify: `src/commands/ConsistencyCheckCommands.ts`
- Modify: `src/commands/ImportCommands.ts`
- Modify: `src/generator/IpCoreScaffolder.ts`
- Modify: `src/providers/IpCoreSourcePreviewProvider.ts`
- Modify: `src/test/suite/services/AllExamplesConformance.test.ts`
- Modify: `src/test/suite/commands/ConsistencyCheckCommands.test.ts`
- Modify: `src/test/suite/commands/ImportCommands.test.ts`
- Modify: `src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts`

**Interfaces:**

- Consumers import `checkBusConformance`, `blocksGeneration`, and
  `blocksImportWrite` from `src/shared/busConformance.ts`.
- Consumers import `ConformanceReport` from `src/shared/issues.ts` when needed.

- [ ] **Step 1: Establish the enforcement-policy characterization baseline**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/BusConformanceService.test.ts src/test/suite/commands/ConsistencyCheckCommands.test.ts src/test/suite/commands/ImportCommands.test.ts src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts --runInBand
  ```

  Expected: PASS before refactoring.

- [ ] **Step 2: Move the policy test to the shared boundary**

  Preserve the five existing consumer-visible assertions unchanged, but import
  directly from `../../../shared/busConformance` and rename the suite to
  `busConformance enforcement policy`.

- [ ] **Step 3: Update production and test imports**

  Replace every `services/BusConformanceService` import and Jest mock with the
  shared module. Keep mocks only where command/provider boundary behavior is
  under test; use the real shared implementation in policy and example tests.

- [ ] **Step 4: Delete the middle-man module and obsolete test path**

  Remove the 19-line wrapper and the superseded services test file. Verify no
  references remain:

  ```bash
  rg -n "BusConformanceService" src
  ```

  Expected: zero matches.

- [ ] **Step 5: Verify enforcement boundaries remain green**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/busConformancePolicy.test.ts src/test/suite/services/AllExamplesConformance.test.ts src/test/suite/commands/ConsistencyCheckCommands.test.ts src/test/suite/commands/ImportCommands.test.ts src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts --runInBand
  ```

  Expected: all enforcement decisions and mock boundaries remain unchanged.

---

### Task 6: Make vendor suites feature evidence

**Files:**

- Modify: `ipcraft-spec/examples/comprehensive_avalon/comprehensive_avalon.ip.yml`
- Modify: `ipcraft-spec/examples/comprehensive_avalon/README.md`
- Modify: `src/test/integration/vivado.test.ts`
- Modify: `src/test/integration/quartus.test.ts`
- Modify after intentional review:
  `src/test/integration/__snapshots__/snapshots.test.ts.snap`
- Verify: `src/test/integration/roundtrip.test.ts`
- Verify: `src/test/integration/endianness.test.ts`
- Verify: `src/test/integration/snapshots.test.ts`

**Interfaces:**

- `SNK_ST` retains data width `16`, renamed physical ports, and only the
  existing `ready` optional port.
- It authors only the non-default symbol width:

  ```yaml
  interfaceProperties:
    dataBitsPerSymbol: 1
  ```

- Vivado evidence includes version-one mirror metadata and generated
  `busdef/avalon_st.xml` plus `busdef/avalon_st_rtl.xml`.
- Vivado standard parameters include authored `dataBitsPerSymbol: 1` and
  derived `symbolsPerBeat: 16`, while the IPCraft mirror includes only the
  authored `dataBitsPerSymbol` key.
- Quartus evidence includes authored `dataBitsPerSymbol`, derived
  `symbolsPerBeat`, and default `readyLatency` as standard interface properties.

- [ ] **Step 1: Add failing Vivado fixture assertions**

  In `vivado.test.ts`, locate
  `examples/comprehensive_avalon_vhdl`, read its `component.xml`, and assert:

  ```ts
  expect(xml).toContain('<ipcraft:interfaceContract version="1">');
  expect(fs.existsSync(path.join(xilinxDir, 'busdef', 'avalon_st.xml'))).toBe(true);
  expect(fs.existsSync(path.join(xilinxDir, 'busdef', 'avalon_st_rtl.xml'))).toBe(true);
  ```

  Isolate the `SNK_ST` bus-interface block. Assert its standard parameters
  contain `dataBitsPerSymbol=1` and `symbolsPerBeat=16`; isolate its IPCraft
  mirror and assert it contains `dataBitsPerSymbol=1` but not
  `symbolsPerBeat`. This fails if resolved defaults are mirrored again.

  Also parse or inspect the `SNK_ST` port map and assert the physical data port
  remains `asi_rx_bits` with width 16. This makes the packet/data-width promise
  observable. Assert that `SRC_ST` still maps `aso_startofpacket`,
  `aso_endofpacket`, and the three-bit `aso_empty` port so the existing packet
  contract cannot change as incidental fixture churn.

- [ ] **Step 2: Add failing Quartus fixture assertions**

  In `quartus.test.ts`, locate the same fixture's `_hw.tcl` and assert literal
  properties and unchanged port structure:

  ```ts
  expect(tcl).toContain('set_interface_property SNK_ST dataBitsPerSymbol 1');
  expect(tcl).toContain('set_interface_property SNK_ST symbolsPerBeat 16');
  expect(tcl).toContain('set_interface_property SNK_ST readyLatency 0');
  expect(tcl).toContain('add_interface_port SNK_ST asi_rx_bits data Input 16');
  expect(tcl).toContain('add_interface_port SRC_ST aso_empty empty Output 3');
  ```

- [ ] **Step 3: Run vendor scripts without external tools and verify RED**

  Run:

  ```bash
  VIVADO_BIN=/nonexistent/ipcraft-vivado npm run test:integration:vivado -- --runInBand
  SKIP_DOCKER=1 QUARTUS_TCLSH_BIN= QUARTUS_SH_BIN= npm run test:integration:quartus -- --runInBand
  ```

  Expected: the new symbol-property assertions FAIL because the example still
  uses default eight-bit symbol semantics. The bus-definition existence and
  unchanged port-structure assertions already PASS as characterization tests.
  The existing 11 vendor-tool tests remain regression evidence; the failing
  symbol assertions establish the missing feature evidence.

- [ ] **Step 4: Author non-default symbol semantics in the shared example**

  Add the exact authored-only `interfaceProperties` block above to `SNK_ST`.
  Update the README to explain that the source demonstrates default byte
  symbols while the sink authors a one-bit symbol width and derives sixteen
  symbols per beat. Do not change `data: 16`, `useOptionalPorts`, or
  `portNameOverrides`.

- [ ] **Step 5: Run vendor scripts and verify GREEN**

  Repeat the Step 3 commands. Expected: structural assertions PASS and external
  tool invocations are explicitly skipped.

- [ ] **Step 6: Update and audit the shared fixture snapshot**

  Run:

  ```bash
  npm run test:integration:snapshots -- --runInBand -u
  git diff -- src/test/integration/__snapshots__/snapshots.test.ts.snap
  ```

  Accept only comprehensive-Avalon changes caused by the authored sink symbol
  properties and any mirror-authorship corrections from Task 3. Reject
  unrelated snapshot churn. Named expected corrections include `SRC_ST`
  retaining authored `endianness: big` and `SNK_ST` no longer materializing
  unauthored `endianness: little` on re-import or in IPCraft mirror metadata.

- [ ] **Step 7: Verify the fixture blast radius**

  Run:

  ```bash
  npm run test:integration:roundtrip -- --runInBand
  npm run test:integration:hdl -- --runInBand
  npx jest --config config/jest.integration.js --testPathPatterns=endianness --runInBand
  ```

  Expected: round-trip semantics, generated HDL, packet/data widths, and symbol
  ordering all PASS. No docs screenshot update is expected because the example
  YAML change does not alter a documented UI screenshot; confirm with
  `git status --short docs/`.

---

### Task 7: Record format-boundary and revision decisions

**Files:**

- Modify: `docs/architecture/extension-host.md:84-98`
- Verify: `docs/architecture/webview.md:62-81`

**Interfaces:** Human-facing architecture guidance; no production behavior.

- [ ] **Step 1: Add the format-boundary responsibility review**

  Document that `ComponentXmlParser`, `HwTclParser`, and
  `VivadoComponentXmlGenerator` each own one ordered vendor format
  transformation. Record the enforceable extraction rule verbatim:

  > Logic with a second consumer belongs in `src/shared/busContracts/` when it
  > neither reads nor emits XML/Tcl syntax nor depends on vendor source ordering.

  Explain that syntax traversal, source ordering, and ordered document assembly
  remain local, while policy and transformations are extracted.

- [ ] **Step 2: Record source-result correlation beside revision guidance**

  Add one concise paragraph stating that `sourceRevision` compares exact source
  text only when applying asynchronous conformance/generation results. It is
  intentionally separate from and does not advance/filter V-3/V-4 document
  revisions. Mention the full-text comparison cost so future changes can assess
  it deliberately.

- [ ] **Step 3: Review documentation constraints**

  Run:

  ```bash
  git diff --check -- docs/architecture/extension-host.md docs/architecture/webview.md docs/superpowers/specs/2026-08-12-bus-interface-audit-remediation-design.md
  rg -n "[😀-🙏]" docs/architecture/extension-host.md docs/superpowers/specs/2026-08-12-bus-interface-audit-remediation-design.md || true
  ```

  Expected: no whitespace errors and no documentation emojis.

---

### Task 8: Final regression and audit verification

**Files:**

- Verify all files changed by Tasks 1-7.
- Do not stage, commit, or push.

- [ ] **Step 1: Run focused unit suites**

  ```bash
  npx jest --config config/jest.config.js src/test/suite/shared/observedBusPorts.test.ts src/test/suite/shared/vendorContractProperties.test.ts src/test/suite/shared/busConformance.test.ts src/test/suite/shared/busConformancePolicy.test.ts src/test/suite/parser/ComponentXmlParser.test.ts src/test/suite/parser/HwTclParser.test.ts src/test/suite/generator/VivadoComponentXmlGenerator.test.ts src/test/suite/services/BusLibraryService.test.ts src/test/suite/webview/useCanvasValidation.test.ts --runInBand
  ```

  Expected: all focused tests PASS. The existing pending-library test named
  `defers contract-dependent interrupt validation until the bus library arrives`
  remains green; do not add a duplicate.

- [ ] **Step 2: Run boundary suites**

  ```bash
  npx jest --config config/jest.config.js src/test/suite/services/AllExamplesConformance.test.ts src/test/suite/commands/ConsistencyCheckCommands.test.ts src/test/suite/commands/ImportCommands.test.ts src/test/suite/providers/IpCoreSourcePreviewProvider.test.ts src/test/suite/generator/IpCoreScaffolder.test.ts --runInBand
  npm run test:integration:roundtrip -- --runInBand
  npm run test:integration:snapshots -- --runInBand
  ```

  Expected: all PASS.

- [ ] **Step 3: Run vendor feature suites**

  ```bash
  VIVADO_BIN=/nonexistent/ipcraft-vivado npm run test:integration:vivado -- --runInBand
  SKIP_DOCKER=1 QUARTUS_TCLSH_BIN= QUARTUS_SH_BIN= npm run test:integration:quartus -- --runInBand
  ```

  Expected: feature assertions PASS. Record external-tool skips accurately; do
  not represent skipped Vivado/Quartus execution as vendor-tool validation.

- [ ] **Step 4: Run static and build gates**

  ```bash
  npm run lint
  npm run type-check
  npm run compile
  git diff --check
  ```

  Expected: all commands exit 0 with no warnings.

- [ ] **Step 5: Re-run audit queries**

  ```bash
  rg -n "BusConformanceService" src || true
  rg -n "contract\.version === 1|contract\.version !== 1|contract\.version === null" src/shared/busContracts src/parser/ComponentXmlParser.ts src/generator/VivadoComponentXmlGenerator.ts || true
  rg -n "portWidthOverrides|portNameOverrides|useOptionalPorts" src/parser/ComponentXmlParser.ts src/parser/HwTclParser.ts
  wc -l src/parser/ComponentXmlParser.ts src/parser/HwTclParser.ts src/generator/VivadoComponentXmlGenerator.ts
  git status --short
  ```

  Expected: no middle-man references, declarative checks use the named
  predicate, importer reconciliation is delegated to the shared module, and the
  line counts are reported for reviewer context. Coverage by the architecture
  note is established by Task 7's documentation review, not by `wc -l`.

- [ ] **Step 6: Report outcomes without committing**

  Summarize confirmed audit fixes, rejected findings, exact test results,
  external-tool skips, snapshot changes, remaining dirty submodule state, and
  any pre-existing failures. Leave the worktree unstaged for developer review.
