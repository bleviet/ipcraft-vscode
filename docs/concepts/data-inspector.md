# IPCraft Data Inspector — Design Reference

## Summary

Build a dedicated, non-destructive Data Inspector for decoding an arbitrary-width
value — copied from a simulation waveform, a Vivado ILA, a SignalTap capture, a
register read, or typed in by hand — into named bit fields, the same way the Memory
Map editor already lets you name and decode the bits of a register. A captured
signal, register value, or derived value is modeled as a fixed-width vector divided
into named fields, but it remains separate from the memory-map hardware contract.
The tool never modifies `.mm.yml`, `.ip.yml`, either format's schema, or HDL
generation. It may read a `.mm.yml` file when the user asks to copy a register
layout into the inspector, but that import is one-way and never writes to the
source document.

The product supports two depths:

- The existing Memory Map **Debug Mode** remains a quick, temporary single-register
  preview (see next section).
- The new **Data Inspector** handles pasted signals, imported register layouts,
  multiple sources, composition, reusable recipes, and later capture timelines.

The primary first-use flow is: open the inspector, paste a value, define or import
fields, and decode it exactly.

## Relationship to the existing Memory Map Debug Mode

Debug Mode ships today (issue #39): `src/webview/hooks/useDebugMode.tsx` provides a
document-wide flag, toggled in
`src/webview/shared/components/EditorHeader.tsx`, under which register value
exploration (bit clicks and typed values in the bit-field visualizer and fields
table) stays local to the webview and is never written back to the `.mm.yml` file
(`src/webview/components/register/RegisterEditor.tsx` applies `debugOverrides` on
top of fields and swallows updates while the mode is on). Browser coverage lives in
`src/test/browser/debug-mode-toggle.spec.ts`.

Debug Mode is deliberately **not** expanded into the multi-source workspace. It
stays the in-place quick look; the Data Inspector is a separate tool for everything
deeper. Its existence already proves demand for "explore a value without touching
the file", and it is a natural later entry point ("Open Register in Data
Inspector").

During the Data Inspector foundation phase, Debug Mode's transient value
calculations migrate to the same four-state `BitVector` used by the inspector.
This is an engine reuse only: Debug Mode keeps its existing non-persistent UI and
remains separate from recipe persistence, multiple sources, and composition.

## Core design decisions

Each decision below is settled; the rationale is recorded so it does not get
relitigated.

**1. Four-state values, not big integers.**
A value pasted from a simulation waveform or a VHDL/Verilog literal can contain `X`
(unknown/uninitialized) and `Z` (high-impedance) bits, not just 0 and 1. A plain
big integer cannot represent that. The value model is a **four-state bit vector**
— each bit is `0`, `1`, `X`, or `Z` — with conservative truth tables: AND with a
known 0 is 0 regardless of the other bit; OR with a known 1 is 1 regardless;
anything else touching an unknown bit stays unknown; shifts insert known zeros.
Decimal, enum, float, and fixed-point interpretations are suppressed when any
required bit is unknown — the UI says so instead of quietly showing a wrong number.
This mainly matters for pasted literals and simulation data (hardware captures are
normally fully resolved), but since HDL literals and simulation are explicit
targets, the engine is built four-state from day one rather than retrofitted.

**2. Never guess bit order, word order, or byte order.**
Ordering is always an explicit choice with fixed, unambiguous vocabulary — never
inferred. The normative rules are listed under "Architecture and interfaces".
Nothing in the tool is ever labeled "bit reversal" unless it actually reverses
bits; conflating byte swap, word order, and bit reversal is a classic source of
debugging-tool bugs.

**3. Recipes and samples are split; recipes get their own file.**
The _recipe_ (field names, bit ranges, the ordered list of transform steps —
"take these two, mask this, shift that") is small, contains no captured data, and
is exactly the kind of thing worth saving and sharing with a teammate via git — so
it gets its own file type (`*.ipci.yml`), separate from any spec file.
The _sample value_ (the actual bits pasted or captured) stays transient and is
never written to the recipe. Through phases 1–6 the inspector does not persist it
at all; any later snapshot is an explicit action using a separate
format. This yields shareable, reusable setups ("here is how we always decode the
AXI address bus on this project") without ever touching the spec files or opening
a "is debug data allowed in `.mm.yml`" schema conversation.

**4. Importing a register's layout copies, never links.**
Pulling field names, bit ranges, descriptions, and enums from a Memory Map
register copies them into the recipe. There is no live link back to the source —
no sync, no "the spec changed, does my debug recipe now show a stale field" bug
class. Addresses, access modes, and reset semantics do not come along; they are
spec concepts, not debug concepts.

**5. The transform model is boring on purpose.**
An ordered list of typed, width-checked steps — not a free-form visual node graph
and not an evaluated script. A node editor would be more "powerful" and
considerably more work, for a workflow that is almost always linear in practice
("take these two words, mask this, shift that, read as signed"). This matches the
project's bias toward the simplest thing that works.

**6. A width ceiling chosen on purpose, not discovered by a crash.**
Support 1 to 4096 bits, with the internal representation chunked so the ceiling
can be raised later without a redesign. Wide values get virtualized rendering so a
4096-bit vector never produces thousands of live DOM elements.

**7. Panel first, file format second.**
The first shippable slice is the paste-and-decode interaction as a plain command
that opens a session-only webview panel — no new file type, no
`CustomTextEditorProvider`, nothing to validate on disk. Building the recipe file
format, custom editor, and commands before a single person has used the
interaction model is speculative plumbing; if the interaction changes after real
use, nothing durable (a file format, a schema) has to change with it. Recipes
follow once the interaction is validated. Same destination, cheaper first step.

**8. Paste-any-value is the primary entry point.**
The main user is an engineer with a hex string copied from an ILA, SignalTap, or
simulator console who may not have any `.mm.yml` open at all. Importing a register
layout is an optional accelerator on top of pasting, never a prerequisite.

## Product and UX

- Add **IPCraft: Open Data Inspector** as a session-only webview panel for the
  first release.
- Use a VS Code-native "precision instrument panel": respect the active theme,
  high contrast, reduced motion, and existing IPCraft field colors/patterns.
- Organize the workspace into:
  - A source rail containing physical inputs and named derived outputs.
  - A sticky value composer with width, radix, validation, copy, and clear
    actions.
  - A continuous bit ribbon with field and source overlays.
  - A decoded-field table.
  - A collapsible ordered transform recipe.
- Paste-any-value is the primary empty-state action; register-layout import is an
  optional accelerator.
- Render wide vectors as configurable 8/16/32/64-bit lanes, defaulting to 32 bits:
  - MSB lane first, with sticky `[msb:lsb]` gutters.
  - Nibble and byte separators.
  - Overview, field, and bit zoom levels.
  - Virtualized lanes and "go to bit/range" for wide vectors.
  - No mandatory horizontal scrolling at overview or field zoom.
- Combining sources produces one continuous ribbon. Subtle source bands and
  boundary labels show which input supplied each range.
- Masked-out bits remain visible but dimmed. Shifted or truncated bits receive
  explicit dropped-bit indicators — never silent.
- Selecting a field links its ribbon range, decoded row, and source provenance.
- Responsive layout:
  - Wide: source rail, ribbon, and transform/decode inspector side by side.
  - Medium: inspector becomes tabs or a drawer.
  - Narrow: Value, Bits, Fields, and Recipe tabs; bits are never hidden.
- Use roving keyboard focus instead of one tab stop per bit. Provide lane
  navigation, field search, range selection, and screen-reader announcements.

### What it could look like on screen

Primary flow — paste a value, get it decoded:

```
 IPCraft: Open Data Inspector

 Paste a value:  [ 64'h0001_2000_0000_3F00                        ]
                  auto-detected: 64 bits, hex, all bits known

 ┌─ bit ribbon ──────────────────────────────────────────────────┐
 │ 63            48 47            32   31            16 15      0│
 │ 0000000000000001 0010000000000000   0000000000000000 0011111100000000│
 └───────────────────────────────────────────────────────────────┘
                (zoom: overview / by-field / by-bit)

 Fields (define new, or "Import from register...")
 ┌──────────────┬───────────┬────────────┬────────────────────┐
 │ name          │ bits      │ raw        │ shown as            │
 ├──────────────┼───────────┼────────────┼────────────────────┤
 │ RESERVED      │ 63:40     │ 0x0001_20  │ hex                 │
 │ BASE_ADDR     │ 39:8      │ 0x00_003F  │ hex                 │
 │ FLAGS         │ 7:0       │ 0x00       │ binary  00000000    │
 └──────────────┴───────────┴────────────┴────────────────────┘

 [ Save as recipe... ]   (recipe = field layout + steps, not this value)
```

Unknown bits are shown, not hidden or guessed:

```
 Paste a value:  [ 16'b0000_XXXX_0011_ZZZZ ]

 Fields
 ┌────────────┬────────┬────────────┬──────────────────────────┐
 │ name        │ bits   │ raw        │ shown as                  │
 ├────────────┼────────┼────────────┼──────────────────────────┤
 │ STATE       │ 15:12  │ 0000       │ decimal: 0                │
 │ COUNTER     │ 11:8   │ XXXX       │ decimal: -- (unknown bits)│
 │ MODE        │ 7:4    │ 0011       │ decimal: 3                │
 │ IO_BUS      │ 3:0    │ ZZZZ       │ hi-Z -- not driven        │
 └────────────┴────────┴────────────┴──────────────────────────┘
```

Combining two values — explicit order, explicit steps, no guessing:

```
 Inputs
   A: ADDR_HI  = 32'h0001_2000    [ Import from register... ]
   B: ADDR_LO  = 32'h0000_3F00    [ Import from register... ]

 Steps (runs top to bottom)
   1. concat( A, B )         -> A at bits [63:32], B at bits [31:0]
   2. mask( 0xFFFF_FF00 )    -> result: 0x0001_2000_0000_3F00
   3. shift right 8          -> result: 0x0000_0120_0000_003F

   width after each step shown live; dropped/extended bits flagged, never silent
```

Later phase — stepping through a captured waveform:

```
 Sample:   [ 12 ]   <prev   |------o------------------|   next>     (of 400)

 Field         Value
 -----         -----
 STATE         RUNNING     <- changed since the last sample (highlighted)
 COUNT         128
 ERROR_FLAG    0
```

## Architecture and interfaces

### Value model and serialization

- Introduce a pure four-state `BitVector` abstraction supporting 0, 1, X, and Z.
  Plain `BigInt` may back known-value masks internally but is not the public value
  model.
- Serialize vectors across the extension/webview boundary as width-qualified
  strings (e.g. `"64'h..."`), never JavaScript `number` or raw `BigInt` — `BigInt`
  is not message-safe anyway, and `number` loses precision above 53 bits.

### Canonical ordering rules (normative)

- The logical range is `[width-1:0]`. Bit 0 is the LSB; the MSB is always drawn on
  the left.
- When a string is pasted, the rightmost character always maps to the lowest bits.
- `concat(A, B)` always places A at the high end and B at the low end.
- Word order and byte order are independent, explicit settings when importing
  multi-word data.
- Overflow, extension, and truncation are never inferred silently. A value that
  does not fit is an error until the user chooses an explicit width-changing
  action.

### Parsing and formatting

- Raw hexadecimal, binary, and decimal accept underscore digit separators.
- An unsized binary value gets its width from its binary digit count. An unsized
  hexadecimal value gets four bits per hexadecimal digit. Leading zeros are
  significant in both forms and therefore preserve width.
- Decimal input, including positive decimal input, requires an explicit width;
  the inspector never derives width from magnitude. Negative decimal additionally
  requires an explicit signed interpretation and is encoded as two's complement
  at that width.
- Sized HDL literals such as Verilog `128'h...` use their declared width. VHDL
  literals such as `x"..."` and `b"..."` use the digit-derived rules above when no
  separate width is declared.
- A literal whose digits do not fit its declared width is not silently truncated,
  and a shorter literal is not silently extended. Overflow, zero/sign extension,
  and truncation require explicit user choices.
- Strong `X` and `Z` states are preserved. Weak HDL states normalize as `L` to
  `0`, `H` to `1`, and `U`, `W`, or `-` to `X`, with a warning. The original
  pasted text is retained alongside the normalized vector so the user can copy
  it unchanged or correct it.

### Four-state semantics

- `X` and `Z` are both unknown operands for logical and arithmetic transforms.
  `Z` is preserved by storage, concatenation, and slicing, but a transform that
  must compute from it produces `X`, never a driven `Z`.
- AND produces `0` when either operand is known `0`; otherwise it produces `1`
  only for two known `1` operands and `X` for every unresolved case. OR produces
  `1` when either operand is known `1`; otherwise it produces `0` only for two
  known `0` operands and `X` for every unresolved case.
- XOR produces the XOR of two known bits and `X` if either input is `X` or `Z`.
  NOT maps `0` to `1`, `1` to `0`, and either `X` or `Z` to `X`.
- Logical shifts preserve width, drop shifted-out bits with an explicit UI
  indicator, and insert known zeros. A shift by an amount greater than or equal
  to the input width produces an all-zero vector of the same width.
- Zero extension inserts known zeros. Sign extension repeats a known sign bit; an
  `X` or `Z` sign bit fills every added bit with `X`. Truncation is explicit and
  reports the dropped range.
- Decimal, enum, float, and fixed-point interpretations are suppressed when
  required bits are unknown.

### Field layouts and overlay groups

- Every inspector field belongs to an overlay group. Fields use a default group
  unless the user creates and names another one.
- Field ranges may not overlap within one group. Ranges in different named groups
  may overlap, which supports intentional alternative interpretations of the same
  bits without weakening collision checks accidentally.
- Overlay groups are an inspector-only display and recipe concept. Importing a
  register initially places its copied fields in one group, and the Memory Map
  editor's existing field-collision rules remain unchanged.

### Register import semantics

Importing a memory-map register copies its width, field names, ranges,
descriptions, and enums. It does not copy addresses, access modes, or reset
semantics, and it does not maintain a live link to the source `.mm.yml`.

Reuse only the field-range **geometry** helpers extracted from
`src/webview/components/BitFieldVisualizer.tsx` (segment-per-lane math and
range-to-pixel mapping). Do **not** route inspector values through
`src/webview/algorithms/LayoutEngine.ts` — that module packs and repacks field
offsets, and the inspector must never repack a pasted value's layout.

### Saved recipe interface

After the panel interaction is validated, add `*.ipci.yml`,
**IPCraft: New Data Inspector**, **Open Register in Data Inspector**, and a custom
editor provider. Phase 3 adds
`ipcraft-spec/schemas/data_inspector.schema.json` as the sole source of truth for
the recipe format. Its JSON Schema properties use camelCase, and the repository's
type-generation workflow produces the corresponding TypeScript types; generated
types are never edited by hand. A versioned recipe stores:

- Stable source and field IDs.
- Input names and widths.
- Copied field definitions and optional import provenance.
- Ordered typed transform steps.
- Named outputs.
- Named field overlay groups.
- Per-field display interpretations.
- UI preferences needed to reproduce the view.

Transient sample values and capture histories are not persisted in recipes or by
the inspector through phases 1–6. A later saved-snapshot feature must be an
explicit user action and use a separate snapshot format.

### Transform interface

An ordered, width-checked step list (see decision 5):

- concat
- slice
- and, or, xor, not (mask operations)
- logical left/right shift
- zero/sign extension
- explicit truncation
- byte swap

Each step shows its input widths, output width, a result preview, and inline
errors. Downstream results become unavailable when a dependency is invalid; no
stale result is ever displayed.

## Delivery phases

1. **Foundation**
   - Implement the four-state vector engine, parsers, formatters, truth tables,
     and ordering rules as pure, unit-tested modules.
   - Migrate the existing Debug Mode's transient value calculations to the shared
     `BitVector` without changing its UI, persistence, or single-register scope.
   - Extract the reusable field-range geometry from `BitFieldVisualizer` (not
     `LayoutEngine.ts` — see above).
   - Build cross-lane field segmentation and a virtualized lane-rendering
     prototype.
   - Enforce the deliberate 1–4096-bit range.

2. **Panel-first paste and decode**
   - Add the session-only **IPCraft: Open Data Inspector** command and webview
     panel.
   - Support exact pasted values, X/Z display, manual field creation,
     register-layout import (copy, not link), zoomable lanes, and the
     decoded-field table.
   - Add hex, binary, and raw four-state display. Numeric interpretations wait
     until phase 5.
   - Keep all panel state transient while gathering feedback on the interaction
     model. Nothing persists to disk in this phase — this is the cheap slice that
     proves the interaction before any file format or document-provider work.

3. **Shareable recipes**
   - Add the versioned `*.ipci.yml` custom editor and the canonical
     `ipcraft-spec/schemas/data_inspector.schema.json` recipe schema, with
     camelCase properties and generated TypeScript types.
   - Save field layouts, sources, outputs, and view preferences without saving
     samples.
   - Support opening a recipe directly and saving a panel session as a recipe.
   - Add format-preserving recipe edits and schema validation, independent of
     `.mm.yml`.

4. **Composition**
   - Add multiple named inputs and the ordered transform builder.
   - Provide explicit concatenation, masking, shifting, slicing, extension,
     truncation, and byte-swap operations.
   - Show source provenance directly on the combined ribbon.
   - Require explicit operand order and display a live width equation before
     commit.

5. **Numeric decode toolbox**
   - Add unsigned and signed integer interpretations.
   - Add expected-value comparisons with pass/fail/unknown states.
   - Reuse the existing named-value (enum) decoding concept for imported and
     custom fields.
   - Add IEEE-754 formats where field width matches a supported encoding.
   - Add configurable signed Q-format fixed-point interpretation with an explicit
     fractional-bit count. DSP/ADC gain-scaling checks are a common debug task,
     but numeric decoding remains in phase 5 after recipes and composition.
   - Keep raw bits visible alongside every interpreted result.

6. **Capture timeline**
   - Add VCD import as the first waveform integration — IPCraft-generated
     testbenches can emit VCD (see `src/generator/templates/cocotb_dump.v.j2` and
     `src/generator/testbench/engines/IcarusEngine.ts`), providing a way to
     produce inputs for development.
   - Add representative, checked-in VCD fixtures during this phase; generated
     integration snapshots are not waveform-parser fixtures.
   - Parse only selected signals and build a lazy sample/time index rather than
     loading a full waveform into UI state.
   - Add previous/next sample navigation, direct time/sample selection, and
     changed-bit/changed-field highlighting.
   - Treat FST as a separate adapter; its binary format and dependency
     requirements differ from VCD.

7. **Capture interchange and advanced integrations**
   - Add CSV clipboard/file import with explicit signal-column, radix, width,
     byte-order, and word-order mapping.
   - Add ILA and SignalTap presets only after representative real exports become
     test fixtures.
   - Later candidates: sample-to-sample comparison, value search across captures,
     explicitly saved snapshots in a separate snapshot format, and live JTAG
     connections. These plug into the same inspector as additional data sources;
     they are not prerequisites for anything above.

## Tests and acceptance criteria

- Exact round trips for 64-, 128-, 1024-, and 4096-bit values, including bits
  above JavaScript's safe-integer boundary.
- Correct parsing and formatting of raw, Verilog, and VHDL literals with
  separators and X/Z states.
- Binary and hexadecimal digit counts preserve exact widths and leading zeros;
  decimal input is rejected without an explicit width, and negative decimal is
  rejected without an explicit signed interpretation.
- Weak HDL states normalize as specified while the original pasted text remains
  available unchanged.
- Known fields remain decodable when unrelated fields contain unknowns.
- `concat(A, B)` and `concat(B, A)` visibly and numerically differ as specified.
- Byte swap, word ordering, bit reversal, and concatenation cannot be confused or
  silently substituted for one another.
- AND, OR, XOR, NOT, shift, slice, extension, and truncation follow the specified
  fixed-width four-state semantics, including Z-as-unknown, overshifts, and
  unknown-sign extension.
- Inspector field overlaps are accepted only across named overlay groups; Memory
  Map field-collision behavior is unchanged.
- A combined ribbon clearly identifies each source boundary; masked bits stay
  visible.
- Imported register layouts never modify, and never remain linked to, the source
  `.mm.yml`.
- Reopening a recipe restores definitions and transforms but not transient
  samples.
- Recipe validation uses `ipcraft-spec/schemas/data_inspector.schema.json`, whose
  camelCase properties generate the TypeScript recipe types.
- Numeric interpretations reject incompatible widths and unknown required bits.
- VCD navigation highlights changes against the immediately preceding selected
  sample.
- A 4096-bit vector maintains a bounded DOM size through lane virtualization.
- Keyboard navigation, screen-reader announcements, forced-color patterns, and
  640/900/1440-pixel layouts receive component and browser coverage.
- Verification gates: targeted Jest tests with the repository config, browser
  tests, type-check, lint, and compile.

## Assumptions and non-goals

- The product name is **Data Inspector**; the saved recipe suffix is
  `*.ipci.yml`.
- Both IEEE-754 float and Q-format fixed-point interpretations are committed
  deliverables of the numeric decode toolbox (phase 5).
- The first user-testable release is panel-first; recipe persistence follows
  after interaction validation.
- Numeric decoding is prioritized before waveform or CSV ingestion.
- Samples are not persisted through phases 1–6; recipes are intentionally
  shareable and source-control friendly. Any later saved snapshot is explicit and
  uses a separate format.
- The existing Memory Map Debug Mode remains a quick-look feature and is not
  expanded into the multi-source workspace.
- The inspector makes no changes to `.mm.yml`, `.ip.yml`, their schemas, or HDL
  generation. Importing a register may read `.mm.yml` but never modifies the
  source file. Today's register/field editing screens (`FieldsTable`,
  `BitFieldVisualizer`) are unchanged — this is a new, separate tool, not a
  rework.
- No arbitrary JavaScript/expression evaluation, free-form node graph, temporal
  protocol decoder, simulation control, or live JTAG connection is included in
  the initial phases.
