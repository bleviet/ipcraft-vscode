# Port Field Metadata

Proposal: optional field metadata on the ports of an `.ip.yml` that names what the bits of a port carry. It covers top-level ports, conduit ports, and bus interface ports. It is metadata only. Generators ignore it and generated code does not change; user tools (cocotb tests, documentation, the Data Inspector) read it for their own purposes.

Status: proposal, for review (issue #287). The schema change lands in `ipcraft-spec`; this repository consumes it.

## Problem

A packed port such as a 16-bit status word, a 64-bit command bus, or an AXI-Stream `TDATA` payload has an internal layout that today lives only in HDL comments or in the designer's head. Every consumer reconstructs it by hand:

| Consumer | What it does today |
|---|---|
| cocotb testbench | Hard-codes shifts and masks to drive and check sub-fields |
| Documentation | Describes the layout in prose, separately from the spec |
| Data Inspector | The user retypes the fields; only memory-map registers can be imported |

Memory-map registers already have this (`fields` with `bits`, `description`, `enumeratedValues`). Ports do not.

## Field format

A port field uses the memory-map bit-field format, minus the two keys that only make sense for a register.

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | Field name, unique within the port |
| `bits` | one position form | Inclusive range `"[msb:lsb]"`, or `"[n]"` for one bit |
| `offset`, `width` | one position form | Start bit (LSB = 0) and number of bits, as an alternative to `bits` |
| `description` | no | Free text |
| `enumeratedValues` | no | Map `{value: name}` |

Not included: `access` and `resetValue`. A port has no register access semantics and no reset value. Display hints such as signed or fixed-point stay in the Data Inspector recipe.

In the schema this is a new `PortFieldDef` with the same property definitions as `BitFieldDef`, so readers that already parse register fields can parse port fields with the same code.

## Where fields are declared

| Port kind | Location | Key |
|---|---|---|
| Top-level port | `ports[]` | `fields: [...]` |
| Conduit port | `busInterfaces[].conduitPorts[]` | `fields: [...]` |
| Bus interface port | `busInterfaces[]` | `portFields: { <logicalName>: [...] }` |

Bus interface ports have no entry of their own in `.ip.yml`; they come from the bus definition. `portFields` is keyed by logical port name, following the existing `portWidthOverrides` and `portNameOverrides` maps, so the key stays stable when `physicalPrefix` or a name override changes. The layout belongs to the interface instance, not the bus definition: `TDATA` carries different payloads in different designs.

Clocks, resets, and interrupts are out of scope.

```yaml
apiVersion: "1.2"

ports:
  - name: o_status
    direction: out
    width: 16
    description: Packed status word
    fields:
      - name: state
        bits: "[3:0]"
        description: Main FSM state
        enumeratedValues:
          0: IDLE
          1: RUN
          2: ERROR
      - name: overflow
        bits: "[4]"
        description: Sticky FIFO overflow
      - name: level
        offset: 8
        width: 8
        description: FIFO fill level in words

busInterfaces:
  - name: s_axis
    type: ipcraft:busif:axi_stream:1.0
    mode: slave
    physicalPrefix: s_axis_
    portFields:
      TDATA:
        - name: sample
          bits: "[23:0]"
          description: Signed 24-bit audio sample
        - name: channel
          bits: "[27:24]"
      TUSER:
        - name: first
          bits: "[0]"
          description: First sample of a frame

  - name: dbg
    type: ipcraft:busif:conduit:1.0
    mode: conduit
    conduitPorts:
      - name: dbg_state
        direction: out
        width: 8
        fields:
          - name: phase
            bits: "[2:0]"
```

## Semantics

| Rule | Decision |
|---|---|
| Bit numbering | Bit 0 is the LSB of the HDL vector as declared. Independent of a port's `endianness`, which only describes byte order. |
| Gaps | Allowed. Bits not covered by a field are unused or reserved. |
| Overlap | Not allowed. A port has exactly one layout; alternative views of the same bits are a Data Inspector concern (overlay groups). |
| Parametric width | Field positions are integers. When the port width is a parameter or expression (including bus widths from the bus definition, `portWidthOverrides`, or a parameter), positions are checked against the width resolved with parameter defaults. |
| Bus array interfaces | `portFields` applies to every instance of the array. |
| Copy, not reference | A port never references a register layout. When a port mirrors a register, its fields are copied; references would create a dependency that has to be kept in sync both ways. |
| Generators | Ignore field metadata. No HDL, vendor, or cocotb output changes. |

## Versioning

`Port` and `BusInterface` reject unknown keys, and the schema states that tools must not read a file declaring a newer `apiVersion` than they support. Field metadata therefore ships as `apiVersion: 1.2`, the new latest version, through the same upgrade mechanism as 1.1:

| Path | Effect |
|---|---|
| Migration step 1.1 to 1.2 | No content changes; only `apiVersion` is stamped |
| Editor | A file behind the latest version is upgraded on its first edit, so every file edited with this IPCraft declares 1.2, with or without field metadata |
| `ipcraft migrate` | Upgrades files to 1.2 |
| Older IPCraft | Refuses a 1.2 file with "upgrade IPCraft" instead of a schema error |

The Python package in `ipcraft-spec` ships the schema files only, so the schema change is its whole update.

## Validation

Metadata that nothing checks goes stale, so the IP core editor checks it from the first release, in a "Port fields" group of the Issues panel (`src/webview/ipcore/utils/portFieldChecks.ts`). All checks are warnings, never generation errors.

| Check | Example message |
|---|---|
| Exactly one position form per field | `o_status.level: use bits or offset/width, not both` |
| Position inside the resolved port width | `o_status.level [15:8] exceeds port width 12` |
| No overlap between fields | `o_status: fields state and mode overlap at bit 3` |
| Unique field names within a port | `o_status: duplicate field name state` |
| Enumerated values fit the field width | `o_status.state: value 17 does not fit in 4 bits` |
| `portFields` key is a logical port of the bus definition | `s_axis.portFields: TKEEP2 is not a port of axi_stream` |
| `portFields` key is not absent or disabled | `s_axis.portFields: TUSER is not enabled on this interface` |
| Width not resolvable | Range checks skipped, no warning |

For an interface imported without a bus definition, the logical names come from `rawPortMaps`.

## Editor: fields follow the signal

Editing field metadata in the IP core UI is not part of this proposal; users write it in YAML. The editor must preserve it, including through gestures that change what kind of port a signal is:

| Gesture | Code | Field metadata |
|---|---|---|
| Rename, move, change width or direction of a port | `SignalPanels`, `useCanvasDrop` | Kept on the port |
| Group ports into a bus interface, new or existing | `useGroupPorts` `groupAsStandard`, `mergePortsIntoStandardBus` (mapping from `GroupingMappingStep`) | `ports[].fields` moves to `portFields[<logicalName>]` |
| Add one port to a bus interface | `useGroupPorts` `addPortToStandardBus` | `ports[].fields` moves to `portFields[<signalName>]` |
| Group ports into a conduit, or add one | `useGroupPorts` `groupAsConduit`, `addPortToConduit` | `ports[].fields` moves to `conduitPorts[].fields` |
| Ungroup a bus interface into ports | `useGroupPorts` `ungroupBusInterface` | `portFields[<logicalName>]` or `conduitPorts[].fields` moves to `ports[].fields` |
| Map a conduit to a known bus | `applyMapConduitToKnownBus` (mapping from `MapConduitToBusDialog`) | `conduitPorts[].fields` moves to `portFields[<logicalName>]`; unmapped conduit ports keep theirs |
| Save a conduit as a custom bus definition | `ConduitPanel` | `conduitPorts[].fields` moves to `portFields[<conduit port name>]`, the logical name the saved definition uses |
| Remove a conduit signal | `ConduitPanel` | Removed with the signal |
| Disable an optional bus port | `IpBlockCanvas` | `portFields` entry kept; the validator warns that the port is not enabled |

The physical-to-logical mapping comes from the dialog that already knows it, the same way `MapConduitToBusDialog` carries a conduit port's width into `portWidthOverrides`. Each gesture stays one document update. Plain edits already keep field metadata (see Verification); the gestures above rebuild objects from a fixed list of keys and drop it today, so they need explicit handling plus tests.

## Verification

Checked on 2026-11-09 against `main` (90b89a4e) before any implementation.

| Check | Method | Result |
|---|---|---|
| Generated output unchanged | `ipcraft generate` on `comprehensive_axi` with and without field metadata (top-level port, parametric-width port, `portFields` on `M_AXIS`, conduit port), VHDL and SystemVerilog, Vivado and Quartus, against a schema copy patched with `PortFieldDef` | Byte-identical: 44 VHDL and 46 SystemVerilog files |
| Current schema | Same input, unpatched schema | Generation refused: `ports.0`, `ports.1`, `busInterfaces.2` must not have additional properties. Conduit ports already accept `fields`. The schema change is a prerequisite. |
| Editor save path | Temporary Jest test on `useIpCoreState`: rename a port, change a width, rewrite the whole `ports` array (as `useCanvasDrop` does), edit a bus interface, rename a conduit port | `fields`, `portFields` and conduit `fields` kept; the `fields` block, its comment and hex keys stay byte-identical |
| Kind-changing gestures | Same test on `groupAsStandard`, `groupAsConduit`, `ungroupBusInterface` (conduit and standard), `applyMapConduitToKnownBus` | All five drop the field metadata (they also drop a port's `description` today) |

## Changes

| Repository | Change |
|---|---|
| `ipcraft-spec` | `PortFieldDef`; optional `fields` on `Port` and `ConduitPort`; optional `portFields` on `BusInterface`; `apiVersion` 1.2; `docs/ip_spec.md` section; one example |
| `ipcraft-vscode` | `npm run generate-types`; hand-update `src/webview/types/ipCore.d.ts`; accept `apiVersion` 1.2; validator checks; editor gestures above with tests |
| Generators | None. `normalizeIpCore` (`src/domain/parse.ts`) whitelists port and bus interface keys, so field metadata never reaches template contexts. A test confirms byte-identical output for an IP with fields. |

## Consumers

| Tool | Use |
|---|---|
| cocotb tests | Read the field metadata from the `.ip.yml` to build typed accessors: `status.level` instead of `(val >> 8) & 0xff`, enum names in assertion messages, decoded `TDATA` beats |
| Documentation | Render a bit-field table per port, like the register tables |
| Data Inspector | "Import from port" next to the existing register import (issue #288, first consumer after the schema change) |

### Data Inspector: Import from port

Tracked in issue #288.

Import copies the fields once into a recipe, like the register import; there is no live link.

| Item | Decision |
|---|---|
| Picker | Ports join the existing layout picker and the **Open Register or Port in Data Inspector** command, grouped as Registers and Ports. One layout reader, one message, one copy path. |
| Source | One source per imported port, width resolved with parameter defaults. Ports whose width does not resolve or exceeds 4096 bits are not offered. |
| What is offered | Ports with at least one usable field. Bus `portFields` keys that are unknown or not enabled are skipped, as are fields with a malformed position, a range beyond the port width, or a range that overlaps an earlier field of the same port. A key that differs from an earlier key of the same bus only in case is skipped too. |
| Field translation | `bits` / `offset`+`width` become the recipe's `msb`/`lsb`; `enumeratedValues` becomes `enumValues`. The display interpretation stays at its default, as for the register import. |
| Provenance | `importProvenance` is one of `{ sourceFile, registerName }` or `{ sourceFile, portName, busInterface? }`. A top-level port names only `portName`; a conduit port adds `busInterface`; a bus interface port uses the logical port name in contract casing (`TDATA`). |

## Rejected

| Option | Reason |
|---|---|
| Alternative or union layouts (overlay groups on a port) | No concrete benefit over one layout plus descriptions; the Data Inspector already offers overlay groups for ad hoc views. |
| Referencing a register layout from a port | Creates a dependency that has to be updated back and forth. Copy instead. |
| Reusing `BitFieldDef` verbatim | Would allow `access` and `resetValue`, which have no meaning on a port. |
| `bits` as the only position form | Register fields accept `offset`/`width` too; one format for both keeps readers simple. |
| Using the metadata in generators (VHDL records, SV packed structs) | Out of scope. If it comes, it is a separate opt-in proposal. |
