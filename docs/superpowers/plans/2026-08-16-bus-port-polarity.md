# Bus Port Polarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicate positive/`_n` Avalon-MM ports with one canonical port whose assertion polarity is declared by the bus contract and overridden per interface instance.

**Architecture:** A shared polarity module owns vendor-role matching, legacy alias canonicalization, effective polarity, and default physical suffixes. The resolver exposes canonical identity, vendor role, effective polarity, and physical suffix separately; importers and generators consume those values instead of inferring semantics from physical names. The webview keeps canonical in-memory state while deferring format-preserving legacy YAML edits until the first user mutation.

**Tech Stack:** TypeScript, React, YAML v2 format-preserving edits, JSON Schema, generated TypeScript types, Nunjucks, Jest, Playwright, VHDL, SystemVerilog, Intel `_hw.tcl`, IP-XACT.

## Global Constraints

- Work only in `/Users/bachleviet/workspace/opensource/ipcraft-vscode/.worktrees/bus-interface-conformance`.
- Preserve `types/pure utilities -> services/controllers/hooks -> components -> app roots`.
- Use camelCase for TypeScript, React, and JSON Schema. Do not add snake_case source-domain fields or dual-case fallbacks.
- Use `yaml` v2 and existing `applyPathEdits`/`applyPathDeletes` for document writes. Do not use `js-yaml` to write YAML.
- Preserve update atomicity, undo granularity, protocol payloads, selection, and focus behavior.
- Treat physical spelling and semantic polarity as independent.
- Built-in configurable polarity is limited to Avalon-MM `byteenable`, `readdatavalid`, `waitrequest`, `read`, and `write`.
- AXI and Avalon-ST transaction ports remain unchanged. Reset polarity remains in the reset model.
- Accept legacy aliases from `main` on input, but never emit duplicate `_n` logical selections.
- Do not automatically stage, commit, or push. Every task ends at an unstaged review checkpoint.
- Every Jest command must include `--config config/jest.config.js`.
- Run `npm run generate-types` after schema changes and `npm run compile` after generation.

---

## File Structure

### New focused modules

- `src/shared/busContracts/polarity.ts`: role matching, effective polarity, physical suffixes, and legacy interface canonicalization.
- `src/test/suite/shared/busContractPolarity.test.ts`: direct pure-policy coverage.
- `src/generator/resolvers/boundaryTransforms.ts`: collision-free HDL inversion/reflow projection, kept outside the already 490-line bus resolver.
- `src/test/suite/generator/resolvers/boundaryTransforms.test.ts`: direct boundary transformation coverage.

### Existing responsibilities extended

- `ipcraft-spec/schemas/bus_definition.schema.json` and `ipcraft-spec/schemas/ip_core.schema.json`: raw contract and instance shapes.
- `src/shared/busContracts/types.ts`, `normalizeValues.ts`, `normalize.ts`, `activePorts.ts`, and `resolve.ts`: normalized and resolved polarity.
- `src/shared/busContracts/observedPorts.ts`: structured vendor import reconciliation.
- `src/webview/ipcore/hooks/useIpCoreState.ts`: canonical in-memory view plus deferred YAML migrations.
- `src/generator/resolvers/bus.ts`: consumes resolved ports and delegates transforms.
- `src/webview/ipcore/hooks/useBusContractEditor.ts`: polarity edit model.
- `src/webview/ipcore/components/canvas/canvasLayout.ts`: resolved labels and H/L badge data.

---

### Task 1: Replace the Mutual-Exclusion Contract with Polarity Declarations

**Files:**

- Modify: `ipcraft-spec/schemas/bus_definition.schema.json`
- Modify: `ipcraft-spec/schemas/ip_core.schema.json`
- Modify: `ipcraft-spec/bus_definitions/avalon_mm.yml`
- Modify: `ipcraft-spec/docs/bus-interface-conformance.md`
- Modify generated: `src/domain/busDefinition.types.ts`
- Modify generated: `src/domain/ipcore.types.ts`
- Modify manually: `src/webview/types/ipCore.d.ts`
- Modify: `src/generator/types.ts`
- Modify: `src/shared/busContracts/types.ts`
- Modify: `src/shared/busContracts/normalizeValues.ts`
- Modify: `src/shared/busContracts/normalize.ts`
- Modify: `src/shared/busContracts/dependencies.ts`
- Modify: `src/shared/busContracts/constraintEvaluation.ts`
- Modify: `src/shared/busContracts/activePorts.ts`
- Modify: `src/shared/busContracts/index.ts`
- Modify: `src/webview/ipcore/components/canvas/IpBlockCanvas.tsx`
- Modify: `src/test/suite/services/BusDefinitionSchema.test.ts`
- Modify: `src/test/suite/services/YamlValidator.test.ts`
- Modify: `src/test/suite/services/BuiltinBusContracts.test.ts`
- Modify: `src/test/suite/shared/busContractNormalize.test.ts`
- Modify: `src/test/suite/shared/busContractResolve.test.ts`
- Modify: `src/test/browser/subport-click-toggle.spec.ts`
- Delete: `src/test/suite/shared/busContractActivePorts.test.ts`

**Interfaces:**

```ts
interface BusPortPolarity {
  default: 'activeHigh' | 'activeLow';
  roles: {
    activeHigh: string;
    activeLow: string;
  };
}

type PortPolarity = 'activeHigh' | 'activeLow';

interface NormalizedPortPolarity {
  default: PortPolarity;
  roles: Readonly<Record<PortPolarity, string>>;
}
```

`NormalizedBusPort` gains `polarity?: NormalizedPortPolarity`. The raw and normalized `portsMutuallyExclusive` variants and `activateOptionalPort` are removed.

`BusInterface` gains `portPolarityOverrides?: Record<string, PortPolarity>` so the resolver work in Task 2 is typed from the start. The already-supported `portNameOverrides?: Record<string, string>` is also declared in the schema so generated domain code can preserve literal physical names without relying on the schema's open-object index signature.

- [ ] **Step 1: Write failing schema and built-in tests**

Add valid declarations plus malformed-role, duplicate-role, colliding-role, and `inout` cases. Also validate an IP-core instance with `portPolarityOverrides: { read: activeLow }`, and reject `low`, `ACTIVE_LOW`, booleans, and arrays:

```ts
const polarityPort = {
  name: 'request',
  direction: 'out',
  presence: 'optional',
  polarity: {
    default: 'activeHigh',
    roles: { activeHigh: 'request', activeLow: 'request_n' },
  },
};

expect(validate(definitionWithPort(polarityPort))).toEqual({ valid: true });
expect(
  validate(
    definitionWithPort({
      ...polarityPort,
      polarity: { default: 'activeHigh', roles: { activeHigh: 'request' } },
    })
  ).valid
).toBe(false);
```

Assert the Avalon contract exposes only canonical capable ports:

```ts
expect(avalon.ports.filter((port) => port.polarity).map((port) => port.name)).toEqual([
  'read',
  'write',
  'byteenable',
  'readdatavalid',
  'waitrequest',
]);
expect(avalon.ports.some((port) => port.name.endsWith('_n'))).toBe(false);
```

- [ ] **Step 2: Verify the tests fail for the intended reason**

Run:

```bash
npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/BuiltinBusContracts.test.ts src/test/suite/services/YamlValidator.test.ts --runInBand
```

Expected: FAIL because contract polarity and instance overrides are rejected and duplicate `_n` ports remain.

- [ ] **Step 3: Add the raw schema and consolidate Avalon-MM**

Add:

```json
"PortPolarity": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "default": { "enum": ["activeHigh", "activeLow"] },
    "roles": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "activeHigh": { "$ref": "#/$defs/NonEmptyString" },
        "activeLow": { "$ref": "#/$defs/NonEmptyString" }
      },
      "required": ["activeHigh", "activeLow"]
    }
  },
  "required": ["default", "roles"]
}
```

Reference it from `BusContractPort`. Remove `ConstraintPortsMutuallyExclusive` from `BusConstraint`.

In `avalon_mm.yml`, remove the five `_n` port declarations and five exclusivity constraints. Add explicit polarity metadata to each canonical port. Keep one canonical byte-enable width quotient and delete the duplicate `_N_WIDTH` rule.

Add this camelCase instance field to the bus-interface schema:

```json
"portPolarityOverrides": {
  "type": "object",
  "description": "Per-port assertion polarity overrides keyed by canonical bus port name.",
  "additionalProperties": { "enum": ["activeHigh", "activeLow"] }
}
```

Also formalize the existing `portNameOverrides` string map in the same schema object; this is backward-compatible because `BusInterface` already allows additional properties and current parsers/editor types already use the field.

Run type generation and update the legacy `src/webview/types/ipCore.d.ts` plus generator `BusInterfaceDef` manually. Do not hand-edit generated domain types.

- [ ] **Step 4: Normalize polarity and reject role collisions**

Extend `normalizePort`. Invalid declarations, equal activeHigh/activeLow roles, and polarity on `inout` produce `BUS_DEF_INVALID_PORT_POLARITY` at the precise path. In `normalizeEntry`, build a case-insensitive owner map for canonical names and polarity roles. Allow one role to equal its own port name; reject collisions with another port/role as `BUS_DEF_PORT_ROLE_COLLISION` at the exact role path.

Remove `portsMutuallyExclusive` from normalized types, dependency extraction, evaluator, and diagnostic routing. Remove `activateOptionalPort`. Restore canonical append-only activation temporarily:

```ts
const updated = [...current, portName];
onUpdate?.(['busInterfaces', busIndex, 'useOptionalPorts'], updated);
```

Delete the superseded direct policy test and browser coexistence case.

- [ ] **Step 5: Regenerate and pass the contract slice**

Run:

```bash
npm run generate-types
npx jest --config config/jest.config.js src/test/suite/services/BusDefinitionSchema.test.ts src/test/suite/services/BuiltinBusContracts.test.ts src/test/suite/services/YamlValidator.test.ts src/test/suite/shared/busContractNormalize.test.ts src/test/suite/shared/busContractResolve.test.ts --runInBand
npm run type-check
npm run compile
```

Expected: PASS; generated and normalized unions contain polarity and no mutual-exclusion member.

- [ ] **Step 6: Document and review unstaged changes**

Document declaration, defaults, roles, built-in scope, and physical-name independence. Run `git diff --check` and `git status --short`. Expected: no whitespace errors and nothing staged.

---

### Task 2: Add Pure Polarity Resolution and Legacy Canonicalization

**Files:**

- Create: `src/shared/busContracts/polarity.ts`
- Create: `src/test/suite/shared/busContractPolarity.test.ts`
- Modify: `src/shared/busContracts/types.ts`
- Modify: `src/shared/busContracts/activePorts.ts`
- Modify: `src/shared/busContracts/resolve.ts`
- Modify: `src/shared/busContracts/index.ts`
- Modify: `src/test/suite/shared/busContractResolve.test.ts`
- Modify: `src/test/suite/shared/busContractMigration.characterization.test.ts`

**Interfaces:**

```ts
export interface MatchedBusPortRole {
  port: NormalizedBusPort;
  polarity?: PortPolarity;
}

export type BusInterfacePortMutation = readonly [
  path: readonly (string | number)[],
  value: unknown,
];

export interface CanonicalizedBusInterface {
  busInterface: BusInterface;
  mutations: readonly BusInterfacePortMutation[];
}

export function matchBusPortRole(
  ports: readonly NormalizedBusPort[],
  authoredName: string
): MatchedBusPortRole | null;

export function canonicalizeBusInterfacePorts(
  contract: BusDefinitionContract,
  busInterface: BusInterface,
  busIndex: number
): CanonicalizedBusInterface;

export function resolveEffectivePortPolarity(
  port: NormalizedBusPort,
  busInterface: BusInterface
): PortPolarity | undefined;

export function resolveInterfaceRole(
  port: NormalizedBusPort,
  busInterface: BusInterface
): string;

export function resolvePhysicalSuffix(
  port: NormalizedBusPort,
  busInterface: BusInterface
): string;
```

`ResolvedBusPort` gains `effectivePolarity?`, `interfaceRole`, and `physicalSuffix`. `BusInterfaceResolution` gains `canonicalBusInterface: BusInterface | null`.

- [ ] **Step 1: Write failing pure-policy tests**

Cover case-insensitive matching, literal physical overrides, all five aliases, inactive overrides, last-occurrence wins, and explicit new override precedence:

```ts
expect(matchBusPortRole(contract.ports, 'BYTEENABLE_N')).toMatchObject({
  port: { name: 'byteenable' },
  polarity: 'activeLow',
});

const result = canonicalizeBusInterfacePorts(
  contract,
  {
    name: 'S',
    type: contract.canonicalVlnv,
    mode: 'slave',
    useOptionalPorts: ['read', 'write', 'read_n'],
    portWidthOverrides: { read_n: 1 },
    portNameOverrides: { read_n: 'odd_read' },
  },
  0
);
expect(result.busInterface.useOptionalPorts).toEqual(['write', 'read']);
expect(result.busInterface.portPolarityOverrides).toEqual({ read: 'activeLow' });
expect(result.busInterface.portWidthOverrides).toEqual({ read: 1 });
expect(result.busInterface.portNameOverrides).toEqual({ read: 'odd_read' });
```

- [ ] **Step 2: Verify the API is absent**

Run `npx jest --config config/jest.config.js src/test/suite/shared/busContractPolarity.test.ts --runInBand`.

Expected: FAIL because the module and result fields do not exist.

- [ ] **Step 3: Implement matching and canonicalization without suffix inference**

Use declared canonical names and roles only. A canonical authored name means the declared default polarity; a declared role means that role's polarity. Canonicalize `useOptionalPorts`, `portWidthOverrides`, `portNameOverrides`, and `absentPorts`. Preserve unknown entries for diagnostics. Duplicate aliases use last occurrence/property order; unrelated order remains stable.

Explicit canonical `portPolarityOverrides` wins over legacy inferred polarity. If that makes the legacy authored role differ from the newly-derived physical suffix, preserve the old suffix as a literal canonical `portNameOverrides` entry. Return whole-field mutations only when values differ; use `undefined` for whole-field deletion so the existing YAML edit adapter chooses `applyPathDeletes`.

- [ ] **Step 4: Resolve metadata and diagnose invalid overrides**

Canonicalize immediately after contract matching. Use the canonical interface for all resolution. Diagnose unknown/incapable overrides at `['busInterfaces', index, 'portPolarityOverrides', name]` with `BUS_PORT_POLARITY_OVERRIDE`, then use the contract default. Inactive capable overrides are valid.

Build active ports with:

```ts
{
  ...port,
  effectivePolarity,
  interfaceRole: resolveInterfaceRole(port, canonicalBusInterface),
  physicalSuffix: resolvePhysicalSuffix(port, canonicalBusInterface),
  effectiveDirection,
  effectiveWidth,
}
```

- [ ] **Step 5: Run policy, migration, and resolver tests**

```bash
npx jest --config config/jest.config.js src/test/suite/shared/busContractPolarity.test.ts src/test/suite/shared/busContractResolve.test.ts src/test/suite/shared/busContractMigration.characterization.test.ts --runInBand
npm run type-check
```

Expected: PASS with exact paths and one canonical identity per function.

- [ ] **Step 6: Review dependency direction**

Run `git diff --check`. Confirm `polarity.ts` imports no webview, component, service, or generator module.

---

### Task 3: Propagate Instance State and Add Deferred Webview Migration

**Files:**

- Modify: `src/domain/parse.ts`
- Modify: `src/generator/registerProcessor.ts`
- Modify: `src/webview/ipcore/hooks/useIpCoreState.ts`
- Modify: `src/test/suite/domain/roundtrip.test.ts`
- Modify: `src/test/suite/webview/useIpCoreState.test.ts`

**Interfaces:**

- Uses `BusInterface.portPolarityOverrides?: Record<string, 'activeHigh' | 'activeLow'>` added in Task 1.
- Uses a private `InternalIpCoreState extends IpCoreState` with `pendingBusCanonicalization`; destructure that field out before returning the public hook result. This keeps the migration queue atomic with YAML state without exposing or serializing it.

- [ ] **Step 1: Write failing round-trip and hook tests**

Assert domain normalize/serialize preserves a valid override map.

Load commented legacy YAML with `useOptionalPorts: [read_n]`. Assert canonical in-memory `read` plus activeLow override, but byte-for-byte unchanged `rawYaml`.

- [ ] **Step 2: Verify tests fail**

```bash
npx jest --config config/jest.config.js src/test/suite/domain/roundtrip.test.ts src/test/suite/webview/useIpCoreState.test.ts --runInBand
```

Expected: FAIL because domain propagation and deferred migration are absent.

- [ ] **Step 3: Propagate the typed instance field**

Copy `portPolarityOverrides` in both `expandBusInterfaces` branches. Make `normalizeIpCore` preserve only a plain-object camelCase map; do not add a snake_case fallback.

- [ ] **Step 4: Canonicalize state without editing on open**

Add:

```ts
function canonicalizeParsedIpCore(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary | undefined
): {
  ipCore: Record<string, unknown>;
  mutations: readonly BusInterfacePortMutation[];
};
```

For recognized interfaces call `canonicalizeBusInterfacePorts`. Store canonical interfaces in `state.ipCore`, original text in `rawYaml`, and pending mutations in private internal hook state:

```ts
interface InternalIpCoreState extends IpCoreState {
  pendingBusCanonicalization: readonly BusInterfacePortMutation[];
}

const {
  pendingBusCanonicalization: _pendingBusCanonicalization,
  ...publicState
} = state;
```

In `updateIpCore` and `updateIpCoreBatch`, apply pending migration mutations first and the user mutation second inside one updater. Return `pendingBusCanonicalization: []` in the successful state object and reparse through the helper. Loading alone must not dirty or rewrite the document. Do not mutate a ref from inside a React state updater.

- [ ] **Step 5: Prove one format-preserving mutation**

After an unrelated edit, assert comments and hex spellings remain, aliases migrate, one state transition occurs, and pending mutations clear.

```bash
npx jest --config config/jest.config.js src/test/suite/webview/useIpCoreState.test.ts src/test/suite/domain/roundtrip.test.ts --runInBand
npm run type-check
npm run compile
```

Expected: PASS.

- [ ] **Step 6: Review unstaged output**

Run `git diff --check` and `git status --short`. Confirm the load-only test sends no migration edit.

---

### Task 4: Preserve Semantic Polarity and Literal Names in Structured Imports

**Files:**

- Modify: `src/shared/busContracts/observedPorts.ts`
- Modify: `src/parser/HwTclParser.ts`
- Modify: `src/parser/ComponentXmlParser.ts`
- Create: `src/test/suite/shared/busContractObservedPorts.test.ts`
- Modify: `src/test/suite/parser/HwTclParser.test.ts`
- Modify: `src/test/suite/parser/HwTclParser.altera.test.ts`
- Modify: `src/test/suite/parser/ComponentXmlParser.test.ts`
- Modify: relevant parser round-trip and IP-XACT integration tests

**Interface:**

```ts
interface ObservedBusPortSelections {
  useOptionalPorts?: string[];
  portNameOverrides?: Record<string, string>;
  portWidthOverrides?: Record<string, number>;
  portPolarityOverrides?: Record<string, PortPolarity>;
}
```

- [ ] **Step 1: Write failing structured-import tests**

Cover semantic role and physical spelling independently:

- semantic `byteenable_n`, physical `avs_byteenable` becomes canonical `byteenable`, activeLow, with literal name override `byteenable`;
- semantic `byteenable`, physical `avs_byteenable_n` becomes canonical `byteenable`, activeHigh, with literal name override `byteenable_n`;
- a conventional matching spelling avoids an unnecessary name override;
- if both roles are observed, the last observed role wins deterministically.

- [ ] **Step 2: Verify the focused tests fail**

```bash
npx jest --config config/jest.config.js src/test/suite/shared/busContractObservedPorts.test.ts src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts src/test/suite/parser/ComponentXmlParser.test.ts --runInBand
```

Expected: FAIL because reconciliation still treats role strings as independent canonical ports.

- [ ] **Step 3: Reconcile each observed port through the role matcher**

In `reconcileObservedBusPorts`, call `matchBusPortRole` and derive four properties independently:

1. canonical logical port name;
2. selected assertion polarity;
3. width override;
4. literal physical suffix override.

Use the imported logical role for polarity. Preserve the imported physical spelling exactly through `portNameOverrides` when it differs from the selected role's default suffix. Do not infer semantic polarity from the physical name when the source format already provides a logical role.

- [ ] **Step 4: Wire both structured parsers**

Make `_hw.tcl` and IP-XACT collection pass logical role and physical port name separately. Ensure all existing aliases, widths, prefixes, and optional-port selections survive reconciliation.

- [ ] **Step 5: Run focused and integration verification**

```bash
npx jest --config config/jest.config.js src/test/suite/shared/busContractObservedPorts.test.ts src/test/suite/parser/HwTclParser.test.ts src/test/suite/parser/HwTclParser.altera.test.ts src/test/suite/parser/ComponentXmlParser.test.ts --runInBand
npm run test:integration:parser-roundtrip -- --runInBand
npm run test:integration:ipxact -- --runInBand
```

Expected: PASS.

- [ ] **Step 6: Review unstaged output**

Run `git diff --check` and inspect the parser fixtures to confirm no imported literal name was normalized away.

---

### Task 5: Infer and Edit Polarity for Raw HDL Grouping

**Files:**

- Modify: `src/webview/ipcore/utils/busLibrary.ts`
- Modify: `src/webview/ipcore/utils/protocolMatcher.ts`
- Modify: `src/webview/ipcore/components/canvas/GroupingMappingStep.tsx`
- Modify: `src/webview/ipcore/components/canvas/MapConduitToBusDialog.tsx`
- Modify: `src/webview/ipcore/hooks/useGroupPorts.ts`
- Modify: `src/parser/VerilogParser.ts`
- Modify: `src/parser/VhdlParser.ts`
- Modify: `src/test/suite/webview/busLibrary.test.ts`
- Modify: `src/test/suite/components/MapConduitToBusDialog.test.tsx`
- Modify: `src/test/suite/webview/applyMapConduitToKnownBus.test.ts`
- Modify: `src/test/suite/parser/VerilogParser.test.ts`
- Modify: `src/test/suite/parser/VhdlParser.test.ts`

**Interfaces:**

```ts
interface BusPortDef {
  polarity?: NormalizedPortPolarity;
}

interface SignalAssignment {
  busPort: string;
  physicalPort: string;
  polarity: PortPolarity;
}
```

The grouping payload carries `portPolarityOverrides` keyed by canonical bus port name.

- [ ] **Step 1: Write failing raw-HDL matching tests**

Cover conventional `read_n` inference, a misleading literal name manually assigned as activeHigh, activeLow vector signals, and declarations where both `read` and `read_n` exist. In the last case select the contract default and leave the other HDL port ungrouped.

- [ ] **Step 2: Verify the focused tests fail**

```bash
npx jest --config config/jest.config.js src/test/suite/webview/busLibrary.test.ts src/test/suite/components/MapConduitToBusDialog.test.tsx src/test/suite/webview/applyMapConduitToKnownBus.test.ts src/test/suite/parser/VerilogParser.test.ts src/test/suite/parser/VhdlParser.test.ts --runInBand
```

Expected: FAIL because candidates are still independent ports and grouping has no polarity value.

- [ ] **Step 3: Generate candidates from declared roles**

Expose all declared role suffixes for matching, with the default role first. A matched role maps back to one canonical logical name plus its declared polarity. Do not synthesize undeclared `_n` variants for user-defined contracts.

When both roles match separate HDL ports, use the default role only and keep the second signal visible as ungrouped so the user can correct the ambiguity.

- [ ] **Step 4: Preserve the user's manual assignment**

Show the selected role/polarity in the mapping UI. A manual physical-port assignment keeps the chosen polarity even when its spelling suggests the opposite. Emit a polarity override only when the selected polarity differs from the contract default. Compare physical suffix against the selected role when deciding whether a `portNameOverrides` entry is needed.

- [ ] **Step 5: Run parser and grouping tests**

```bash
npx jest --config config/jest.config.js src/test/suite/parser/VerilogParser.test.ts src/test/suite/parser/VhdlParser.test.ts --runInBand
npx jest --config config/jest.config.js src/test/suite/webview/busLibrary.test.ts src/test/suite/components/MapConduitToBusDialog.test.tsx src/test/suite/webview/applyMapConduitToKnownBus.test.ts --runInBand
npm run type-check
```

Expected: PASS.

- [ ] **Step 6: Review unstaged output**

Run `git diff --check`. Confirm raw HDL inference is documented in code as best-effort and remains editable.

---

### Task 6: Project Canonical Ports into Generator and Vendor Artifacts

**Files:**

- Modify: `src/generator/registerProcessor.ts`
- Modify: `src/generator/resolvers/bus.ts`
- Modify: `src/generator/types.ts`
- Modify: `src/generator/contract/template_context.schema.json`
- Modify generated: `src/generator/contract/templateContext.types.ts`
- Modify: `src/generator/contract/version.ts`
- Modify: `src/generator/templates/altera_hw_tcl.j2`
- Modify: `src/generator/VivadoComponentXmlGenerator.ts`
- Modify: `src/generator/VivadoCustomBusDefinitions.ts`
- Modify: `src/generator/validation/hdlCrossCheck.ts`
- Modify: `src/shared/busPortNameSet.ts`
- Modify: focused resolver, generator, vendor-artifact, cross-check, and name-set tests

**Resolved fields:**

```ts
interface ResolvedBusPort {
  interfaceRole: string;
  effectivePolarity: PortPolarity;
  physicalSuffix: string;
  needsPolarityInversion: boolean;
}

interface ProjectedBusPort {
  canonicalName: string;
  name: string;
  interfaceRole: string;
  effectivePolarity?: PortPolarity;
  direction: 'in' | 'out';
  svDirection: 'input' | 'output';
  type: string;
  svType: string;
  width: number | string | null;
  widthExpr: string | null;
  isParameterized: boolean;
  tclWidth: string;
  endianness: 'little' | 'big';
  needsSwap: boolean;
  swapKind?: 'lane' | 'bit';
  laneWidth?: number | string;
  laneKind?: 'byte' | 'symbol';
  needsPolarityInversion: boolean;
}
```

The template context exposes the same data as `interface_role`, `effective_polarity`, `physical_suffix`, and `needs_polarity_inversion`.

- [ ] **Step 1: Write failing projection tests**

Assert:

- canonical `byteenable` activeLow emits logical vendor role `byteenable_n`;
- default physical suffix becomes `byteenable_n`;
- literal `portNameOverrides.byteenable: byteenable` wins over that suffix;
- widths and parameterized widths are unchanged;
- cross-check accepts the resolved physical name and does not require the inactive role.

- [ ] **Step 2: Verify the focused tests fail**

```bash
npx jest --config config/jest.config.js -t 'interface role|physical suffix|polarity inversion|byteenable_n' --runInBand
```

Expected: FAIL because projection conflates canonical name, vendor role, and physical suffix.

- [ ] **Step 3: Add one canonical projection path**

Add:

```ts
function projectResolvedBusPorts(
  ports: readonly ResolvedBusPort[],
  physicalPrefix: string,
  parameters?: Readonly<Record<string, number>>
): ProjectedBusPort[];
```

Use it for generator context, vendor metadata, HDL cross-check, and expected-name construction. Keep unresolved conduit projection separate. Resolve names only through `resolvePhysicalSuffix`; `portNameOverrides` always wins literally.

- [ ] **Step 4: Emit selected vendor roles**

Use `interfaceRole` for `_hw.tcl` port roles and IP-XACT logical mappings. Update custom Vivado bus definitions to declare all configured role strings while each component instance maps only its selected role.

- [ ] **Step 5: Extend and regenerate the template contract**

Add the polarity fields to the template-context schema, bump `CONTRACT_VERSION` from `1.3.0` to `1.4.0`, then run:

```bash
npm run generate-types
npm run compile
```

Expected: generated types and both bundles compile.

- [ ] **Step 6: Run focused tests and review**

```bash
npx jest --config config/jest.config.js -t 'bus resolver|Altera|Vivado|HDL cross-check|bus port name' --runInBand
git diff --check
```

Expected: PASS, with all selected roles and literal physical names preserved.

---

### Task 7: Insert Polarity Conversion at the HDL Boundary

**Files:**

- Create: `src/generator/resolvers/boundaryTransforms.ts`
- Create: `src/test/suite/generator/resolvers/boundaryTransforms.test.ts`
- Modify: `src/generator/resolvers/bus.ts`
- Modify: `src/generator/types.ts`
- Modify: `src/generator/contract/template_context.schema.json`
- Modify generated: `src/generator/contract/templateContext.types.ts`
- Modify affected HDL wrapper/scaffolder templates
- Modify relevant scaffolder snapshots and HDL integration tests

**Interface:**

```ts
interface BoundaryTransformPort {
  name: string;
  internalName: string;
  direction: 'in' | 'out' | 'inout';
  type: string;
  svType: string;
  width: number | string | null;
  widthExpr: string | null;
  isParameterized: boolean;
  invert: boolean;
  swapKind?: 'lane' | 'bit';
  laneWidth?: number | string;
  laneKind?: 'byte' | 'symbol';
}

function buildBoundaryTransforms(
  ports: readonly ProjectedBusPort[],
  reservedNames: ReadonlySet<string>
): {
  ports: readonly BoundaryTransformPort[];
  internalNames: ReadonlySet<string>;
};
```

- [ ] **Step 1: Write failing pure transform tests**

Cover scalar input/output inversion, vector bitwise inversion, parameterized widths, name collisions, endian swap only, and combined swap plus inversion. Assert only one intermediate signal is allocated per transformed port.

- [ ] **Step 2: Verify the pure tests fail**

```bash
npx jest --config config/jest.config.js src/test/suite/generator/resolvers/boundaryTransforms.test.ts --runInBand
```

Expected: FAIL because the focused resolver does not exist.

- [ ] **Step 3: Build cohesive boundary-transform data**

Move transform planning out of the already-large bus resolver. Keep canonical internal behavior activeHigh. Mark a selected activeLow port for boundary inversion. Compose inversion with existing lane/endian reordering through a single internal signal; bitwise inversion and bit reordering commute, so templates may use the order that avoids duplicated loops.

Allocate an intermediate only when `needsSwap || needsPolarityInversion`. Use `${name}_be` as the preferred base when a swap is present (preserving current generated names), otherwise `${name}_inv`; append `_2`, `_3`, and so on through the existing reserved-name policy until unique.

- [ ] **Step 4: Render VHDL and SystemVerilog correctly**

Use VHDL `not` and SystemVerilog bitwise `~`, never logical `!` for vectors. For inputs, drive the canonical internal signal from the transformed external signal. For outputs, drive the external signal from the transformed canonical internal signal. Preserve existing endian-loop semantics and widths. `inout` remains legal for standalone user ports but is never polarity-configurable.

Expose `boundary_transform_ports` and `has_boundary_transform` in the template contract while retaining existing endian fields until every template consumer has migrated in the same task.

- [ ] **Step 5: Update snapshots and run HDL verification**

```bash
npx jest --config config/jest.config.js src/test/suite/generator/resolvers/boundaryTransforms.test.ts --runInBand
npm run test:integration:snapshots -- --runInBand
npm run test:integration:hdl
```

Expected: PASS. Inspect at least one generated activeLow scalar and one vector wrapper in each supported HDL.

- [ ] **Step 6: Review unstaged output**

Run `git diff --check` and confirm generated ports retain their literal external names while only internal signals use canonical activeHigh semantics.

---

### Task 8: Add Polarity Controls to the Inspector and Canvas

**Files:**

- Modify: `src/webview/ipcore/hooks/useBusContractEditor.ts`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/BusContractFields.tsx`
- Modify: `src/webview/ipcore/components/canvas/inspector/buses/BusPanel.tsx`
- Modify: `src/webview/ipcore/components/canvas/canvasLayout.ts`
- Modify: `src/webview/ipcore/components/canvas/CanvasBusSubPort.tsx`
- Modify: relevant canvas CSS
- Modify: `src/webview/ipcore/components/canvas/IpBlockCanvas.tsx`
- Modify: `src/test/suite/webview/useBusContractEditor.test.ts`
- Modify: `src/test/suite/components/CanvasInspector.BusContractFields.test.tsx`
- Modify: `src/test/suite/webview/canvasLayout.test.ts`
- Modify: `src/test/browser/subport-click-toggle.spec.ts`

**Editor model:**

```ts
interface EditablePolarityField {
  name: string;
  value: PortPolarity;
  defaultValue: PortPolarity;
  active: boolean;
  error?: string;
}

interface BusContractEditModel {
  polarities: readonly EditablePolarityField[];
}
```

The hook exposes `updatePolarity(portName, polarity)`. `LayoutSubPort` carries `polarity` and `polarityConfigurable`.

- [ ] **Step 1: Write failing hook and canvas tests**

Assert configurable active ports expose an Active high/Active low selector, returning to the default removes the override, inactive ports show the chosen setting without activating themselves, and fixed-polarity ports expose no selector.

Assert the canvas shows one canonical port with an `H` or `L` badge and never displays both role aliases.

- [ ] **Step 2: Verify focused tests fail**

```bash
npx jest --config config/jest.config.js -t 'BusContractFields|polarity|canvas sub-port' --runInBand
```

Expected: FAIL because the editor and layout do not expose polarity.

- [ ] **Step 3: Add narrow editor and layout data**

Derive fields from the normalized contract, not from hard-coded Avalon names. The selector writes `portPolarityOverrides` only for a nondefault choice and deletes the key when restored to default. Preserve overrides for temporarily inactive optional ports.

Keep `IpBlockCanvas` focused on activation routing; put label/badge rendering in `CanvasBusSubPort` and edit construction in the hook.

- [ ] **Step 4: Make activation canonical**

All activation and optional-port deduplication uses canonical logical names. Activating `read` must not remove `write`; changing polarity must not change activation. Remove every remaining `portsMutuallyExclusive` branch and test.

- [ ] **Step 5: Add browser regressions**

Cover:

- `read` activeLow and `write` activeHigh coexisting;
- default derived physical names;
- an imported literal physical-name override;
- an unrelated Avalon-MM port remaining active;
- another interface instance remaining unchanged;
- emitted YAML containing only canonical selections plus polarity overrides.

Use unique selectors for names where one is a prefix of another.

- [ ] **Step 6: Run UI verification**

```bash
npx jest --config config/jest.config.js -t 'BusContractFields|useBusContractEditor|canvas|polarity' --runInBand
npm run test:browser -- --grep 'polarity|active low|canonical bus port'
```

Expected: PASS.

- [ ] **Step 7: Review unstaged output**

Run `git diff --check`. Confirm keyboard/mouse table-editor behavior is untouched and the canvas root did not absorb contract-editing logic.

---

### Task 9: Prove Compatibility and Complete the Branch

**Files:**

- Modify or add only narrowly-scoped compatibility tests discovered during the final audit
- Do not stage or commit

- [ ] **Step 1: Add a final table-driven compatibility test**

Cover all five built-in Avalon-MM canonical ports and aliases:

| Canonical | activeHigh role | activeLow role |
|---|---|---|
| `byteenable` | `byteenable` | `byteenable_n` |
| `readdatavalid` | `readdatavalid` | `readdatavalid_n` |
| `waitrequest` | `waitrequest` | `waitrequest_n` |
| `read` | `read` | `read_n` |
| `write` | `write` | `write_n` |

For legacy arrays with both aliases, assert the last occurrence wins. Cover main-compatible activeHigh documents, new activeLow documents, arbitrary imported literal names, and unsupported interfaces remaining unchanged.

- [ ] **Step 2: Audit stale mutual-exclusion code and accidental dual representations**

```bash
rg -n "portsMutuallyExclusive|NormalizedMutuallyExclusive|mutually-exclusive|busContractActivePorts" src ipcraft-spec/schemas ipcraft-spec/bus_definitions
rg -n "byteenable_n|readdatavalid_n|waitrequest_n|read_n|write_n" src ipcraft-spec/bus_definitions
rg -n "port_polarity|polarity_override|portPolarityOverrides.*port_polarity" src ipcraft-spec
```

Expected: the first and third searches return no implementation leftovers; alias hits in the second are limited to role declarations, fixtures, compatibility tests, and generated/vendor expectations.

- [ ] **Step 3: Prove generation is idempotent**

Run `npm run generate-types`, record the generated-file hashes or diff, run it again, and assert the second run produces no new diff. Then run:

```bash
npm run type-check
npm run compile
```

Expected: PASS.

- [ ] **Step 4: Run the focused unit suite**

```bash
npx jest --config config/jest.config.js src/test/suite/shared src/test/suite/parser src/test/suite/generator src/test/suite/domain src/test/suite/webview --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run repository gates**

```bash
npm run lint
npm run test:unit -- --runInBand
npm run test:browser
npm run test:integration:snapshots -- --runInBand
npm run test:integration:parser-roundtrip -- --runInBand
npm run test:integration:ipxact -- --runInBand
npm run test:integration:hdl
```

Expected: PASS. Report any environment-gated Vivado/Quartus tests separately; do not describe them as passing if skipped.

- [ ] **Step 6: Inspect the final unstaged change**

```bash
git diff --check
git status --short
git diff --stat
git -C ipcraft-spec status --short
```

Verify no files are staged, no commit was created, the submodule diff contains schema/definition/documentation changes, and unrelated user changes are untouched.
