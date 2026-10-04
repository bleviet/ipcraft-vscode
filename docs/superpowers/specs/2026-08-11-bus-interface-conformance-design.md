# Bus Interface Conformance Design

**Status:** Approved and implemented. The implementation plan is
`docs/superpowers/plans/2026-08-11-bus-interface-conformance.md`.

**Writing style:** This document follows the writing rules of ASD-STE100
Simplified Technical English: short sentences, one idea in each sentence,
active voice, and one term for each concept. It does not use the STE
dictionary, because the design needs software terms that the dictionary does
not contain.

## Summary

- Each bus definition in `ipcraft-spec` declares a **contract**. The contract
  gives the rules for port widths, port presence, interface modes, and
  interface properties.
- One pure TypeScript module reads the contracts and checks each bus
  interface. The editor, the importers, the generators, and the checker all
  use this module.
- The webview does not keep its own copy of the bus definitions.
- IPCraft shows each problem as a **diagnostic**. A diagnostic has a stable
  code, a severity, and the YAML path of the problem.
- Errors stop generation and export. Errors also stop an importer from
  writing a file. Errors do not stop the user from saving a `.ip.yml` file.
- Avalon-ST keeps its symbol properties (`dataBitsPerSymbol`,
  `symbolsPerBeat`, `readyLatency`) through `_hw.tcl` and IP-XACT import and
  export.

## Terms

| Term                          | Meaning                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Bus definition                | A YAML entry in `ipcraft-spec/bus_definitions/` that lists the ports of one bus type.                      |
| Contract                      | The `contract` section of a bus definition. It contains the conformance rules.                             |
| Built-in bus                  | One of the five bus types that IPCraft ships: AXI4-Lite, AXI4 Full, AXI4-Stream, Avalon-MM, and Avalon-ST. |
| Custom bus                    | A bus definition that a project supplies.                                                                  |
| VLNV                          | The `vendor:library:name:version` identifier of a bus type.                                                |
| Canonical VLNV                | The one VLNV that identifies a contract.                                                                   |
| Alias                         | A different spelling that IPCraft maps to a canonical VLNV, for example `AXI4L`.                           |
| Root width                    | A port width that the user selects, for example `TDATA`.                                                   |
| Derived width                 | A port width that IPCraft calculates from other values, for example `TKEEP = TDATA / 8`.                   |
| Fixed width                   | A port width that the protocol sets, for example `TVALID = 1`.                                             |
| Interface property            | A protocol value that is not a signal, for example `dataBitsPerSymbol`.                                    |
| Producer mode / consumer mode | The two sides of an interface: `master`/`slave` for AXI and Avalon-MM, `source`/`sink` for Avalon-ST.      |
| Interface kind                | `memoryMapped`, `streaming`, or `conduit`.                                                                 |
| Diagnostic                    | One reported problem, with a code, a severity, and a YAML path.                                            |
| Known error                   | A diagnostic that proves the interface is not correct.                                                     |
| Unresolved                    | IPCraft cannot prove that the interface is correct or not correct.                                         |

## 1. Problem

IPCraft knows the signals and default widths of its built-in buses. It does
not know the rules that connect those signals. The result:

- `portWidthOverrides` accepts any integer or string.
- JSON Schema validation checks only the shape of the document.
- HDL and vendor checks compare the document with other files. They do not
  check that the interface itself is legal.

Thus, these incorrect documents pass validation today:

- an AXI4-Lite interface with 8-bit data;
- an AXI4-Stream interface where the `TKEEP` width does not agree with the
  `TDATA` width.

The `_hw.tcl` importer also loses Avalon-ST properties, for example
`dataBitsPerSymbol`, `symbolsPerBeat`, and `readyLatency`.

The webview has hard-coded copies of the built-in bus definitions. These
copies do not agree with `ipcraft-spec`. Thus, the extension, the editor, the
importer, and the generator do not use one protocol authority.

When we remove the copies, the canvas changes in ways that the user can see.
For example, the canonical Avalon-MM YAML:

- marks `clk` and `reset` as optional;
- has eight ports that the webview table does not have: `byteenable_n`,
  `debugaccess`, `lock`, `writeresponsevalid`, `readdatavalid_n`,
  `waitrequest_n`, `read_n`, and `write_n`;
- does not have the webview-only port `chipselect`.

The implementation must make these changes on purpose and test them.

## 2. Goals

- Make `ipcraft-spec` the only source of the five built-in contracts.
- Map short aliases and foreign vendor VLNVs to a canonical VLNV through data
  in the bus definition. Do this before the contract lookup.
- Write the common width, presence, and property rules as data. Do not write
  them as protocol-specific code in many TypeScript files.
- Check the same interface in the same way in the editor, the checker, the
  importers, the generators, the exporters, and CI.
- Keep valid parameterized interfaces valid. Tell the user when a width is
  proved, unresolved, or incorrect.
- Keep Avalon-ST symbol properties through `_hw.tcl` import, `.ip.yml`,
  `_hw.tcl` generation, and custom IP-XACT packaging.
- Show each diagnostic at its location: on the canvas, in the Inspector, and
  in one Issues panel.
- Give AI agents a short orientation text that points to a full reference and
  to the machine-readable rules.
- Let custom buses use the same rule vocabulary.

## 3. Non-goals

This design does not:

- check the behavior of the RTL at run time, for example handshake
  stability, transaction order, burst legality, or timing;
- add a general expression language or a script language to bus
  definitions;
- repair incorrect documents automatically;
- change the protocol of an interface during import or export;
- convert Avalon-ST into AXI4-Stream;
- generate an Avalon-ST-to-AXI4-Stream adapter;
- replace vendor protocol checkers or simulation assertions.

## 4. Selected approach

The bus-definition YAML gets a small, versioned contract model. One pure
TypeScript resolver and validator reads this model.

We did not select these two alternatives:

- **One TypeScript validator for each protocol.** This is easy to start.
  But it copies policy into many places, and custom buses cannot add rules
  without a code change. The importer, the UI, and the generator can also
  start to behave differently.
- **A general constraint expression language.** This is flexible. But it
  adds parser, security, diagnostic, and compatibility problems that the
  required rules do not need.

## 5. Ownership and dependency direction

Dependencies go in one direction only:

```text
ipcraft-spec bus definitions and schemas
  -> pure contract types, normalizer, width resolver, and validator
  -> load, import, check, and generation services
  -> hooks and typed message builders
  -> components and application roots
```

### 5.1 What `ipcraft-spec` owns

- the bus-definition JSON Schema (written by hand);
- the five built-in bus-definition YAML files;
- the short aliases and foreign-VLNV aliases of the built-ins;
- the port roles, the interface modes, and the interface kind of each bus;
- the interface-property declarations;
- the width policy (root, derived, or fixed) of each port;
- the constraints and their stable rule IDs;
- the human-readable bus-interface conformance reference.

### 5.2 What the extension owns

`BusLibraryService` finds the bus-definition files and applies their
precedence. It validates and normalizes the built-in and workspace
definitions into one typed `BusDefinitionContract` library. The extension
sends this normalized library to the webview through the existing message
channel. The webview does not receive the raw files.

### 5.3 Schema and generated types

The file `ipcraft-spec/schemas/bus_definition.schema.json` is written by hand
as JSON Schema. (The submodule has generated Pydantic artifacts, but no
Python model to extend.) `npm run generate-types` generates
`src/domain/busDefinition.types.ts` from this schema. The build copies the
schema into the package with the other resource schemas.

### 5.4 The pure conformance module

The conformance module must not depend on VS Code, React, the file system,
generator templates, or components.

- **Inputs:** one bus contract, one interface declaration, the active ports,
  the effective parameter values, and resolution options.
- **Outputs:** resolved port widths, resolved interface properties, and
  structured diagnostics.

### 5.5 Webview changes

Remove the hard-coded bus-definition tables from the webview. `IpCoreApp`
receives the runtime library. It gives narrow lookup and validation functions
to hooks and components. Thus, protocol matching, port grouping, layout, the
Inspector, import preview, and generation all use the same definitions.

`HwTclParser` must stop importing `lookupBusDef` from the webview directory.
The parser, the generator, and the webview all use the shared contract lookup
instead. This restores the correct dependency direction.

## 6. The contract model

### 6.1 Interface properties in `.ip.yml`

`BusInterface` gets an optional camelCase field, `interfaceProperties`. It
holds protocol values that are not signals:

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

- `portWidthOverrides` gives the width of physical ports.
- `interfaceProperties` gives protocol meaning.
- A property value can refer to a parameter if the property declaration
  permits it. The syntax is the same width-expression subset that IPCraft
  parameters use.

Property names are different for each contract. Thus, `ip_core.schema.json`
checks only the object shape and the value types. It cannot list the valid
keys. The conformance validator does the key check:

- **Known contract:** an unknown key is an error. The diagnostic lists the
  valid keys.
- **Unknown VLNV, or a legacy custom definition with no contract:** IPCraft
  keeps the map as it is and does not check it.

### 6.2 Endianness

`BusInterface.endianness` is the only `.ip.yml` field for lane order. Do not
store the Avalon-ST property `firstSymbolInHighOrderBits` in
`interfaceProperties`. It is only the vendor spelling of `endianness`:

- Importers map `firstSymbolInHighOrderBits` to `endianness`.
- Altera generation maps `endianness` to `firstSymbolInHighOrderBits`.

The lane size depends on the protocol:

| Interface                      | Lane size                |
| ------------------------------ | ------------------------ |
| AXI, Avalon-MM                 | 8 bits                   |
| Avalon-ST                      | `dataBitsPerSymbol` bits |
| Standalone port (not in a bus) | 8 bits                   |

For example, an Avalon-ST interface with 1-bit symbols reverses 1-bit symbol
lanes. It does not reverse groups of 8 bits.

**Compatibility change.** Today, the generator and the canvas treat all data
as 8-bit lanes. Thus, a 5-bit, big-endian stream with 1-bit symbols gets no
reordering. After this change, IPCraft reverses the five 1-bit lanes.

The implementation must:

- put the swap unit (the lane width) explicitly in the template context;
- not reuse the byte-only `needsByteSwap` decision;
- keep the standalone-port helper `portEndiannessApplies` byte-oriented;
- use the resolved contract and symbol width for Avalon-ST bus controls and
  diagnostics.

### 6.3 Contract version

The bus-definition schema knows contract version 1.

- The `contract` section is optional, so legacy custom definitions stay
  valid.
- Repository tests require that each of the five built-ins has a complete
  version-1 contract.
- IPCraft rejects a malformed contract when it loads the library.
- A malformed custom definition is removed from the library. IPCraft reports
  it with its source file and schema path. It must not stop the editor, and it
  must not change a built-in definition.

### 6.4 Port width policies

Each port that has a width has one of three policies:

| Policy    | Meaning                                                      | Examples                                          |
| --------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `root`    | The user selects the width.                                  | AXI4-Stream `TDATA`, Avalon-ST `data`             |
| `derived` | IPCraft calculates the width from a root port or a property. | `TKEEP`, `WSTRB`, Avalon-ST `empty`               |
| `fixed`   | The protocol sets a constant width.                          | `VALID`, `READY`, AXI response and control fields |

A derived width uses a named operation with typed operands. Version 1 has
only the operations that the built-ins need:

- copy the width of a different port;
- multiply or divide a port width or property by a positive integer;
- multiply two properties;
- `ceil(log2(value))`;
- the number of bits necessary to encode a declared maximum value;
- the maximum value that a port width can encode (`2^width - 1`).

This is not a general expression language. When IPCraft normalizes a
contract, it rejects:

- unknown operations;
- missing operands;
- division by zero;
- circular derivations;
- references to ports or properties that the contract does not declare.

Rules for explicit overrides:

- An override of a **derived** port is valid only if it is equal to the
  calculated width. IPCraft accepts it for compatibility.
- An override of a **fixed** port is an error, unless it is equal to the
  fixed width.
- IPCraft keeps a redundant override that has the correct value. It removes
  that override only when the user changes the related root value. Section
  11 gives this rule.
- IPCraft never changes a document when it loads it.

### 6.5 Interface property declarations

A contract can declare interface properties. Each declaration can give:

- a type: `integer`, `boolean`, or `string`;
- a default value;
- a minimum and a maximum;
- a list of allowed values;
- a port that makes the property required when that port is active;
- a rule to calculate the property from active port widths and other
  properties when the user does not give it.

Avalon-ST version 1 declares at least `dataBitsPerSymbol`, `symbolsPerBeat`,
`readyLatency`, and `maxChannel`. It does not declare
`firstSymbolInHighOrderBits`, because `endianness` holds that value (see
6.2). Later versions can add properties, for example error descriptions,
without new constraint kinds.

### 6.6 Port roles

Each built-in port has exactly one role:

| Role            | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `clock`         | A clock association port. The canvas can hide it.                              |
| `reset`         | A reset association port. The canvas can hide it.                              |
| `data`          | A payload. Its lane order is important.                                        |
| `byteQualifier` | A mask with one bit for each data lane. It follows the lane order of the data. |
| `control`       | All other protocol signals.                                                    |

Rules:

- The normalizer gives all consumers one `role` field. There is no separate
  `endianRole` field.
- A legacy custom port with no role becomes `control`.
- A workspace port with an unknown role also becomes `control`. IPCraft
  reports the warning `BUS_DEF_UNKNOWN_PORT_ROLE` with the source file and
  the document path, for example `["ports", 3, "role"]`. The definition stays
  on the canvas, because a spelling error in a role is not a serious
  problem.
- Thus, the schema checks only that `role` is a non-empty string. The
  normalizer knows the role vocabulary.
- Repository tests require a known, explicit role on every built-in port.
  A role warning from a built-in is a test failure.

The five built-ins mark `clk`/`ACLK` as `clock`, `reset`/`ARESETn` as
`reset`, and all other ports with their correct roles.

### 6.7 Interface modes

Each contract declares its producer mode, its consumer mode, and the mode
aliases that it accepts:

| Bus                                     | Producer | Consumer | Aliases                               |
| --------------------------------------- | -------- | -------- | ------------------------------------- |
| AXI4, AXI4-Lite, AXI4-Stream, Avalon-MM | `master` | `slave`  | none                                  |
| Avalon-ST                               | `source` | `sink`   | `master` = `source`, `slave` = `sink` |

Rules:

- For a legacy Avalon-ST document, IPCraft changes `master` to `source` and
  `slave` to `sink` in memory only. It does not change the file when the
  user opens it.
- New imports and new UI interfaces write `source` or `sink` for Avalon-ST.
- Port directions in a definition are given for the producer mode. IPCraft
  reverses them for the consumer mode.
- IPCraft evaluates presence rules after it normalizes the mode.
- A mode that is not a canonical mode or a declared alias is an error.

### 6.8 Interface kind and memory maps

Each version-1 contract declares one `interfaceKind`: `memoryMapped`,
`streaming`, or `conduit`. IPCraft uses this value. It does not guess the
kind from the protocol name.

An interface can have a `memoryMapRef`, and can be the target of an
interrupt association, only if all of these conditions are true:

- the interface is not an array;
- its contract is `memoryMapped`;
- its normalized mode is the consumer mode of the contract.

A custom bus gets this behavior when it declares a version-1
`memoryMapped` contract. IPCraft does not think that an unknown VLNV or a
legacy custom definition with no contract is memory-mapped.

If an interface has `memoryMapRef` and one of these conditions is not true,
the validator reports the error `BUS_MEMORY_MAP_UNSUPPORTED` at the
`memoryMapRef` path of that interface. This also applies when the contract
lookup fails. Generation must stop before address and register-file
resolution. It must not use a default data width or skip the register file.

### 6.9 Constraint vocabulary

Version 1 has named constraints for:

- a numeric range, a list of allowed values, and an integer multiple;
- equal port widths;
- quotient, product, and `ceil(log2())` relations;
- port presence dependencies (port A needs port B);
- a property that is required when a port is present;
- recommendations: preferred shapes that the protocol does not require.

Each constraint has a stable `ruleId`, a default diagnostic code, a severity,
and a message template. The severity follows this rule:

- A protocol violation is an **error**.
- A standard or ecosystem preference that the protocol does not require is
  a **warning**.

This is an example definition:

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

The bus-definition JSON Schema sets these field names and the operand shape
of each `kind` and `operation`. The implementation does not accept other
spellings or untyped operand objects.

## 7. Built-in rules

Contract version 1 checks these static rules.

### 7.1 AXI4-Lite

- `WDATA` and `RDATA` have the same width. The width is 32 or 64 bits.
- `WSTRB` width is `WDATA / 8`.
- The write and read address widths are the same.
- Single-bit handshake and control ports are fixed.
- `AWPROT` and `ARPROT` are 3 bits. `BRESP` and `RRESP` are 2 bits.
- The user cannot remove required read-channel or write-channel ports from
  the built-in AXI4-Lite definition.

### 7.2 AXI4 Full

- The data width is a power of two from 8 to 1024 bits.
- `WDATA` and `RDATA` have the same width.
- `WSTRB` width is `WDATA / 8`.
- `BID` width is equal to `AWID` width. `RID` width is equal to `ARID`
  width.
- Burst, size, lock, cache, protection, quality-of-service, response, last,
  and handshake fields have their protocol widths.
- A response port or a sideband port cannot be active without the channel
  that it qualifies.

### 7.3 AXI4-Stream

- `TDATA` is a positive multiple of 8 bits.
- If `TKEEP` is active, its width is `TDATA / 8`. The same rule applies to
  `TSTRB`.
- `TVALID`, `TREADY`, and `TLAST` are 1 bit.
- A data width that is a power-of-two number of bytes, from 8 to 1024 bits,
  is a recommendation (warning). It is not a requirement.
- Optional sideband ports keep their declared fixed or configurable policy.

### 7.4 Avalon-MM

- The active read-data and write-data ports have the same width.
- The data width is a multiple of 8, a power of two, and 1024 bits or less.
- `byteenable` width is the data width divided by 8.
- Read/write control, wait, response-valid, and response fields keep their
  defined widths.
- IPCraft checks address-unit and byte-enable relations when the contract
  has sufficient data. Dynamic behavior and address translation are out of
  scope.

### 7.5 Avalon-ST

- The `data` width is equal to `dataBitsPerSymbol * symbolsPerBeat`.
- `dataBitsPerSymbol` and `symbolsPerBeat` are positive. They do not have to
  be powers of two.
- If a legacy document does not give them:
  - `dataBitsPerSymbol` is 8;
  - `symbolsPerBeat` is the data width divided by `dataBitsPerSymbol`, if
    the division has no remainder.
- An explicit property has priority over a default. It must still agree with
  the data-width product.
- If `empty` is active:
  - its width is `ceil(log2(symbolsPerBeat))`;
  - `symbolsPerBeat` must be more than 1;
  - packet support is necessary: `empty` needs `endofpacket`.
- `startofpacket` and `endofpacket` are active together or not at all.
- `readyLatency` is an integer, 0 or more. It is applicable when `ready` is
  active.
- If `channel` is active and `maxChannel` is not given, `maxChannel` is the
  largest value that the channel width can hold (`2^channelWidth - 1`). An
  explicit `maxChannel` must be 0 or more and must fit in the channel width.
- Each signal width stays in the range that the contract declares.

These symbol rules follow the current Altera Avalon specification. It defines
`dataBitsPerSymbol` and `symbolsPerBeat` independently, and it does not
require a power-of-two symbol size:
<https://docs.altera.com/r/docs/683091/22.3/avalon-interface-specifications/synchronous-interface>.

## 8. How IPCraft resolves an interface

### 8.1 Find the contract

IPCraft finds the contract for an interface type in this order. The first
match wins.

1. An exact canonical VLNV (built-in or custom) selects its contract.
2. A declared short alias, for example `AXI4L`, maps to its canonical VLNV.
   IPCraft removes leading and trailing spaces and ignores letter case.
3. A structured foreign-VLNV alias matches the vendor, the library, and the
   name exactly. The version must be equal to the declared version, or the
   declared version must be the wildcard `"*"`.
4. If nothing matches, the VLNV is unknown and has no contract. IPCraft
   still runs the schema, structure, and HDL checks. The missing contract
   alone does not stop generation.

IPCraft never uses substring tests, for example "the type contains `axi`",
to make a protocol or conformance decision. To add an alias, change the bus
definition data. Do not add code.

**The alias list is a compatibility boundary.** Before the implementation
removes the old open-ended matchers, it must record every spelling that the
old code accepts. The sources are `busVlnv.test.ts`, `busDefinitions.test.ts`,
and the branches of `lookupBusDef`. They include the tested foreign Avalon
VLNVs and the short spellings `AXI4L`, `AXI4F`, `AXIS`, `AXI4S`,
`AVALON_MM`, `avalon_memory`, and their underscore and hyphen forms.

The canonical lookup and the resolved `interfaceKind` replace this old
logic:

- the substring test `busSupportsMemoryMap` in `src/shared/busVlnv.ts`;
- `busSupportsInterruptAssociation`, which uses `busSupportsMemoryMap`;
- the hard-coded `BusRuleRegistry.isMemoryMapped` classification;
- the separate alias logic in the webview and the generator.

Small helper functions can stay. They must use resolved contract data, not
the raw type string.

The migration also removes the literal `mode === "slave"` tests from:

- `src/generator/resolvers/addressing.ts`;
- `getBusTypeForTemplate` and `hasMemoryMappedSlaveInterface` in
  `src/generator/registerProcessor.ts`.

These places compare the mode with the consumer mode of the resolved
contract. Thus, the generator does not skip a custom memory-mapped bus that
uses a different mode name.

### 8.2 Calculate the effective widths

For each active port, IPCraft does these steps in this order:

1. Read the width and the width policy from the bus definition.
2. Apply the matching `portWidthOverrides` value, if there is one.
3. Resolve parameter references with the existing `widthExprAst` parser and
   evaluator.
4. Evaluate the parameter defaults and the declared `allowedValues`
   (see 8.4).
5. Resolve property defaults and derived properties.
6. Resolve derived port widths.
7. Apply the presence and conformance constraints.

### 8.3 Resolution states

Each resolved value has one of four states:

| State        | Meaning                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `concrete`   | The value is a known positive integer.                                                                 |
| `symbolic`   | The value is an expression, and IPCraft can prove the required relation from the expression structure. |
| `unresolved` | The declaration does not have sufficient data for a proof.                                             |
| `invalid`    | The expression, override, derivation, or constraint is not legal.                                      |

Rules for parameterized interfaces:

- IPCraft accepts two equivalent expressions if the syntax tree proves that
  they are equal.
- Each concrete default and each declared allowed value must conform.
- If the default conforms, but IPCraft cannot prove the rule for all other
  parameter values, the validator reports a warning. It does not reject a
  valid parameterized IP.
- If no conforming default exists and IPCraft cannot prove the rule, the
  user can still edit the document. Generation and export stop.

### 8.4 Limit on allowed-value checks

IPCraft checks allowed values for each constraint separately, not for the
full IP:

1. Find the parameters that the constraint uses.
2. Make all combinations of their allowed values.
3. If there are 256 combinations or fewer, check all of them.
4. If there are more than 256, stop. Report `unresolved` with the code
   `CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE`.

IPCraft never checks a random sample and never treats an unchecked domain as
proved. This limit keeps the check correct for rules with many parameters,
and it keeps the time to check small.

Version 1 does not generate elaboration-time assertions for parameter values
that a user sets outside IPCraft. The diagnostic tells the user when IPCraft
checked only the declared default and the allowed values.

## 9. Diagnostics and enforcement

### 9.1 Diagnostic shape

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

The array `path` identifies the location. IPCraft uses it for YAML edits,
canvas selection, Inspector focus, removal of duplicates, and future quick
fixes. The UI can show the path as a dotted string. Code must never parse a
displayed string back into a path.

Examples:

```text
AXI4L_DATA_WIDTH
["busInterfaces", 0, "portWidthOverrides", "WDATA"]
AXI4-Lite WDATA must be 32 or 64 bits; received 24.

AVALON_ST_EMPTY_WIDTH
["busInterfaces", 1, "portWidthOverrides", "empty"]
empty must be ceil(log2(symbolsPerBeat)); expected 2, received 1.
```

### 9.2 Enforcement policy

| Where                             | Known error           | Unresolved rule       | Recommendation |
| --------------------------------- | --------------------- | --------------------- | -------------- |
| YAML and canvas edit              | Show error            | Show warning          | Show warning   |
| Save `.ip.yml`                    | Allow                 | Allow                 | Allow          |
| Import result                     | Do not write          | Write, with a warning | Allow          |
| HDL generation and export         | Stop before any write | Stop before any write | Allow          |
| Explicit consistency check and CI | Fail                  | Fail                  | Report only    |

Rules:

- The validation layer never changes a value. An editor command can offer an
  atomic fix, but only the user can start it.
- An importer does not change an incorrect standard interface. It does not
  change the VLNV, it does not flatten the interface, and it does not leave
  a partial output file.
- An import that is well-formed but unresolved is saved with warnings. The
  user can then fix it in `.ip.yml`. The generator is the strict check.
- Generators validate before they stage or write any output.

## 10. Editor and checker behavior

### 10.1 Canvas

Protocol diagnostics use the existing canvas annotation mechanism:

- An interface-level diagnostic marks the bus bundle.
- A port-level diagnostic also marks the logical subport when the bundle is
  expanded.
- The bundle and the subport show a severity marker and a tooltip with the
  diagnostic message.

### 10.2 Inspector

- Root widths and declared `interfaceProperties` are editable.
- Derived widths are read-only. The Inspector shows their formula and their
  resolved value.
- Fixed widths are read-only.
- An editable field with an incorrect value shows the expected value and the
  actual value.
- A coupled edit, for example a change to AXI `WDATA`, also updates the
  dependent explicit overrides. The edit is one batch, one document change,
  and one undo step.

Coupled IP Core edits use the existing `updateIpCoreBatch` path. Do not add
a Memory Map `__op` variant. Do not send more than one `sendUpdate` call.

### 10.3 Issues panel

The current reference-error footer becomes one **Issues** panel. The panel
groups diagnostics by source, in this order:

1. Schema
2. Protocol
3. References
4. HDL consistency
5. Vendor artifact consistency

- A click on an issue selects the related canvas element. If an Inspector
  field is related, it gets the focus.
- The toolbar shows the number of errors and the number of warnings.
- If generation stops because of a diagnostic, the Issues panel opens and
  selects the first blocking diagnostic.

### 10.4 One implementation of the rules

The immediate webview validation and the explicit checker call the same
pure conformance code. The explicit checker also runs the extension-side
schema, HDL, and vendor-artifact checks. It removes duplicate results by
diagnostic code and document path. It must not contain a second
implementation of the protocol rules.

### 10.5 Import preview

Import preview runs the conformance validation before **Save as .ip.yml**:

- A known error stays visible on the preview canvas, and Save is disabled.
- An unresolved diagnostic stays visible as a warning, and Save is enabled.
  The user can fix the document later.
- If a known error exists, IPCraft does not change any destination file.

## 11. Root widths and derived widths

Usually, the user gives only property values and root widths. For an
AXI4-Stream interface with an active `TKEEP`, this is sufficient:

```yaml
portWidthOverrides:
  TDATA: 64
```

The effective `TKEEP` width is 8. IPCraft also accepts and keeps an explicit
override with the correct value:

```yaml
portWidthOverrides:
  TDATA: 64
  TKEEP: 8
```

IPCraft rejects `TKEEP: 4`. The contract calculates the width. IPCraft does
not correct the document.

Serialization rules:

- Serialization writes the root widths and the properties that the user
  wrote.
- It does not write every derived width.
- IPCraft does not change an existing explicit derived override that has the
  correct value.
- When the user changes a root width, `updateIpCoreBatch` deletes every
  explicit derived override that depends on it, in the same atomic edit. The
  contract then supplies the value.

This rule is deterministic. It keeps the file format and the test snapshots
stable.

## 12. `_hw.tcl` import and Avalon-ST properties

`HwTclParser` must read all supported Avalon-ST interface properties, not
only one vendor field:

- It maps `firstSymbolInHighOrderBits` to `endianness`.
- It reads the current name `dataBitsPerSymbol` and the legacy name
  `bitsPerSymbol`. Both become `dataBitsPerSymbol` in `.ip.yml`.
- If both names are present with different values, the import fails with a
  diagnostic that gives the source location. IPCraft does not guess.

For a stream with 1-bit symbols and an `N`-bit data port, the import result
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

- If `symbolsPerBeat` is missing, but the data width and the symbol size are
  known, IPCraft calculates it.
- If all three values are present, their product must agree.
- The generated Altera `_hw.tcl` writes the interface properties, so a round
  trip keeps the 1-bit symbols.
- The generated `_hw.tcl` writes `firstSymbolInHighOrderBits` from
  `endianness`, and reverses data in lanes of `dataBitsPerSymbol` bits.

## 13. `component.xml` export and protocol identity

IPCraft never changes Avalon-ST into AXI4-Stream. AXI4-Stream uses byte
lanes: `TDATA` is a whole number of bytes, and `TKEEP` and `TSTRB` have one
bit for each byte. The protocol reference is Arm IHI 0051B:
<https://documentation-service.arm.com/static/64819f1516f0f201aa6b963c>.

The AMD/IP-XACT export keeps all data:

1. Keep the Avalon-ST VLNV of the interface in `component.xml`.
2. Write and bundle the custom IP-XACT bus definition and abstraction
   definition of Avalon-ST.
3. Write the physical port maps. Do not pad ports and do not rename roles.
4. Write `dataBitsPerSymbol`, `symbolsPerBeat`, `readyLatency`, and the
   related properties as standard IP-XACT bus-interface parameters. Write
   `firstSymbolInHighOrderBits` only as the vendor form of `endianness`.
5. Also write a copy of the properties, `endianness`, and the contract
   version in one IPCraft vendor extension. A tool that ignores unknown
   bus-interface parameters then cannot delete the IPCraft data. (The
   implemented copy contains only the properties that the user wrote. The
   standard parameters in step 4 contain the resolved values.)
6. On import, the standard IP-XACT parameters have priority. The
   symbol-order parameter maps back to `endianness`. If the copy does not
   agree with the standard parameters, IPCraft reports a blocking
   diagnostic. It does not select one value.
7. Install or refer to the generated custom bus files through the existing
   custom bus-definition mechanism.

The vendor extension has this fixed format, which is part of the round-trip
contract:

- namespace: `urn:ipcraft:interface-contract:1`;
- one `interfaceContract` element with `version="1"`;
- in it, `property` elements with `name` and `value` attributes, sorted by
  name.

Thus, Vivado sees a valid custom interface, not an AXI4-Stream interface.
Vivado cannot connect it directly to an AMD AXI4-Stream interconnect. This
is correct, because there is no adapter.

A direct signal map is not safe, even for a byte-aligned stream. Avalon
`empty` can count 1-bit symbols, but AXI `TKEEP` qualifies whole bytes. A
direct map can lose data about the end of a packet. Thus, a conversion to a
conduit or to AXI4-Stream needs a conversion policy that the user selects.
A generated protocol adapter is future work.

## 14. Runtime library and custom buses

Built-in and custom definitions use the same data path:

```text
built-in and workspace bus YAML
  -> schema validation and normalization
  -> BusDefinitionContract library
  -> shared width/property resolver and validator
  -> editor, import, generation, export, and CI consumers
```

- `BusLibraryService` applies workspace precedence. A workspace definition
  replaces a different definition only when the library key and the VLNV
  match exactly, as the existing project rules say.
- The alias table of each contract maps built-in short names and foreign
  VLNVs before the exact lookup.
- The conformance lookup never uses a substring match.

A custom bus definition can declare root, derived, and fixed ports,
properties, and all version-1 constraints. It then gets the same editor and
generation behavior as a built-in, with no TypeScript change.

A legacy custom definition with no constraints still loads. IPCraft checks
only its port widths structurally.

An unknown VLNV, or a legacy custom definition with no contract, is not a
protocol violation. IPCraft keeps its `interfaceProperties` unchanged. Only
schema, resolution, HDL, or vendor diagnostics can stop its generation.

## 15. Documentation for people and AI agents

Do not copy all protocol details into the root `AGENTS.md`. The
documentation has three levels:

1. The bus-definition contracts are the machine authority.
2. `ipcraft-spec/docs/bus-interface-conformance.md` is the reference for
   people and LLMs. It has tables and examples for `TKEEP`, `empty`,
   parameterization, and vendor conversion.
3. The root `AGENTS.md` has a short orientation. It points to the reference
   and lists only the high-risk facts.

The orientation tells agents that:

- AXI4 and AXI4-Lite are memory-mapped and have no `TDATA`;
- AXI4-Stream uses byte lanes;
- Avalon-ST has explicit symbol properties;
- a valid default does not prove that other parameter values are valid;
- agents must call the shared validator. They must not write the rules
  again in prompts or templates.

JSON Schema descriptions, stable rule IDs, and diagnostic messages give more
context to agents that edit `.ip.yml` and bus-definition files directly.

## 16. Compatibility and migration

### 16.1 Documents

- `interfaceProperties` is optional in existing `.ip.yml` files.
- A legacy Avalon-ST document uses 8-bit symbols. IPCraft calculates
  `symbolsPerBeat` only when the data width gives one unambiguous result.
- A legacy Avalon-ST interface with `channel` but no `maxChannel` gets the
  largest value that the channel width can hold. Thus, the shipped 2-bit
  example resolves to `maxChannel: 3`, and IPCraft does not change the file.
- IPCraft changes legacy Avalon-ST `master`/`slave` modes to `source`/`sink`
  in memory only. New UI edits and imports write `source`/`sink`.
- `firstSymbolInHighOrderBits` is only a vendor import/export spelling.
  `.ip.yml` keeps the value in `endianness`.
- IPCraft never changes an incorrect existing document when it loads it. It
  shows diagnostics.
- IPCraft keeps valid explicit dependent overrides. A root-width edit
  deletes the related derived overrides through `updateIpCoreBatch`.
- An unknown property name is an error for a known contract. For an unknown
  bus or a custom bus with no contract, IPCraft keeps it unchanged.
- The user can always save an incomplete document. Generation and export do
  not continue without a proof.

### 16.2 Bus definitions

- The constraint section is optional for existing project bus definitions.
- Each built-in definition must have a complete version-1 contract before
  enforcement starts.

### 16.3 Behavior changes that the user can see

These changes must be in the release notes and must have explicit tests.
They must not appear only as snapshot changes.

- **Big-endian Avalon-ST RTL.** Generated RTL reverses lanes of
  `dataBitsPerSymbol` bits, not bytes. A stream that is not a multiple of 8
  bits, for example five 1-bit symbols, now reverses its symbol lanes. Before
  this change it got no reordering.
- **Canvas.** Where the old hard-coded table does not agree with
  `ipcraft-spec`, the canvas now follows `ipcraft-spec`. For example, the
  Avalon-MM optional ports and port list follow the canonical YAML.

### 16.4 Examples and enforcement

- Validate all shipped examples, and correct them on purpose, before
  enforcement starts.
- There is no permanent warning-only mode. The implementation uses an audit
  to find existing violations. The release follows the enforcement table in
  9.2.

## 17. Verification

### 17.1 Schema and contract tests

- Accept complete built-in and custom version-1 contracts.
- Reject unknown operations, incorrect operands, cycles, references to
  undeclared items, and malformed property declarations.
- Accept an unknown workspace port role. Make sure that IPCraft reports a
  warning with the source location and changes the role to `control`. Fail
  the repository tests if a built-in causes this warning.
- Reject incorrect mode policies, incorrect interface kinds, ambiguous
  aliases, and unsupported alias wildcards.
- Make sure that `npm run generate-types` generates the expected
  `busDefinition.types.ts` from the hand-written schema.
- Make sure that the five shipped built-ins have complete contracts.
- Make sure that a legacy custom definition with no constraints still loads.

### 17.2 Resolver and validator tests

- Use tables of valid, invalid, warning, and unresolved cases for every
  built-in rule.
- Test concrete defaults and every value of each allowed-value domain in the
  limit. Test symbolic equality, correct and incorrect derived overrides,
  unresolved expressions, and illegal fixed overrides.
- Test allowed-value combinations below the 256 limit, and the unresolved
  diagnostic above it.
- Test exact canonical VLNVs, short aliases, structured foreign VLNVs (exact
  version and wildcard), and unknown VLNVs.
- Make a table with every bus spelling from `busVlnv.test.ts`,
  `busDefinitions.test.ts`, and each `lookupBusDef` branch. Make sure that
  each spelling resolves to the same contract and `interfaceKind` before the
  substring matchers are removed.
- Calculate memory-map and interrupt eligibility from `interfaceKind`, the
  mode, and the array shape. Test a custom version-1 memory-mapped bus with a
  consumer mode that is not `slave`. Make sure that unknown buses and buses
  with no contract do not become eligible.
- Test mode normalization and direction reversal for Avalon-ST
  `source`/`sink` and legacy `master`/`slave`.
- Reject an unknown `interfaceProperties` key for a known contract. Keep the
  same key for a custom bus with no contract.
- Include at least these examples:
  - AXI4-Stream `TDATA=32`, `TKEEP=4` is valid.
  - AXI4-Stream `TDATA=20` is invalid.
  - AXI4-Stream `TDATA=64` gives `TKEEP=8` when `TKEEP` is not given.
  - Four 8-bit Avalon symbols with `empty=2` are valid.
  - Four 1-bit Avalon symbols with `data=4` and `empty=2` are valid.
  - A 2-bit Avalon `channel` with no `maxChannel` gives `maxChannel=3`.
  - Big-endian 1-bit Avalon symbols reverse symbol lanes, not bytes.
  - A 1-bit-symbol stream is invalid if `data`, `dataBitsPerSymbol`, and
    `symbolsPerBeat` do not agree.

### 17.3 Service and integration tests

- Load built-in and workspace definitions with a deterministic precedence.
- Before you delete the webview tables, record every port, direction,
  presence, and role that they share with the normalized definitions. Record
  the known Avalon-MM differences as intentional changes.
- Make sure that the parser, the generator, and the webview use the shared
  contract lookup. Make sure that `HwTclParser` does not import from the
  webview.
- Validate every shipped `.ip.yml` example.
- Make sure that `_hw.tcl` import keeps the current and legacy symbol
  properties, and stops with no output when their values do not agree.
- Make sure that an unresolved, well-formed, parameterized import can be
  saved with a warning, and that generation stays blocked.
- Make sure that Altera regeneration keeps the imported properties.
- Add big-endian Avalon-ST fixtures with five 1-bit symbols for VHDL and
  SystemVerilog to `src/test/integration/endianness.test.ts`. Make sure that
  the RTL reverses five symbol lanes, has no multiple-of-8 check, and
  compiles or elaborates with the available HDL tools.
- Make sure that `component.xml` keeps a 1-bit-symbol Avalon-ST interface as
  a custom interface, writes the custom bus files, and never calls it
  AXI4-Stream.
- Make sure that an invalid or unresolved generation stops before any
  staging or file output.
- Make sure that an interface with `memoryMapRef` and an unknown, streaming,
  or wrong-mode contract reports `BUS_MEMORY_MAP_UNSUPPORTED` and cannot be
  generated. It must not use the default address width, and it must not skip
  the register file.
- Make sure that `addressing.ts`, `getBusTypeForTemplate`, and
  `hasMemoryMappedSlaveInterface` use the normalized consumer mode of a
  custom memory-mapped contract, not the literal `slave`.
- Make sure that the explicit checker returns protocol diagnostics together
  with schema, reference, HDL, and vendor-artifact diagnostics.

### 17.4 Webview tests

- Show interface and subport severity markers on the canvas.
- Show expected and actual values in the Inspector.
- Group the diagnostics in the Issues panel and remove duplicates.
- Select and focus the related interface or field when the user clicks an
  issue.
- Keep derived values read-only. Update their display after a root edit.
- Make sure that a 5-bit Avalon-ST interface with 1-bit symbols permits
  big-endian selection and shows no multiple-of-8 warning. Keep the existing
  multiple-of-8 warning and the disabled control for a 5-bit standalone
  port.
- Apply coupled changes through `updateIpCoreBatch` as one state change and
  one undo step, with only one outbound update.
- Make sure that a root edit deletes the related explicit derived overrides.
  It must not update them or add new ones.
- Disable Save for an invalid import preview. Open the Issues panel when
  generation stops.

After the type generation, run the compile step, the unit tests, the related
integration tests, lint, and the format checks. Do not start enforcement
until all built-ins and shipped examples pass the shared validator.

## 18. Delivery sequence

1. In `ipcraft-spec`: add the bus-definition schema, the `.ip.yml`
   `interfaceProperties` field, the `npm run generate-types` integration, the
   five built-in contracts (roles, modes, interface kinds, aliases), and the
   conformance reference.
2. Add and unit-test the pure modules: alias lookup, contract normalization,
   width and property resolution, mode handling, path-based diagnostics, and
   conformance validation.
3. Migrate the consumers:
   1. Record the shared behavior of the webview tables and the normalized
      contracts, and the intentional Avalon-MM differences.
   2. Make `BusLibraryService` produce the runtime library.
   3. Move all consumers to the runtime library.
   4. Replace the memory-map classification in `busVlnv.ts` and in the
      generator with the resolved `interfaceKind` and consumer mode.
   5. Remove the literal `slave` tests from `addressing.ts` and
      `registerProcessor.ts`.
   6. Remove the webview dependency of `HwTclParser`.
   7. Delete the hard-coded tables.
4. Show diagnostics on the canvas, in the Inspector, in the Issues panel, and
   in the explicit checker.
5. Add `_hw.tcl` property import and Altera round-trip generation.
6. Add the Avalon-ST custom IP-XACT parameters and bus-definition export.
7. Add the checks before import writes, staging, generation, export, and CI.
8. Validate and correct all shipped examples. Then start full enforcement.

Each step must keep these existing behaviors: format-preserving YAML edits,
atomic protocol messages, undo steps, selection, focus, and custom bus
behavior.

## References

- Arm, _AMBA AXI4-Stream Protocol Specification_, IHI 0051B:
  <https://documentation-service.arm.com/static/64819f1516f0f201aa6b963c>
- Arm, _AMBA AXI and ACE Protocol Specification_:
  <https://documentation-service.arm.com/static/68b03beb01ae952d9559f9eb>
- Arm, _AMBA AXI4-Lite Protocol Specification_, AXI4-Lite width rules:
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
