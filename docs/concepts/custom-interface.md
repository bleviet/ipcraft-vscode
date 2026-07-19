# Custom Interface

For step-by-step instructions, see [Defining a Custom Interface](../how-to/custom-interfaces.md). This page covers the underlying data model.

A Custom Interface is a bus interface whose signal set is defined by the designer rather than drawn from a built-in protocol library. Where a standard interface (AXI4-Lite, AXI-Stream, Avalon-MM, etc.) has a fixed, tool-recognized signal list, a Custom Interface carries exactly the signals you name — no more, no less. This makes it the right choice whenever a connection between IP cores does not map cleanly onto an industry-standard bus protocol.

> **Before reaching for a Custom Interface**, check whether the protocol you need is one Vivado already ships metadata for (e.g. Xilinx's `fifo_write`/`fifo_read`). If so, [scanning the Vivado Interface Catalog](vivado-interface-catalog.md) lets IPCraft recognize it directly — same selection and width-override UI as a built-in bus type, and no hand-typed signal list to keep in sync. The rest of this page describes the model for interfaces that genuinely have no such metadata anywhere.

---

## Why Custom Interfaces Exist

Every standard bus type in IPCraft's built-in library describes a protocol that EDA tools already understand: Vivado knows how to auto-connect AXI4-Lite ports; Quartus Platform Designer can infer Avalon-MM topology. That shared understanding comes at the cost of a fixed contract. The address bus is 32 bits. The handshake uses VALID and READY. The roles of master and slave are defined.

Not every interface fits that contract. Consider:

- A proprietary streaming link between an accelerator and a memory controller, where the handshake is a single `grant` wire rather than VALID/READY.
- A diagnostic port that groups a heterogeneous set of signals — an enable flag, a 12-bit sample, a 3-bit status — for convenience rather than because they form a protocol.
- A chip-level conduit that passes signals straight through a hierarchy without attaching any bus semantics.

In all these cases there is no standard type to reference. A Custom Interface lets you declare the signals as a first-class interface — named, directioned, sized — so the canvas can render them, the generator can emit the correct port list, and EDA tools have the metadata they need to describe (if not auto-connect) the connection.

---

## The Signal Definition Model

The signals that belong to a Custom Interface are described as **conduit ports**. Each conduit port has three fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Signal name as it will appear in the RTL port list |
| `direction` | `in` \| `out` \| `inout` | no | Direction from the perspective of this interface instance |
| `width` | integer or generic name | no | Bit width; omit for single-bit signals |
| `description` | string | no | Human-readable annotation |
| `presence` | `required` \| `optional` | no | Whether the signal is always generated (default: `required`) |

Direction on a conduit port is asymmetric in the same way as standard bus ports: a signal declared `out` on a master instance becomes `in` on the slave instance. The generator uses this when producing the Vivado abstraction definition XML, which must specify both the master-side and slave-side direction for each logical signal.

---

## Two Storage Approaches

Custom Interface signal definitions can live in two places, and the choice between them determines whether the definition is private to one IP core or shared across the workspace.

### Inline definition

When a Custom Interface is used by only one IP core, the signal list is embedded directly in the `.ip.yml` file using the `conduitPorts` key:

```yaml
busInterfaces:
  - name: DIAG_OUT
    type: ipcraft:busif:conduit:1.0
    mode: conduit
    physicalPrefix: diag_
    conduitPorts:
      - name: ENABLE
        direction: in
        width: 1
      - name: SAMPLE
        direction: out
        width: 12
      - name: STATUS
        direction: out
        width: 3
```

The canvas detects this interface as a custom type either because the `type` string contains `conduit` or because `conduitPorts` is present.

### Reusable bus definition file

When several IP cores share the same proprietary protocol, extracting the signal list into a standalone file avoids duplication and ensures consistency. IPCraft stores reusable custom bus definitions as `.busdef.yml` files in the project directory, using the same YAML format as the built-in library entries:

```yaml
MY_PROTO:
  busType:
    vendor: acme.com
    library: interface
    name: my_proto
    version: "2.0"
    description: Proprietary streaming link
  ports:
    - name: DATA
      direction: out
      width: 32
      presence: required
    - name: VALID
      direction: out
      width: 1
      presence: required
    - name: READY
      direction: in
      width: 1
      presence: required
```

An IP core references this definition through the `useBusLibrary` key and uses the full VLNV string as the `type`:

```yaml
busInterfaces:
  - name: STREAM_IN
    type: acme.com.interface.my_proto.2.0
    mode: slave
    physicalPrefix: s_
    useBusLibrary: ./my_proto.busdef.yml
```

In the canvas inspector, clicking **Save** on a custom interface writes the current `conduitPorts` to a `.busdef.yml` file and updates the interface to reference it — converting an inline definition to a reusable one in a single step.

Beyond an explicit `useBusLibrary` reference, IPCraft also auto-discovers reusable bus definitions across the whole workspace so they appear as known interfaces in the Inspector without any per-IP-core configuration. For YAML, this discovery is filename-gated: only files matching `*.busdef.yml` are scanned — a plain `.yml` file is never auto-discovered, even if its content matches the bus definition shape. Vivado-style IP-XACT `.xml` bus/abstraction definitions have no such filename convention, so they are instead discovered by sniffing file content for the IP-XACT namespace and element names.

---

## Custom Interface Types vs. Conduit Mode

The word "conduit" appears in two overlapping contexts that are worth distinguishing.

**`mode: conduit`** is one of the five interface modes (`slave`, `master`, `source`, `sink`, `conduit`). It declares that this interface carries signals point-to-point without any bus transaction semantics — no handshake, no addressing, no flow control implied by the protocol. A standard bus type can be used with `mode: conduit`, though this is uncommon.

**A conduit-type bus interface** is an interface whose `type` string contains `conduit` (e.g. `ipcraft:busif:conduit:1.0`). This is IPCraft's placeholder type for interfaces whose signal set is defined entirely by `conduitPorts` rather than a library entry. It implies `mode: conduit` by convention, but the two are technically independent fields.

**A user-defined bus type** (e.g. `acme.com.interface.my_proto.2.0`) is a Custom Interface that has its own VLNV identity. It may use `mode: slave` or `mode: master` to express directionality, even though its signal set is not from the built-in library. The generator treats any type string that does not appear in the built-in catalog as a custom type and generates the corresponding bus definition XML.

In practice: use `mode: conduit` with the `ipcraft:busif:conduit:1.0` type for pass-through groupings where direction is not meaningful. Use a named VLNV type with `mode: slave` or `mode: master` for proprietary protocols where the initiator/responder distinction matters.

---

## Canvas Representation

On the IP Core canvas, Custom Interfaces are placed on the **left side** of the block, alongside slave and sink interfaces. This placement is determined by the interface mode: `slave`, `sink`, and `conduit` modes all render on the left; `master` and `source` modes render on the right. A Custom Interface declared with `mode: master` therefore appears on the right.

The number of vertical slot positions allocated to a conduit interface on the canvas is:

```
slots = 1 + len(conduitPorts)
```

The first slot holds the interface name label; one additional slot is reserved per signal. This means the canvas block grows in height as signals are added, keeping every signal visible without overlap.

For interfaces loaded from a `.busdef.yml` file, the canvas uses the port list from the library entry to determine slot count and to render the signal names in the inspector.

---

## Code Generation

### Vivado (IP-XACT)

Vivado requires every bus interface referenced in a `component.xml` descriptor to have a matching pair of IP-XACT XML files:

- **Bus Definition** (`busdef/<name>.xml`) — declares the protocol identity (VLNV, `directConnection`, `isAddressable`) and the logical signal names.
- **Abstraction Definition** (`busdef/<name>_rtl.xml`) — maps each logical signal to its master-side and slave-side direction.

IPCraft generates these files automatically for any bus interface whose type is not in the built-in Vivado-recognized catalog. The generator inverts the `direction` field from the `conduitPorts` definition to produce both the master-mode and slave-mode direction entries in the abstraction XML.

When the same custom type appears on more than one interface in the same IP core, the generator deduplicates: it produces a single XML pair regardless of how many instances reference the type.

The built-in bus definitions (AXI, Avalon) are installed to the global IPCraft configuration directory (`<ipcraft config dir>/vivado/busdefs/` — resolved by `src/utils/configDir.ts`: `~/.config/ipcraft` on Linux, `~/Library/Application Support/ipcraft` on macOS, `%APPDATA%\ipcraft` on Windows) at extension activation and do not need to be regenerated per project. Custom types are written alongside the `component.xml` into the project's output directory.

### Quartus (Platform Designer)

Quartus Platform Designer uses `_hw.tcl` scripts to describe IP components. For custom interface types, IPCraft maps the interface to Quartus's generic `conduit` interface class, which Platform Designer treats as an opaque bundle of signals. This means custom interfaces appear in the Platform Designer IP catalogue with their signals intact, but Platform Designer will not attempt to auto-connect them based on protocol matching.

---

## Choosing Between Custom and Standard Interfaces

Use a **standard bus interface** when the protocol is one that EDA tools already understand and auto-connect — AXI4-Lite for register-mapped slaves, AXI-Stream for data pipelines, Avalon-MM for Quartus-based designs. Standard interfaces benefit from tool-assisted wiring, parameter propagation, and IP catalogue integration with no additional configuration.

Use a **Custom Interface** when:

- The signal set does not correspond to any standard protocol.
- The signals form a logical group for organizational clarity but carry no transaction semantics (a conduit grouping).
- You are wrapping a proprietary protocol from a third-party vendor or internal team specification.
- You need to document the interface in machine-readable form so the generator can emit the correct port list, even if EDA auto-connection is not required.

A Custom Interface saved as a `.busdef.yml` file is the preferred form once more than one IP core in the project shares the same signal contract, as it makes the definition a single source of truth for both the canvas and the generator.
