# Specification Schemas

IPCraft specifications are defined by JSON schemas in the `ipcraft-spec` submodule. These schemas are the single source of truth for the YAML format and are used for both validation and TypeScript type generation.

## Submodule Structure

```text
ipcraft-spec/
  schemas/
    ip_core.schema.json       # IP Core specification schema
    memory_map.schema.json    # Memory Map specification schema
  common/
    bus_definitions.yml       # Built-in bus interface definitions
  examples/
    led/                      # LED controller example
    timers/                   # Timer peripheral example
    test_cases/               # Schema validation test cases
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
| `apiVersion` | string | No | Schema version identifier (e.g., `ipcore/v1.0`) |
| `vlnv` | object | Yes | Vendor, Library, Name, Version identifier |
| `description` | string | No | Human-readable description |
| `clocks` | array | No | Clock signal definitions |
| `resets` | array | No | Reset signal definitions |
| `ports` | array | No | User-defined port definitions |
| `parameters` | array | No | Generic parameter definitions |
| `busInterfaces` | array | No | Bus interface definitions |
| `memoryMaps` | array | No | Memory map definitions (inline or `$ref`) |
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
| `type` | string | Bus protocol VLNV (e.g., `ipcraft.busif.axi4_lite.1.0`) — see [Bus Library](#bus-library) |
| `mode` | string | Interface mode: `slave`, `master`, `sink`, `source`, or `conduit` |
| `physicalPrefix` | string | Signal naming prefix on the RTL port list |
| `memoryMapRef` | string | Reference to a memory map name (memory-mapped slave/master interfaces only) |
| `associatedClock` | string | Reference to a clock name |
| `associatedReset` | string | Reference to a reset name |
| `array` | object | Bus interface array configuration (see below) |
| `portSelection` | array | Selected optional ports from bus library |
| `portWidthOverrides` | object | Per-signal width overrides (signal name → width or generic name) |
| `useBusLibrary` | string | Path to a custom `.busdef.yml` file (conduit interfaces) |
| `conduitPorts` | array | Inline signal definitions for conduit interfaces (name, direction, width) |

#### Array Configuration

When `array` is set, the bus interface represents multiple identical interfaces instantiated in RTL:

| Field | Type | Description |
|-------|------|-------------|
| `count` | integer | Number of interface instances |
| `indexStart` | integer | Index of the first instance (default 0) |
| `namingPattern` | string | Port name pattern, e.g. `s_axi_{index}` |
| `physicalPrefixPattern` | string | Physical prefix pattern per instance |

## Memory Map Schema

A memory map file contains an array of memory maps, each with address blocks:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Memory map name |
| `addressBlocks` | array | Address block definitions |

### Address Block

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Block name |
| `baseAddress` | integer | Base address offset |
| `range` | integer | Address range in bytes |
| `registers` | array | Register definitions |

### Register

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Register name |
| `addressOffset` | integer | Offset from block base address |
| `size` | integer | Register size in bytes (default: 4) |
| `access` | string | Default access type for all fields |
| `description` | string | Register description |
| `fields` | array | Bit field definitions |

### Bit Field

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Field name |
| `bits` | string | Bit range in `[MSB:LSB]` format |
| `access` | string | Access type (`read-write`, `read-only`, `write-only`, etc.) |
| `resetValue` | integer | Reset value |
| `description` | string | Field description |

## Bus Library

The built-in bus library ships as individual YAML files under `ipcraft-spec/bus_definitions/`, one per protocol:

| File | VLNV type key | Vendor | Key Signals |
|------|---------------|--------|-------------|
| `axi4_lite.yml` | `ipcraft.busif.axi4_lite.1.0` | ARM | AWADDR, AWVALID, AWREADY, WDATA, WSTRB, ARADDR, RDATA, etc. |
| `axi4_full.yml` | `ipcraft.busif.axi4_full.1.0` | ARM | Full AXI4 with burst, cache, prot, ID signals |
| `axi_stream.yml` | `ipcraft.busif.axi_stream.1.0` | ARM | TDATA, TVALID, TREADY, TLAST, TKEEP, etc. |
| `avalon_mm.yml` | `ipcraft.busif.avalon_mm.1.0` | Intel/Altera | address, read, write, writedata, readdata, etc. |
| `avalon_st.yml` | `ipcraft.busif.avalon_st.1.0` | Intel/Altera | data, valid, ready, startofpacket, endofpacket, etc. |

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

TypeScript types are auto-generated from these schemas:

```bash
npm run generate-types
```

This produces:

- `src/webview/types/memoryMap.d.ts` from `memory_map.schema.json`
- `src/webview/types/ipCore.d.ts` from `ip_core.schema.json`
