# Specification Schemas

IPCraft uses two YAML file types. JSON Schemas in the `ipcraft-spec` submodule
define exactly which fields and values are valid.

| File | Describes |
|---|---|
| `*.ip.yml` | One IP core: identity, ports, parameters, interfaces, and source files |
| `*.mm.yml` | One or more memory maps: address blocks, registers, and fields |

The tables below are a readable overview. The JSON Schema files remain the
authoritative definition.

## Minimal IP core

VLNV means vendor, library, name, and version. Together these values identify a
core without relying on its filename.

```yaml
apiVersion: "1.0"
vlnv:
  vendor: example.org
  library: peripherals
  name: status_reader
  version: 1.0.0

description: Reads a status input

clocks:
  - name: clk

resets:
  - name: rst_n
    polarity: activeLow

ports:
  - name: status_i
    direction: in
    width: 8
```

Common top-level fields:

| Field | Meaning |
|---|---|
| `apiVersion` | Specification format version |
| `vlnv` | Vendor, library, name, and version |
| `description`, `author` | Human-readable ownership and purpose |
| `clocks`, `resets`, `interrupts`, `ports` | Individual signals |
| `parameters` | Configurable values used by widths or generation |
| `busInterfaces` | Named protocol interfaces |
| `memoryMaps` | Inline or referenced register maps |
| `subcores` | Other IP cores used by this one |
| `simulation` | Per-core test framework and simulator choices |
| `targets` | Vendor outputs such as `vivado` and `quartus` |
| `scaffold_pack` | Saved scaffold-pack selection |
| `fileSets` | Source files grouped by purpose |

## Bus interfaces

```yaml
busInterfaces:
  - name: control
    type: ipcraft:busif:axi4_lite:1.0
    mode: slave
    physicalPrefix: s_axi
    associatedClock: clk
    associatedReset: rst_n
    memoryMapRef: control_map
```

| Field | Meaning |
|---|---|
| `name` | Interface name inside this core |
| `type` | Full bus identity or supported short name |
| `mode` | `master`, `slave`, `source`, `sink`, or `conduit` |
| `physicalPrefix` | Prefix used by physical HDL port names |
| `associatedClock`, `associatedReset` | Related clock and reset names |
| `memoryMapRef` | Linked memory map for memory-mapped interfaces |
| `array` | Count and naming rule for repeated interfaces |
| `useOptionalPorts` | Optional protocol signals to include |
| `absentPorts` | Required protocol signals intentionally missing from imported HDL |
| `portWidthOverrides` | Signal-specific width changes |
| `endianness` | Data byte order; for Avalon-ST, `big` places the first symbol in the most-significant data bits |
| `conduitPorts` | Inline signals for a custom interface |

## Minimal memory map

A memory-map file contains a YAML list, even when it describes only one map:

```yaml
- name: control_map
  addressBlocks:
    - name: control
      baseAddress: 0x0000
      range: 4K
      usage: register
      defaultRegWidth: 32
      registers:
        - name: CONTROL
          offset: 0x00
          fields:
            - name: ENABLE
              bits: "[0]"
              access: read-write
              resetValue: 0
```

### Address blocks

| Field | Meaning |
|---|---|
| `name` | Block name |
| `baseAddress` | First address |
| `range` | Reserved size in bytes, including forms such as `4K` |
| `usage` | `register`, `memory`, or `reserved` |
| `access` | Default software access |
| `defaultRegWidth` | Default register width in bits |
| `registers` | Registers and register arrays |

### Registers

| Field | Meaning |
|---|---|
| `name` | Register name |
| `offset` | Byte offset from the block base |
| `size` | Register width in bits |
| `access` | Default access inherited by fields |
| `resetValue` | Whole-register reset value |
| `fields` | Bit fields |
| `count`, `stride` | Repetition count and distance for an array |
| `registers` | Child registers in a repeated group |

### Bit fields

A field may use `bits`, or the equivalent `offset` and `width` values. `bits`
uses the highest bit first: `"[7:4]"` covers four bits.

| Field | Meaning |
|---|---|
| `name` | Field name |
| `bits` | Saved range such as `"[7:0]"` |
| `offset`, `width` | Lowest bit and number of bits |
| `access` | Read, write, or special write behavior |
| `resetValue` | Reset value limited to the field width |
| `enumeratedValues` | Names for known numeric values |
| `monitorChangeOf` | Field whose changes set this event field |

## Bus library

Built-in definitions under `ipcraft-spec/bus_definitions/` describe AXI4-Lite,
AXI4, AXI Stream, Avalon Memory-Mapped, and Avalon Streaming signals.

Each definition states the logical signal name, direction, width, and whether
the signal is required. The canvas uses it to display interfaces, and the
generator uses it to create physical ports.

Custom `.busdef.yml` files use the same model. Point `useBusLibrary` at a custom
library or let IPCraft discover definitions in the workspace.

## Validation in a text editor

The IPCraft visual editors validate these files automatically. For YAML text
editing, install the Red Hat YAML extension and associate the schemas:

```jsonc
{
  "yaml.schemas": {
    "./ipcraft-spec/schemas/ip_core.schema.json": "*.ip.yml",
    "./ipcraft-spec/schemas/memory_map.schema.json": "*.mm.yml"
  }
}
```

## Schema and type changes

The schema sources are:

```text
ipcraft-spec/schemas/ip_core.schema.json
ipcraft-spec/schemas/memory_map.schema.json
src/generator/contract/template_context.schema.json
```

After changing a schema:

```bash
npm run generate-types
npm run compile
```

Generated TypeScript files must not be edited by hand. Review the generated
diff and compile it to find incompatible uses.
