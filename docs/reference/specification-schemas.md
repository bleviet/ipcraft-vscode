# Specification Schemas

IPCraft specifications are defined by JSON schemas in the `ipcraft-spec` submodule. These schemas are the single source of truth for the YAML format and are used for both validation and TypeScript type generation.

## Submodule Structure

```text
ipcraft-spec/
  schemas/
    ip_core.schema.json       # IP Core specification schema
    memory_map.schema.json    # Memory Map specification schema
  bus_definitions/            # Built-in bus interface definitions, one YAML file per protocol
  examples/                   # Example IP cores (basic_peripheral, comprehensive_axi,
                               # comprehensive_avalon, daq_controller, minimal,
                               # multi_interface_accelerator, system_controller, xcvr_loopback)
  templates/                  # Starter YAML templates
```

## File Types

| Extension | Schema | Purpose |
|-----------|--------|---------|
| `*.ip.yml` | `ip_core.schema.json` | IP Core definition (VLNV, clocks, resets, ports, bus interfaces, parameters, file sets) |
| `*.mm.yml` | `memory_map.schema.json` | Memory map definition (address blocks, registers, bit fields) |

## IP Core Schema

Top-level fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiVersion` | string | No | Schema version for the file, e.g. `'1.0'` |
| `vlnv` | object | Yes | Vendor, Library, Name, Version identifier |
| `description` | string | No | Human-readable description |
| `author` | string | No | IP core author |
| `clocks` | array | No | Clock signal definitions |
| `resets` | array | No | Reset signal definitions |
| `interrupts` | array | No | Interrupt output definitions |
| `ports` | array | No | User-defined port definitions |
| `parameters` | array | No | Generic parameter definitions |
| `busInterfaces` | array | No | Bus interface definitions |
| `memoryMaps` | array | No | Memory map definitions (inline or `$ref`) |
| `subcores` | array | No | Sub-IP core dependencies, either a `vendor:library:name:version` string or a `SubcoreRef` object |
| `simulation` | object | No | Testbench framework/engine overrides for this IP core |
| `targets` | string[] | No | Synthesis vendor targets, e.g. `['vivado', 'quartus']`. Replaces the legacy `vendor:` field |
| `useBusLibrary` | string | No | Path to a custom bus library directory relative to this file |
| `scaffold_pack` | string | No | Scaffold pack used to generate this IP core; persisted so the canvas picker restores it on reopen |
| `fileSets` | array | No | File set definitions |

### VLNV Object

| Field | Type | Description |
|-------|------|-------------|
| `vendor` | string | Organization or domain name |
| `library` | string | IP library name |
| `name` | string | IP core name |
| `version` | string | Version string |

### Bus Interface Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Interface name |
| `type` | string | Bus protocol VLNV (e.g., `ipcraft:busif:axi4_lite:1.0`) or a recognized short alias (e.g. `AXI4L`) — see [Bus Library](#bus-library) |
| `mode` | string | Interface mode: `master`, `slave`, `source`, `sink`, or `conduit` |
| `physicalPrefix` | string | Signal naming prefix on the RTL port list |
| `memoryMapRef` | string | Reference to a memory map name (memory-mapped slave/master interfaces only) |
| `associatedClock` | string | Reference to a clock name |
| `associatedReset` | string | Reference to a reset name |
| `description` | string | Interface description |
| `array` | object | Bus interface array configuration (see below) |
| `useOptionalPorts` | array | Optional ports from the bus library to include |
| `absentPorts` | array | Required bus-spec ports (uppercase logical names) absent from the user's HDL; populated automatically by the VHDL parser so the generator doesn't emit ports missing from the source entity |
| `portWidthOverrides` | object | Per-signal width overrides (signal name → width or generic name) |
| `conduitPorts` | array | Inline signal definitions for conduit interfaces (name, direction, width) |

A custom bus library directory for the whole IP core (used to resolve conduit/custom
interface types) is set via the top-level `useBusLibrary` field, not per-interface.

#### Array Configuration

When `array` is set, the bus interface represents multiple identical interfaces instantiated in RTL:

| Field | Type | Description |
|-------|------|-------------|
| `count` | integer | Number of interface instances |
| `indexStart` | integer | Index of the first instance (default 0) |
| `namingPattern` | string | Port name pattern, e.g. `s_axi_{index}` |
| `physicalPrefixPattern` | string | Physical prefix pattern per instance |

## Memory Map Schema

A `.mm.yml` file's top level is an **array** of memory map definitions, each with address blocks:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Memory map name |
| `description` | string | Memory map description |
| `addressBlocks` | array | Address block definitions |

### Address Block

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Block name |
| `baseAddress` | integer \| null | Block starting address (default 0) |
| `range` | integer \| string \| null | Block size in bytes, or a shorthand like `4K` / `1M` |
| `usage` | string | `register`, `memory`, or `reserved` (default `register`) |
| `access` | string | Default access for registers in the block (default `read-write`) |
| `defaultRegWidth` | integer | Default register width in bits for registers in the block |
| `description` | string | Block description |
| `registers` | array | Register definitions |

### Register

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Register name |
| `offset` | integer | Offset from the address block base |
| `size` | integer | Register width **in bits** (default: 32) |
| `access` | string | Default access type for the register |
| `resetValue` | integer | Reset value for the entire register |
| `description` | string | Register description |
| `fields` | array | Bit field definitions |
| `registers` | array | Child registers, for register groups |
| `count` | integer | Array replication count (default 1) — see `RegisterArrayEditor` |
| `stride` | integer | Address stride between array replicas |

### Bit Field

The canonical representation is `offset` + `width`; `bits` is an alternate `[MSB:LSB]`-style
string some tooling accepts. `LayoutEngine.ts` (`recomputeBitfieldLayout`, `reorderBitfieldLayout`)
operates on `offset`/`width`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Field name |
| `offset` | integer | Starting bit position (LSB = 0) |
| `width` | integer | Number of bits |
| `bits` | string | Alternate bit-range form, e.g. `[7:0]` |
| `access` | string | Access type (`read-write`, `read-only`, `write-only`, `write-1-to-clear`, `read-write-1-to-clear`, `write-self-clearing`, `read-write-self-clearing`) |
| `resetValue` | integer | Reset/default value |
| `description` | string | Field description |
| `enumeratedValues` | object | Mapping of `{ value: name }` for enumerated fields |
| `monitorChangeOf` | string | Name of another field in the same register to watch for a change-of-state (write-1-to-clear fields only); the generator creates an internal shadow register and comparator |

## Bus Library

The built-in bus library ships as individual YAML files under `ipcraft-spec/bus_definitions/`, one per protocol:

| File | VLNV type key | Vendor | Key Signals |
|------|---------------|--------|-------------|
| `axi4_lite.yml` | `ipcraft:busif:axi4_lite:1.0` | ARM | AWADDR, AWVALID, AWREADY, WDATA, WSTRB, ARADDR, RDATA, etc. |
| `axi4_full.yml` | `ipcraft:busif:axi4_full:1.0` | ARM | Full AXI4 with burst, cache, prot, ID signals |
| `axi_stream.yml` | `ipcraft:busif:axi_stream:1.0` | ARM | TDATA, TVALID, TREADY, TLAST, TKEEP, etc. |
| `avalon_mm.yml` | `ipcraft:busif:avalon_mm:1.0` | Intel/Altera | address, read, write, writedata, readdata, etc. |
| `avalon_st.yml` | `ipcraft:busif:avalon_st:1.0` | Intel/Altera | data, valid, ready, startofpacket, endofpacket, etc. |

Each port entry in a bus definition file has:

| Field | Description |
|-------|-------------|
| `presence` | `required` or `optional` |
| `direction` | `in` or `out` (from the perspective of a slave/sink interface) |
| `width` | Bit width (integer) or omitted for single-bit signals |

The bus library is loaded by `BusLibraryService` and used by the IP Core canvas for port signal display, and by the generator for building template context.

### Custom Bus Definitions

A **Custom Interface** (conduit) is saved as a `<name>.busdef.yml` file in the project directory. These files share the same format as the built-in definitions and can be referenced by any IP Core in the workspace via `useBusLibrary`.

## VS Code YAML Validation

For additional in-editor validation, install the [Red Hat YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) and add to `.vscode/settings.json`:

```jsonc
{
  "yaml.schemas": {
    "./ipcraft-spec/schemas/ip_core.schema.json": "*.ip.yml",
    "./ipcraft-spec/schemas/memory_map.schema.json": "*.mm.yml"
  }
}
```

## Type Generation

TypeScript types are auto-generated from these schemas via `scripts/generate-types.js`:

```bash
npm run generate-types
```

This produces:

- `src/domain/memorymap.types.ts` from `memory_map.schema.json`
- `src/domain/ipcore.types.ts` from `ip_core.schema.json`
- `src/generator/contract/templateContext.types.ts` from `src/generator/contract/template_context.schema.json`

Generated type files must not be edited by hand. Update the JSON Schema source, run
`npm run generate-types`, and compile the result to catch incompatible generated changes.
