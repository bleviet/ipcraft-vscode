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
| `type` | string | Bus protocol type (e.g., `AXI4L`, `AVALON_MM`) |
| `mode` | string | Interface mode (`slave` or `master`) |
| `physicalPrefix` | string | Signal naming prefix |
| `memoryMapRef` | string | Reference to a memory map name |
| `associatedClock` | string | Reference to a clock name |
| `associatedReset` | string | Reference to a reset name |
| `array` | object | Bus interface array configuration |
| `portSelection` | array | Selected ports from bus library |

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

The built-in bus library at `common/bus_definitions.yml` defines four bus protocols:

| Protocol | Vendor | Key Signals |
|----------|--------|-------------|
| `AXI4L` | ARM | AWADDR, AWVALID, AWREADY, WDATA, WSTRB, ARADDR, RDATA, etc. |
| `AXIS` | ARM | TDATA, TVALID, TREADY, TLAST, etc. |
| `AVALON_MM` | Altera | address, read, write, writedata, readdata, etc. |
| `AVALON_ST` | Altera | data, valid, ready, startofpacket, endofpacket, etc. |

Each port in the bus library has a `presence` field (`required` or `optional`) and optional `width` and `direction` fields.

The bus library is loaded by `BusLibraryService` and used by the IP Core editor for port selection in bus interfaces, and by the generator for building template context.

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
