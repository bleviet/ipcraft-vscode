# Versioning Register Sets

A driver that talks to an IP core must know which register layout the hardware
has. This guide shows how to put the core's version into a register, and how to
keep a history that maps each released version to the register layout it shipped
with.

Three features work together:

- a **version scheme** that says how `vlnv.version` is structured;
- **`$version` references** that make a register or bit field a read-only
  constant holding the core version;
- a **version history** in the memory map that records the register layout of
  each released version.

## The running example

The examples use a core named `uart` at version `1.4.2` with the scheme
`major.minor.patch`. It imports a memory map with a `VERSION` register at offset
`0x0`. The register has the fields `MAJOR`, `MINOR`, and `PATCH`.

```yaml
apiVersion: "1.2"
vlnv:
  vendor: acme
  library: ip
  name: uart
  version: 1.4.2
  versionScheme: major.minor.patch

memoryMaps:
  import: uart.mm.yml
```

## Choose a version scheme

1. Open the `.ip.yml` file in the IP Core editor.
2. In the Inspector, find the **VLNV** section.
3. Select a value in **Version scheme**, above the **Version** field.

| Scheme | Version looks like | `$version` width |
|---|---|---|
| Free text (default) | any non-empty text | none |
| `major.minor` | `1.4` | 16 bits |
| `major.minor.patch` | `1.4.2` | 24 bits |
| `major.feature.minor.patch` | `1.4.0.2` | 32 bits |

A numeric scheme needs exactly the listed number of components. Each component
is a whole number from 0 to 255, so it fits in 8 bits. Leading zeros such as
`01` are rejected. Free text has no numeric value, so `$version` references
cannot be used with it.

The Version field is checked against the selected scheme. A core without a
`versionScheme` key uses free text. Selecting **Free text** removes the
`versionScheme` key from the file instead of writing a value.

Switching the scheme never rewrites the version. If the version does not fit the
new scheme, the editor shows the error under the Version field and you fix the
text yourself.

When you write a two-component version by hand, quote it: `version: "1.4"`.
Unquoted, YAML reads `1.10` as the number `1.1`, which is not a text value.

## Put the version in a register

Write a `$version` reference as the `resetValue` of a bit field, or of a register
that has no bit fields.

```yaml
- name: CSR_MAP
  addressBlocks:
    - name: REGS
      baseAddress: 0x0
      range: 4K
      defaultRegWidth: 32
      registers:
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
        - name: CONTROL
          offset: 0x4
          fields:
            - name: ENABLE
              bits: "[0]"
              access: read-write
              resetValue: 0
```

A register without fields can hold the whole packed version instead:

```yaml
- name: CSR_MAP
  addressBlocks:
    - name: REGS
      baseAddress: 0x0
      range: 4K
      defaultRegWidth: 32
      registers:
        - name: VERSION
          offset: 0x0
          resetValue: $version
```

| Reference | Value for `1.4.2` | Available in |
|---|---|---|
| `$version.major` | `0x01` | Every numeric scheme |
| `$version.feature` | none | `major.feature.minor.patch` only |
| `$version.minor` | `0x04` | Every numeric scheme |
| `$version.patch` | `0x02` | `major.minor.patch` and `major.feature.minor.patch` |
| `$version` | `0x010402` | Every numeric scheme |

A field that holds a component reference must be exactly 8 bits wide. A field
that holds `$version` must be exactly `8 * n` bits wide. A register without
fields must be at least as wide as the reference needs (`8 * n` bits for
`$version`, 8 bits for a component).

`n` is the number of components of the scheme. A wider register holds the value
zero-extended.

### Packing

`$version` packs the components with the major component in the most significant
byte. Version `1.4.2` becomes `0x010402`. Version `1.4.0.2` in the four-component
scheme becomes `0x01040002` (major, feature, minor, patch).

### Enter a reference in the editor

In the Memory Map editor you can type a reference instead of a number.

| Where | What to type | Result |
|---|---|---|
| Reset cell of a field | `$version.major` or another reference | The reference is saved in `resetValue` as soon as it is valid |
| Value bar of a register without fields | `$version` | The register's own `resetValue` becomes `$version` |

Next to a reference the editor shows the resolved value, for example `= 0x01`
under a field and `= $version` next to the value bar. The value bar and the bit
visualizer show the resolved bits.

The editor finds the version by looking for the `.ip.yml` whose `memoryMaps`
imports the open `.mm.yml`. Unsaved edits in that file count. The hint changes
when there is no clear answer:

| Hint | Meaning |
|---|---|
| `version unresolved` | No `.ip.yml` in the workspace imports this map |
| `several IP cores import this map` | More than one `.ip.yml` imports it |

Text that starts with `$` but is not a valid reference shows an error and is not
saved. When the scheme is known, the error lists its references, for example
`Use $version, $version.major, $version.minor or $version.patch`. Typing a number
over a reference replaces it with that number.

A field that holds a reference is a constant. Outside Debug Mode, clicking its
bits in the bit visualizer does nothing, and the value bar rejects a value that changes those
bits, for example `Bits 23:16 hold $version.major (0x01)`. On a register that has
fields, `$version` typed in the value bar is rejected with
`Use $version.* on the bit fields`. Debug Mode only explores values locally, so it
refuses to set a reference: `Version references cannot be set in Debug Mode`.

References stay symbolic in the file. The core's current version is never copied
into the registers, so raising `vlnv.version` does not edit the memory map.

## What the generated HDL does

A field or register that holds a `$version` reference is generated as a
read-only constant.

- The register file returns the resolved value as a literal. For `1.4.2` the
  `VERSION` register reads as `0x010402`.
- The constant is not a hardware input. It adds nothing to the `regs_in` record
  and has no port.
- The constant is not stored. A bus write to it is accepted by the bus and has no
  effect.
- A register that mixes constant fields with other fields reads the literal for
  the constant bits and the usual value for the rest.

If a field with a reference sets an `access` other than `read-only`, IPCraft
ignores it and warns: `Access is ignored: $version fields are generated as
read-only constants`.

The same resolved value is used for the Vivado `component.xml` reset value, the
generated datasheet, and the verification manifest. The datasheet shows a
constant as `$version.major (0x01)` with access `read-only (constant)`. When the
core has a numeric scheme or a history, it also has a Version section with the
scheme and the recorded versions.

## Record a version history

`versionHistory` is a key of a memory map in a `.mm.yml` file. It holds frozen
copies of released register layouts and a list that says which version used
which layout.

```yaml
- name: CSR_MAP
  addressBlocks:
    - name: REGS
      baseAddress: 0x0
      range: 4K
      defaultRegWidth: 32
      registers:
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
        - name: CONTROL
          offset: 0x4
          fields:
            - name: ENABLE
              bits: "[0]"
              access: read-write
              resetValue: 0
  versionHistory:
    registerSets:
      rs1-fda0d75e27f25536:
        addressBlocks:
          - name: REGS
            baseAddress: 0x0
            range: 4K
            defaultRegWidth: 32
            registers:
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
      rs1-1bb06bf1ec945b4f:
        addressBlocks:
          - name: REGS
            baseAddress: 0x0
            range: 4K
            defaultRegWidth: 32
            registers:
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
              - name: CONTROL
                offset: 0x4
                fields:
                  - name: ENABLE
                    bits: "[0]"
                    access: read-write
                    resetValue: 0
    versions:
      - version: 1.4.1
        registerSet: rs1-fda0d75e27f25536
      - version: 1.4.2
        registerSet: rs1-1bb06bf1ec945b4f
```

| Part | Meaning |
|---|---|
| `addressBlocks` (the map's own) | The staging layout you are editing now |
| `registerSets` | Frozen layouts, keyed by `rs1-` and 16 hex digits of a hash |
| `versions` | One entry per released version, in release order |

The last entry of `versions` is the latest version. This is true for every
scheme, free text included. Versions that share a layout share one stored
register set. The snapshots keep `$version` references unresolved.

### What the hash covers

The key is a hash of the layout that a driver depends on.

| Counts toward the hash | Ignored |
|---|---|
| Block name, base address, range, usage, access, default register width | Descriptions |
| Register name, offset, size, access, reset value, `$version` reference | Enumerated values and `monitorChangeOf` |
| Array `count` and `stride`, child registers | Comments, formatting, key order |
| Field name, offset, width, access, reset value, `$version` reference | Hex versus decimal spelling, `bits` versus `offset` and `width` |

The order of registers and fields counts. A `$version` reference counts by its
text, so changing `vlnv.version` alone never changes the hash.

### Versioning is opt-in

A memory map is versioned when it has a `versionHistory` key or any `$version`
reference, in a register or a field at any depth. IPCraft never touches a map
that is not versioned.

You can also turn it on yourself:

1. Open the `.ip.yml`, or the `.mm.yml` that it imports.
2. Run **IPCraft: Start Register-Set Versioning** from the Command Palette or the
   Explorer context menu.

The command records the core's version and the current layout as the first
history entry of every imported memory map that has no history. A map that
already has a history is left alone. For a `.mm.yml`, exactly one `.ip.yml` must
import it.

Only memory maps imported from a `.mm.yml` can be versioned. An inline memory map
in the `.ip.yml` can use `$version` references, but its schema cannot hold a
`versionHistory`, so it is skipped.

## Generate with pending changes

Every generate command checks versioned maps first, before it creates files. The
IP Core editor's Generate button does the same.

Generation reads memory maps from disk. If a `.mm.yml` has unsaved changes and
it is versioned, in the editor or in the saved file, IPCraft asks you to
**Save and Continue**. Dismissing the dialog cancels generation and writes
nothing.

After the maps are saved, IPCraft runs the same `$version` checks that
generation runs, on the saved files (the errors in
[Diagnostics](#diagnostics)). If they report an error, generation cannot
succeed, so IPCraft records nothing and asks nothing more: generation then fails
and lists the errors. Fix them, then generate again to record the version.
Warnings do not stop the recording.

IPCraft compares the current layout with a reference entry: the entry recorded
for the core's current `vlnv.version` when there is one, otherwise the latest
entry.

| State | What happens |
|---|---|
| The map has no history yet | The version and layout are recorded, without a prompt |
| The layout equals the reference and the version is recorded | Nothing is written |
| The layout equals the latest entry and the version is new | The version is added to the history, without a prompt |
| The layout differs from the reference | A modal asks what to do |

A version that is not valid for the core's scheme is never recorded. When a
`$version` reference needs that version, generation reports it as a `$version`
error. Otherwise, when a release would have to record it, IPCraft shows an error
and generation does not run.

### The prompt

For the running example, you add the `CONTROL` register and raise the version
from `1.4.1` to `1.4.2`. The modal reads
`Register layout changed since version 1.4.1 (CSR_MAP).`

| Button | Offered when | Effect |
|---|---|---|
| **Adopt as version 1.4.2** | The current version is not recorded in any changed map | Records the new layout as version 1.4.2 and keeps the older entries |
| **Adopt as new version...** | The current version is already recorded in a changed map | Asks for a new version, records the layout under it, and writes it to `vlnv.version` |
| **Overwrite version 1.4.2** | The current version is recorded in every changed map | Replaces the layout recorded for that version |

Dismissing the dialog or pressing Escape cancels generation. Nothing is written.

**Adopt as new version...** opens an input box. It is prefilled with the current
version, checked against the scheme, and rejects a version that is already
recorded. Cancelling the input box cancels generation.

Overwrite changes the entry of the current core version, not the latest entry.
Use it when you correct the layout of the version you are still working on.

### What each choice writes

| Choice | `.mm.yml` | `.ip.yml` |
|---|---|---|
| Adopt as the current version | Adds a `versions` entry and, if the layout is new, a `registerSets` entry | Unchanged |
| Adopt as new version | Same, under the new version | `vlnv.version` is set to the new version |
| Overwrite | Points the entry of the current version at the new layout. Register sets that no entry uses any more are removed. A set that already exists keeps its stored snapshot | Unchanged |

Each file gets one edit, written in a format-preserving way, and is then saved so
that generation sees it. If **Adopt as new version...** would edit an `.ip.yml`
that has unsaved changes, IPCraft asks to **Save and Continue** first. Only
versioned maps are touched. Other maps in the same file stay as they are.

## Generate from the command line

`ipcraft generate` never writes a history unless you pass a policy:

```bash
ipcraft generate uart.ip.yml --out gen/ --register-set-policy adopt
```

| Policy | Effect |
|---|---|
| `adopt` | Adds the core version as a new entry |
| `overwrite` | Replaces the layout recorded for the current `vlnv.version` |

Without the flag, `generate` fails with a non-zero exit code and creates no files
when a versioned map is not up to date. The message names the map:

```text
CSR_MAP: register layout changed since version 1.4.1; re-run with --register-set-policy adopt|overwrite
CSR_MAP: version 1.4.2 is not recorded yet; re-run with --register-set-policy adopt
CSR_MAP: no version recorded yet; re-run with --register-set-policy adopt
```

The first message offers `adopt|overwrite` only when the current version is
already recorded. Otherwise it offers `adopt`.

Some combinations fail even with a flag:

```text
CSR_MAP: version 1.4.2 is already recorded; bump vlnv.version or use --register-set-policy overwrite
CSR_MAP: version 1.4.2 is not recorded; use --register-set-policy adopt
```

The first message comes from `adopt` on a layout change whose version is already
recorded. There is no prompt in a terminal, so you must bump `vlnv.version`
yourself. The second comes from `overwrite` when the current version is not
recorded, because there is no entry to replace.

The CLI runs the `$version` checks first. When they report an error, `generate`
does not write the history even with a policy, and it does not report a
register-set problem, because a flag cannot fix the error. It continues, and
generation fails with the errors.

`ipcraft verify` never writes. A versioned map that is not up to date is a
verification failure with the same messages. When the `$version` checks report an
error, `verify` lists those errors instead.

## Use the history in a driver

IPCraft does not generate a driver. The history is data for your own tooling. A
driver or a test tool can use it like this:

1. Read the version register at its fixed address.
2. Split the value into components. With `major.minor.patch`, `0x010402` is
   `1.4.2`.
3. Look the version up in `versions`.
4. Use the `registerSets` entry that the version names as the register layout.

This only works if the driver can always read the version, so the version
register must not move.

### Keep the version register stable

The version register must keep its absolute address and the layout of its
`$version` fields in every released layout. If it moves, a driver built for an
older version reads the wrong address and cannot find out which layout to use.

IPCraft compares the current version register with each recorded layout, in the
editor and at generation. It warns when the register moved, when its fields
changed, when it is gone, or when an older recorded layout has none. These are
warnings and do not block generation. See [Diagnostics](#diagnostics).

## Diagnostics

The editor shows these messages on the register or field, and the generator
checks the same rules before it creates files. Errors block generation. Warnings
are shown with the generation result and do not block it.

| Rule | Severity | Message gist | Fix |
|---|---|---|---|
| Scheme | Error | Version references need a numeric version scheme | Set `vlnv.versionScheme` in the `.ip.yml` |
| Component | Error | The reference is not available in the scheme; lists valid references | Use a reference the scheme has, such as `$version.minor` |
| Width | Error | The reference needs N bits, the field or register is M | Resize the field to 8 bits (`$version`: `8 * n` bits), or widen the register |
| Register with fields | Error | Use `$version.*` on the fields instead | Move the reference to the fields |
| Register array | Error | Version references are not supported in register arrays | Move the reference out of the array |
| Multiple version registers | Error | Only one version register per memory map | Keep one register with references |
| Access | Warning | Access is ignored: `$version` fields are read-only constants | Remove `access` or set `read-only` |
| Invalid core version | Error | `vlnv.version` is not valid for the version scheme | Fix the version, or the scheme. Reported at generation only |
| History: address | Warning | The version register moved since a recorded version | Move it back to the recorded address |
| History: layout | Warning | The version fields changed since a recorded version | Restore the recorded field layout |
| History: missing | Warning | The current layout has no version register, but a recorded version had one | Restore the version register |
| History: added | Warning | A recorded version has no version register (and neither do versions sharing its register set) | None needed; drivers cannot identify those versions |

The scheme, component, and width rules need the scheme, so the editor skips them
when it cannot find the owning `.ip.yml`. The register-with-fields, array,
multiple-register, access, and history rules still run. The warning for an
older version without a version register stays as long as that version is in the
history.

## Limitations

- `$version` is not supported inside register arrays.
- A memory map can have one version register.
- Only imported `.mm.yml` maps can record a history. Inline maps cannot.
- A free-text version can be rejected by Vivado and Quartus. When you generate
  for either target with a version that is not purely dotted numbers, such as
  `1.2.0-rc1`, IPCraft warns: `Vivado expects a numeric IP version; '1.2.0-rc1'
  may be rejected`. The Platform Designer `_hw.tcl` keeps the version text as it
  is. File names derived from the version, such as the Vivado XGUI script,
  replace every character other than letters, digits, and `_` with `_`.
- `vlnv.versionScheme` and `apiVersion: "1.2"` are not linked: IPCraft does
  not check one against the other. `ipcraft migrate` and the IP Core editor's
  first edit (once the bus library is loaded) stamp `apiVersion: "1.2"` on every
  `.ip.yml` that is behind the latest format, whether or not it sets
  `versionScheme`. IPCraft 1.2.0 refuses such a file.
- Do not use versioned memory maps with an IPCraft older than this release. An
  older IPCraft does not stop you: it never schema-validates an imported
  `.mm.yml` during generation, reads `$version.major` as `0`, and ignores
  `versionHistory`. It silently generates the version field as an ordinary
  register with a reset value of `0`. Only the `.ip.yml` side fails loudly:
  IPCraft 1.2.0 refuses `apiVersion: "1.2"`, and its IP core schema rejects
  inline `$version` tokens.

See the [specification schemas](../reference/specification-schemas.md) for the
keys, the [generator reference](../reference/generator.md#command-line-package)
for the CLI options, and the [command reference](../reference/commands.md) for
the commands.
