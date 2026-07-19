# Data Inspector Architecture

## Purpose and boundaries

The Data Inspector decodes arbitrary-width values from waveforms, ILA or
SignalTap captures, register reads, and manually entered literals. It is a
standalone analysis tool: it does not modify `.mm.yml`, `.ip.yml`, or generated
HDL.

The Memory Map editor's Debug Mode remains the quickest way to try a temporary
value against one open register. Use the Data Inspector when the task needs any
of the following:

- a value that is not tied to an open memory map;
- multiple named inputs or derived values;
- a reusable field layout or transform graph;
- VCD, CSV, Vivado ILA, or SignalTap sample navigation; or
- numeric, enum, floating-point, fixed-point, or expected-value decoding.

Importing a memory-map register is deliberately one-way. The inspector copies
the register width, field names, ranges, descriptions, and enum values. It does
not copy addresses, access modes, or reset behavior, and it never links the
recipe back to the memory map.

## User surfaces

The extension exposes three commands:

- **IPCraft: Open Data Inspector** opens a session panel.
- **IPCraft: Open Register in Data Inspector** opens the panel after copying a
  selected workspace register layout.
- **IPCraft: New Data Inspector** creates a reusable `*.ipci.yml` recipe and
  opens it in the Data Inspector Recipe Editor.

Both the session panel and recipe editor load the same `dataInspector` webview
bundle and therefore expose the same workbench. The desktop layout contains a
Library on the left, Bits and Transform views in the center, and a contextual
Inspector on the right. The side rails and center split can be resized or
collapsed, and either center view can be maximized. Narrow layouts use Value,
Bits, Transform, Library, and Inspect navigation tabs.

![Data Inspector workbench](../images/data-inspector-workspace-light.png)

The Library creates inputs and any of the twelve supported operations. The Bits
view shows a continuous MSB-to-LSB ribbon with source provenance and field
overlays. The Transform view is a React Flow canvas. Selecting an input or
operation makes its value active in the ribbon and exposes its editable
properties in the Inspector.

### Continuous Vector Bits

![Continuous Vector Bits with source and field overlays](../images/data-inspector-bit-visualizer-light.png)

The visualizer renders lanes virtually, keeping the live DOM bounded for values
up to 4096 bits. Every lane aligns its source-provenance band, bit cells, and
field segments to the same range geometry. Overview zoom renders compact lane
values; field and bit zoom render individual states with nibble and byte
separators. Transform-inserted and masked ranges remain explicit, and Jump to
bit moves keyboard focus to the containing lane.

## Four-state value model

`src/dataInspector/BitVector.ts` is the value primitive. Every bit is `0`, `1`,
`X`, or `Z`, so values above JavaScript's safe-integer range and unresolved HDL
states remain exact. Supported widths are 1 through 4096 bits.

The ordering rules are fixed:

- The logical range is `[width-1:0]`; bit 0 is the LSB and appears on the right.
- The rightmost literal digit maps to the lowest bits.
- `concat(A, B)` places `A` above `B`.
- Byte order and word order are independent capture-import settings.
- Truncation and extension are explicit operations, never inferred transforms.

`X` and `Z` remain distinct in stored, sliced, and concatenated values. Logical
operations treat either as unresolved. AND with a known zero produces zero; OR
with a known one produces one; otherwise an unresolved operand produces `X`.
XOR and NOT also produce `X` from unresolved operands. Shifts insert known
zeros, sign extension repeats a known sign bit, and an unresolved sign bit
extends as `X`.

## Literal parsing and formatting

`src/dataInspector/parseLiteral.ts` accepts:

- sized Verilog binary and hexadecimal literals;
- VHDL `b"..."` and `x"..."` literals;
- C-style `0b...` and `0x...` values;
- unsized binary and hexadecimal values; and
- decimal values with an explicit width.

Underscores are accepted as separators. Unsized binary and hexadecimal values
derive their natural width from their digits, including leading zeros, and may
be zero-extended by an explicitly larger Width. A value that exceeds the chosen
width is rejected rather than truncated. Sized HDL literals must agree with an
explicit Width.

Weak HDL states normalize as `L` to `0`, `H` to `1`, and `U`, `W`, or `-` to
`X`, with a warning. The original entered text remains available alongside the
normalized vector.

## Fields and interpretations

Every field belongs to an overlay group and to a source. Ranges cannot overlap
within one group, but different groups may describe alternative views of the
same bits. `src/dataInspector/fieldLayout.ts` validates ranges, projects source
fields through transforms, and decodes selected ranges without repacking them.
The Memory Map `LayoutEngine` is intentionally not used.

Fields support hexadecimal, binary, unsigned, signed, enum, IEEE-754 float, and
signed fixed-point interpretations. Numeric interpretations return an unknown
result when required bits contain `X` or `Z`. An optional expected literal adds
a pass, fail, or unknown comparison.

The Fields inspector also provides register-layout import, search, overlay-group
management, and field property editing. Imported provenance is informational;
it does not create a live link.

## Transform graph

Recipes store transforms as a topologically ordered `steps` array. The canvas is
a projection of that model, not a separate graph format: `inputId` and
`operandId` references become edges between stable source and step IDs.

The supported operations are:

| Operation                  | Width behavior                                   |
| -------------------------- | ------------------------------------------------ |
| `concat`                   | Adds the high input width and low operand width  |
| `slice`                    | Produces the inclusive `[msb:lsb]` range         |
| `and`, `or`, `xor`         | Require equal widths and preserve width          |
| `not`                      | Preserves width                                  |
| `shiftLeft`, `shiftRight`  | Preserve width and insert zeros                  |
| `zeroExtend`, `signExtend` | Increase to an explicit width                    |
| `truncate`                 | Keeps the low bits at an explicit smaller width  |
| `byteSwap`                 | Reverses bytes and requires a byte-aligned width |

`src/dataInspector/recipeGraph.ts` converts recipes to graph nodes and edges and
applies connect, rewire, add, and delete edits. A stable topological sort keeps
unaffected steps in their previous relative order. Cycle-producing connections
are rejected. New unwired operations remain webview-local drafts until all
required connections and parameters are valid.

Evaluation remains a pure, instantaneous pass in
`src/dataInspector/evaluateRecipe.ts`. It produces each value, its width,
per-bit source provenance, masked bits, inserted bits, dropped ranges, and
errors. There are no simulation clocks or user-defined expressions.

See [Data Inspector visual workspace](data-inspector-visual-workspace.md) for
the canvas interaction and persistence details.

## Capture import

`src/dataInspector/vcd.ts` lazily indexes selected VCD signals and exposes sample
timestamps, timescale, values, and changed bits. Selecting multiple VCD signals
creates multiple sources; the inspector never guesses how to combine them.

`src/dataInspector/csvCapture.ts` parses generic CSV and detects common Vivado
ILA and SignalTap header conventions. The UI imports one selected signal column
at a time with explicit radix, byte order, word order, and word width. Imported
samples remain transient and the timeline currently labels CSV samples by row
number rather than vendor metadata or time columns.

## Recipe persistence

The canonical recipe schema is
`ipcraft-spec/schemas/data_inspector.schema.json`; generated TypeScript types
live in `src/domain/dataInspector.types.ts`. A version 1 recipe contains:

- named sources and widths;
- fields, overlay groups, interpretations, and expected values;
- ordered transform steps; and
- lane width, zoom, selected overlay group, and optional canvas positions.

Recipes deliberately exclude pasted samples, VCD data, CSV rows, selection,
panel sizes, maximized state, and capture history. Reopening a recipe restores
the decode structure, then waits for a new sample.

The file-backed editor validates schema and semantics before writing. Recipe
updates use the same revisioned webview protocol as the other editors:
`useDataInspectorSync` tracks document versions, and
`DataInspectorRecipeEditorProvider` rejects stale updates and requests a resync.
Canvas moves are persisted only at drag end.

## Implementation map

| Area                             | Primary files                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Commands and providers           | `src/commands/DataInspectorCommands.ts`, `src/providers/DataInspectorPanel.ts`, `src/providers/DataInspectorRecipeEditorProvider.ts` |
| Four-state engine                | `src/dataInspector/BitVector.ts`, `parseLiteral.ts`, `transforms.ts`, `formatValue.ts`                                               |
| Recipe validation and evaluation | `src/dataInspector/recipe.ts`, `validateRecipe.ts`, `evaluateRecipe.ts`, `recipeGraph.ts`                                            |
| Capture import                   | `src/dataInspector/vcd.ts`, `csvCapture.ts`                                                                                          |
| Webview                          | `src/webview/dataInspector/`                                                                                                         |
| Message contract                 | `src/shared/messages/dataInspector.ts`                                                                                               |
| Browser harness                  | `src/test/browser/data-inspector.html`                                                                                               |

Unit tests under `src/test/suite/dataInspector/` cover parsing, four-state
operations, fields, numeric decode, recipes, graph edits, capture parsing,
commands, and synchronization. Playwright suites in
`src/test/browser/data-inspector*.spec.ts` cover the real compiled workbench,
canvas gestures, responsive layouts, keyboard behavior, and capture flows.
