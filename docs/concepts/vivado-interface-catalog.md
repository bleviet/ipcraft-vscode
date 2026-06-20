# The Vivado Interface Catalog

How IPCraft learns about bus interfaces that Vivado already knows about — and
why an interface like Xilinx's `fifo_write` should never have been treated as
a hand-authored Custom Interface in the first place.

See [Vivado Interface Catalog — Architecture](../architecture/vivado-interface-catalog.md)
for the implementation. See [Custom Interface](custom-interface.md) for the
narrower concept this work builds on.

---

## The problem: real interfaces, treated as if they weren't

Vivado ships dozens of bus protocols beyond AXI and Avalon — small,
special-purpose ones like Xilinx's `fifo_write`/`fifo_read` (the master/slave
sides of a FIFO handshake) or `acc_fifo_write`/`acc_fifo_read`. Vivado already
ships an IP-XACT `busDefinition` and `abstractionDefinition` pair for each of
these, under `<install>/data/ip/interfaces/`. Vivado's auto-connect and
IP-XACT validation already understand them.

IPCraft's bus library, before this work, only knew about five built-in
protocols (AXI4-Lite, AXI4-Full, AXI-Stream, Avalon-MM, Avalon-ST). Anything
else — including a real Vivado standard like `fifo_write` — had exactly one
path available: [Custom Interface](custom-interface.md). That meant:

- Hand-typing every signal name, width, and direction into `conduitPorts`,
  even though Vivado's own XML already states them precisely.
- No tool-assisted selection: the "Interface Type" field was free text, so
  there was nothing to search or pick from.
- Worst of all, once an interface was recognized by VLNV at all (even just by
  matching a name in IPCraft's own saved-custom-bus library), the generator's
  packaging step treated it exactly like a user-invented protocol and wrote a
  `busdef/<name>.xml` + `busdef/<name>_rtl.xml` pair into the output —
  duplicating files Vivado already has installed, for no reason other than
  IPCraft had no way to tell "real Vivado standard I haven't catalogued yet"
  apart from "something the user made up."

## The idea: read the same files IPCraft already knows how to write

IPCraft already generates IP-XACT `busDefinition`/`abstractionDefinition` XML
for genuinely custom interfaces (see
[Custom Interface → Code Generation](custom-interface.md#code-generation)).
That format is exactly what Vivado ships for its own built-in interfaces. So
rather than inventing a new catalog format, the Vivado Interface Catalog
feature **parses Vivado's own files** with the same IP-XACT shape IPCraft
already produces, and folds the result into the same bus library mechanism
that already serves user-saved `.busdef.yml` files.

A user runs **"Scan Vivado Interface Catalog"** once (from the Control Center
Quick Actions or the command palette) against their local Vivado install. The
scan result is cached globally — not per project — so every IP core in every
workspace benefits from one scan, and re-scanning (e.g. after a Vivado
upgrade) simply replaces the cache.

## A third category, between "built-in" and "custom"

Before this work, a bus interface's type fell into exactly two buckets:

| Category | Source of port list | Editable in inspector as |
|---|---|---|
| Built-in | Hardcoded in `busDefinitions.ts` | "Bus Type" dropdown |
| Custom | `conduitPorts` (inline) or a saved `.busdef.yml` | "Interface Type" free text |

Vivado-discovered interfaces don't fit either bucket cleanly: their port list
comes from a library file, like a saved custom bus, but they are not
something the user invented — they're real protocols Vivado has its own
metadata for. This is the actual reason a third, explicit marker was needed:
every bus-library entry now optionally carries `source: 'vivado'`, set only
when the entry came from a catalog scan. That single field is what lets the
rest of the system tell the two cases apart wherever it matters:

- **Selection** — the inspector's "Interface Type" field gained the same
  searchable dropdown the "Bus Type" field already had, listing both
  user-saved and Vivado-discovered interfaces (see
  [Architecture → Inspector UI](../architecture/vivado-interface-catalog.md#inspector-ui-fuzzyselect-interfacetypefield)).
- **Width display** — some signals genuinely have no fixed width because
  Vivado leaves them parameterized in the IP-XACT (`fifo_write`'s `WR_DATA`
  is sized by the FIFO's data width, not the protocol). The inspector must
  show these as overridable, not hide them as if they were fixed 1-bit
  control signals — see
  [Architecture → Port Widths](../architecture/vivado-interface-catalog.md#the-port-widths-filter-bug).
- **Code generation** — the busType/abstractionType VLNV and portMaps in
  the generated `component.xml` must still reference the *real* interface
  (`xilinx.com:interface:fifo_write:1.0`), but the `busdef/` XML pair must
  **not** be generated, because Vivado already has it. `source: 'vivado'`
  is the one signal that tells `generateCustomBusDefs` to skip the file
  pair while leaving everything else unchanged.

This third category is deliberately *not* a special case bolted onto the
custom-interface model — it's the same model (a library entry with a port
list), with one provenance field that changes downstream behavior only where
it has to.

## The Map Signals workflow: don't discard the user's wiring

A user may have already authored an interface as a plain Custom Interface
(typed-in `conduitPorts` with their own physical signal names) *before*
running a catalog scan, or before the protocol they used happened to match
something Vivado ships. Once the scan makes that type resolvable, IPCraft
should not silently switch the interface to the library's official port
names — the user's HDL entity still has the old physical names.

The **Map Signals** dialog (opened from a "Known interface" banner in the
inspector) presents the library's logical ports on one side and the user's
existing physical signals on the other, lets them assign a mode (master/
slave) and per-port mapping, and on confirm converts the interface to use
`portNameOverrides` / `useOptionalPorts` — the exact same representation a
standard bus interface (AXI, Avalon) already uses to record "this logical
signal's physical name differs from the default." `conduitPorts` is then
cleared, because the library definition is now the single source of truth for
the port list; only the name mapping needed to survive.

This means a Vivado-discovered interface, once mapped, is represented on disk
identically to how `basic_peripheral.ip.yml`'s `fifo_write` interface looks:

```yaml
- name: fifo_write
  type: xilinx.com:interface:fifo_write:1.0
  mode: master
  portNameOverrides:
    WR_DATA: fifo_wr_data
    WR_EN: fifo_wr_en
    ALMOST_FULL: fifo_almost_full
  useOptionalPorts:
    - ALMOST_FULL
```

No `conduitPorts` key, no special-cased YAML shape — it reads exactly like a
slave AXI4-Lite interface with a few renamed signals.

## A supporting schema change

Several fields that the webview needs to be able to clear explicitly —
`physicalPrefix`, `description`, `uiPage`, `uiGroup`, and a couple of others —
were tightened to allow `null` in `ipcraft-spec`'s JSON Schema (and
regenerated into `src/domain/ipcore.types.ts` /
`src/webview/types/ipCore.d.ts`). This is not specific to the Vivado catalog,
but the catalog work is what surfaced it: a Vivado-discovered interface like
`fifo_write` has no meaningful default physical prefix, so the editor needs
to be able to write `physicalPrefix: null` rather than coercing it to an
empty string or omitting the key inconsistently.
