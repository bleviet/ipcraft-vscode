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
| `apiVersion` | Specification format version (`1.0`, `1.1`, `1.2`, or `1.3`; see [Version scheme](#version-scheme)) |
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

### Version scheme

`vlnv.version` is text. The optional `vlnv.versionScheme` says how that text is
structured, so a register can hold it as a number. See
[Versioning Register Sets](../how-to/versioning-register-sets.md).

```yaml
apiVersion: "1.3"
vlnv:
  vendor: acme
  library: ip
  name: uart
  version: 1.4.2
  versionScheme: major.minor.patch
```

| `versionScheme` | `version` must be | Components |
|---|---|---|
| `free` (default when absent) | any non-empty text | none |
| `major.minor` | two numbers | `major`, `minor` |
| `major.minor.patch` | three numbers | `major`, `minor`, `patch` |
| `major.feature.minor.patch` | four numbers | `major`, `feature`, `minor`, `patch` |

Each number is a whole number from 0 to 255 without leading zeros. Quote a
two-component version (`"1.10"`) so YAML does not read it as a decimal number.

`apiVersion: "1.3"` is the format version that adds `versionScheme`, `$version`
references and `versionHistory`. Generation refuses a memory map with `$version`
references or a `versionHistory` when its `.ip.yml` declares an older format, so
that an IPCraft that does not know them refuses the core instead of generating
`0`. A file without `apiVersion` is `1.0`. IPCraft reads every version up to the
latest it supports and refuses a newer one. `ipcraft migrate` and the first edit
in the IP Core editor upgrade a file to `1.3`.

Interrupts may optionally name the memory-mapped slave and clock domain that
serve them:

```yaml
interrupts:
  - name: irq
    direction: out
    associatedBusInterface: control
    associatedClock: clk
```

`associatedBusInterface` references a memory-mapped slave in `busInterfaces`;
`associatedClock` references an entry in `clocks`. Vendor generators translate
these portable names to their native association properties.

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
| `resetValue` | Whole-register reset value. A register without fields may use a `$version` reference instead of a number |
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
| `resetValue` | Reset value limited to the field width, or a `$version` reference |
| `enumeratedValues` | Names for known numeric values |
| `monitorChangeOf` | Field whose changes set this event field |

### Version references

A `resetValue` can be a reference to the owning IP core's `vlnv.version`
instead of a number. The reference stays in the file and is resolved when the
generator runs, so the register always holds the current version.

| Reference | Meaning |
|---|---|
| `$version` | The whole version packed into one value, major component first, 8 bits per component |
| `$version.major` | The major component |
| `$version.feature` | The feature component (`major.feature.minor.patch` only) |
| `$version.minor` | The minor component |
| `$version.patch` | The patch component (not in `major.minor`) |
| `$version.crc8` | CRC-8/I-432-1 of the version bytes, 8 bits |
| `$version.crc16` | CRC-16/IBM-3740 of the version bytes, 16 bits |

The version bytes are the components, most significant first, one byte each; for
a `free` version they are the UTF-8 bytes of the trimmed `vlnv.version`. The CRC
references are the only ones a `free` version supports. See
[Versioning Register Sets](../how-to/versioning-register-sets.md#check-the-version-register-with-a-crc).

References are valid on bit fields and on registers without fields, in `.mm.yml`
files and in inline memory maps of an `.ip.yml`. They need a numeric
`versionScheme` (except the CRC references). A field with a component reference
must be exactly 8 bits wide, a field with `$version` exactly `8 * n` bits, where
`n` is the number of components, and a field with `$version.crc8` or
`$version.crc16` exactly 8 or 16 bits. A register without fields must be at least as wide as its reference
needs. A field or register with a reference is generated as a read-only
constant.

```yaml
- name: VERSION
  offset: 0x0
  fields:
    - name: MAJOR
      bits: "[23:16]"
      resetValue: $version.major
    - name: MINOR
      bits: "[15:8]"
      resetValue: $version.minor
    - name: PATCH
      bits: "[7:0]"
      resetValue: $version.patch
```

### Version history

An optional `versionHistory` key on a memory map records the released register
layouts. It is allowed in `.mm.yml` files only; an inline memory map in an
`.ip.yml` rejects it.

```yaml
- name: CSR_MAP
  addressBlocks:
    - name: REGS
      baseAddress: 0x0
      range: 4K
      registers:
        - name: VERSION
          offset: 0x0
          resetValue: $version
  versionHistory:
    registerSets:
      rs1-cfcf5f65555a5b01:
        addressBlocks:
          - name: REGS
            baseAddress: 0x0
            range: 4K
            registers:
              - name: VERSION
                offset: 0x0
                resetValue: $version
    versions:
      - version: 1.4.1
        registerSet: rs1-cfcf5f65555a5b01
        crc8: 109
        crc16: 10057
```

| Field | Meaning |
|---|---|
| `registerSets` | Frozen copies of `addressBlocks`, keyed by `rs1-` followed by 16 lowercase hex digits |
| `versions` | Released versions in release order. Each entry has a non-empty `version`, the `registerSet` key it used, and optionally the `crc8` (0 to 255) and `crc16` (0 to 65535) of that version, recorded when the entry was written |

The key is the first 16 hex digits of a SHA-256 hash of the layout that a driver
depends on. `rs1` names the version of that hash definition. Descriptions,
comments, and formatting do not change the key. IPCraft writes the key and the
snapshots; you rarely edit them by hand.

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
