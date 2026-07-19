# IPCraft Data Inspector Visual Transform Workspace — Design Reference

## Summary

The Data Inspector's transform pipeline is currently edited as a numbered list:
an operation grid, two builder dropdowns, an "Add step" button, and an ordered
step list with drag-to-reorder. This works, but it hides the actual shape of the
computation. A pipeline that concatenates two sources, masks the result, and
feeds two different branches is a dataflow graph, and the user has to
reconstruct that graph mentally from a flat list of ID references.

This document describes a visual transform workspace in the style of Simulink or
Scilab/Xcos: sources and transform steps appear as blocks on a canvas,
the user drags new operations in from a palette, wires blocks together by
dragging between ports, and every block shows its live evaluated value and
width. The canvas makes the dataflow visible, makes fan-out (one value feeding
several steps) natural instead of invisible, and turns the inspector into
something a user can demonstrate and reason about at a glance.

The load-bearing insight is that **the recipe model is already a dataflow
graph**. A saved recipe's `steps` reference earlier values by stable string ID
(`inputId`, `operandId`), and sources seed the value environment — see
`evaluateRecipe` in `src/dataInspector/evaluateRecipe.ts`.
Only the UI flattens this graph into a list. The canvas is therefore a new
_projection_ of the existing model, not a new model. The only genuinely new
persisted data is node positions.

This document extends `docs/concepts/data-inspector.md`, the parent design
reference for the Data Inspector. The four-state `BitVector` value model,
canonical ordering rules, parsing, field layouts, register import, recipe format,
and transform semantics remain authoritative.

This document replaces parent decision 5, which chose a list instead of a visual
graph. The existing list has shown that the saved step model works, but fan-out
and multi-step dependencies are hard to understand in that view. The visual
workspace is now worth the added UI work. The saved transform model is still the
same ordered list of steps; the graph is another way to view and edit it.

Two decisions are fixed up front:

- The canvas engine is **React Flow** (`@xyflow/react`), added as a runtime
  dependency and bundled by webpack like every other webview dependency.
- The Data Inspector uses an **IP Core-style workbench**: a permanent Library
  on the left, Continuous Vector Bits above the Transform canvas in a resizable
  center column, and a selection-driven Inspector on the right. The canvas is
  the only transform view; the former linear step list is removed.

What does not change: `src/dataInspector/BitVector.ts`,
`src/dataInspector/transforms.ts`, `src/dataInspector/evaluateRecipe.ts`, the
twelve-operation set, the webview message contract in
`src/shared/messages/dataInspector.ts`, and the rule that sample values are
transient and never persisted.

## Implementation status

The workspace described here is implemented in the current change. It includes
graph editing, saved node positions, operation drops, live values,
error display, source highlighting, resizable panels, and browser tests for the
main editing flows.

The React Flow runtime and styles are bundled into the Data Inspector webview.
Development-build sizes are uncompressed and should not be used as
download-size estimates.

One browser issue found during implementation was that the first fit could run
before the nodes had a measured size. This left the graph outside the visible
area. The canvas now waits until the nodes are ready before fitting the view.

## Relationship to the existing Data Inspector design

The parent document's "Transform interface" section specifies an ordered,
width-checked step list where each step shows input widths, output width, a
result preview, and inline errors, and where downstream results become
unavailable when a dependency is invalid. All of those requirements carry over
verbatim to the canvas; they are simply rendered on node cards and edges instead
of list rows.

The Library exposes the twelve operations. Clicking or dropping an item creates
it on the canvas, while the contextual Inspector edits the
selected source or operation. There is no parallel list editor.

Both Data Inspector surfaces get the canvas automatically, because both load the
same `dataInspector` webpack bundle: the session-only panel
(`src/providers/DataInspectorPanel.ts`) and the file-backed `*.ipci.yml` custom
editor (`src/providers/DataInspectorRecipeEditorProvider.ts`).

## Core design decisions

Decisions are numbered so later work can cite them instead of relitigating.

1. **React Flow, bundled by webpack.** `@xyflow/react` is MIT-licensed, React
   18 compatible, and provides node dragging, edge routing, connection
   validation hooks, pan/zoom, marquee selection, minimap, and keyboard
   accessibility. It ships inside the existing `dataInspector` entry in
   `config/webpack.config.js`; its stylesheet flows through the existing
   `css-loader` + `MiniCssExtractPlugin` chain, so no CSP or HTML-generation
   changes are needed. The measured development-build sizes are listed in the
   implementation status above.
2. **The canvas is a projection, not a second model.** Graph structure is
   derived entirely from `steps[].inputId` / `steps[].operandId`. The canvas
   introduces no parallel graph document. The
   only new persisted state is node x/y positions (decision 5).
3. **Step array order stays authoritative.** `validateRecipeSemantics`
   (`src/dataInspector/recipe.ts`) and `evaluateRecipe` both walk `steps` in
   array order and treat forward references as errors. The canvas honors this:
   every edge-changing gesture serializes the graph back to a step array using a
   stable topological sort seeded by the previous array order, so unaffected
   steps keep their relative positions and document diffs stay minimal. Cycles
   are rejected at connect time via React Flow's `isValidConnection`; a cycle
   cannot be represented in the linear array, so rejecting it before commit is
   the only coherent option. Position-only gestures never reorder steps.
4. **The operand is a second labeled input port.** Binary operations expose two
   named input ports rather than one anonymous pair: `hi` and `lo` for concat
   (matching `concat(A, B)` placing A at the high end — a normative ordering
   rule in the parent document) and `a` / `b` for and, or, xor. Port labels are
   always rendered; the user never guesses which operand lands where.
5. **Positions persist in an optional `view.canvas` block.** The recipe schema
   gains `view.canvas.nodes: [{ id, x, y }]`, covering source and step nodes
   uniformly. The block is optional and additive: recipes without it
   validate unchanged and open with deterministic auto-layout. The schema
   `version` stays `1`.
6. **One valid gesture, one document update.** Connecting an edge, dropping a
   operation, deleting a step, or finishing a node drag produces at most one
   `updateRecipe` message through the existing debounced,
   `baseDocVersion`-guarded channel in
   `src/shared/messages/dataInspector.ts`. Before sending, the webview runs
   `validateRecipeSemantics`. A valid result sends one update. An invalid result
   stays local so the user can see and correct it, and sends no document update.
   A palette drop creates only a local draft and also sends no update.
7. **Canvas primary, list kept.** The lower Transform pane renders a
   `Canvas | List` toggle. The toggle is session-local webview state in v1 (not
   persisted in the recipe), defaulting to canvas.
8. **Hand-rolled auto-layout, no layout dependency.** Transform pipelines are
   small — a handful to a few dozen steps. Auto-layout is a pure function
   (longest-path rank from sources, left-to-right layers, in-rank order by
   topological index) of roughly fifty lines, unit-tested like the rest of
   `src/dataInspector/`. dagre and elkjs are not added.

## Product and UX

### Node kinds

- **Source node.** One per `sources[]` entry. Shows the source badge letter
  (A, B, ...), name, width badge, and the live sample value in hex (or the
  four-state binary rendering when X/Z bits are present, per the parent's
  formatting rules). No input ports; one output port.
- **Step node.** One per `steps[]` entry. Shows the operation symbol and label
  from `TRANSFORM_OPERATIONS`, the step ID, inline parameter fields (see the
  port model table), the evaluated output width, and the live evaluated value.
  When `evaluateRecipe` reports a step error, the card shows an error badge with
  the validator's message text, and its value area shows "unavailable" — never
  a stale result, matching the parent's rule.

### Ports and edges

- Unary operations (slice, not, shiftLeft, shiftRight, zeroExtend, signExtend,
  truncate, byteSwap) have one input port. Binary operations (concat, and, or,
  xor) have two labeled input ports. Every source and step has one output port.
- Fan-out is allowed and encouraged: one output port may feed any number of
  downstream input ports. The model already permits this; the canvas finally
  makes it visible.
- Each input port accepts at most one edge. Dragging a new connection onto an
  occupied input port replaces the existing edge.
- Connection attempts that would create a cycle, use an output port as a
  target, or connect two ports of the same node are rejected live during the
  drag via `isValidConnection`, with the rejected handle rendered inert.
- Semantic errors that are representable — width mismatches on bitwise
  operands, slice ranges outside the input, extension widths at or below the
  input width — come from `validateRecipeSemantics` and are rendered on the
  offending edge and node with the validator's message. The invalid edit stays
  in local webview state until the user fixes or cancels it. It is not sent to
  the file-backed editor, which accepts only valid recipes. The canvas adds no
  second validator.

### Palette and drafts

The existing twelve-button operation grid becomes the permanent left Library,
alongside a draggable Input primitive. Dragging an item onto the
canvas creates it at the drop point; clicking an item creates it near the center
of the visible canvas for keyboard parity.

A freshly dropped single operation starts as a **draft node** (see the
dual-view invariant section): it is visible with dashed styling but not yet
part of the document, because the schema requires every step to have an
`inputId`. A unary draft is committed after its input and parameters are valid.
A binary draft is committed after both inputs are connected. Until then it
stays local to the webview.

### Toolbar and canvas chrome

- Icon buttons for auto-layout (decision 8), zoom, fit view, minimap, and
  deletion live in the canvas's top-right toolbar.
- Pan and zoom use React Flow behavior with a theme-aware grid background.
- Multi-select via marquee and shift-click. Delete/Backspace removes selected
  sources, steps, or drafts in one update when nothing still refers to them.
  Referenced values cannot be deleted until disconnected; at least one input is
  retained.

### Keyboard access

React Flow provides focusable nodes, arrow-key node movement, and Tab traversal.
Creating components is available from the keyboard-accessible Library, editing
uses the contextual Inspector, and Delete/Backspace removes selected canvas
components.

### Selection sync with the bit ribbon

Selecting a node links the canvas to the `LaneRibbon` bit visualization, using
the per-bit provenance that `evaluateRecipe` already computes
(`ProvenanceBit { sourceId, sourceBit }`):

- Selecting a **source node** highlights the bits of the currently displayed
  value whose provenance traces back to that source.
- Selecting a **step node** shows that value in the ribbon and detail area as
  the transient inspected value.

Selection is never persisted.

### What it could look like on screen

```
 Library       Continuous Vector Bits                 Inspector
 +----------+  +-----------------------------------+  +-------------+
 | Input    |  | [31:0]  [OPCODE] [PAYLOAD       ] |  | Input A     |
 | Slice    |  +---------------- resize ------------+  | name/width  |
 | Slice    |  | Transform            Canvas | List |  | value [Set] |
 | Concat   |  |                                   |  | Fields      |
 | AND      |  | A STATUS -> Slice -> RESULT       |  | Capture     |
 | Shift    |  | B MASK  -----^       [fit] [map]  |  +-------------+
 +----------+  +-----------------------------------+
```

The two large center views stay linked: selecting a graph value changes the bit
ribbon above it, while the right Inspector exposes only the properties relevant
to the selected input or operator.

## Architecture and interfaces

### Graph projection model (normative)

A new pure module `src/dataInspector/recipeGraph.ts` sits next to the other
domain modules so it is unit-testable without React or React Flow:

- `recipeToGraph(recipe)` returns `{ nodes, edges }`. Node IDs are the recipe's
  stable source and step IDs (`validateRecipeSemantics` enforces global
  uniqueness). Edges are derived
  one-to-one from references: `steps[].inputId` produces the edge into the
  step's `input` handle and `steps[].operandId` into its `operand` handle. Edge
  IDs follow the convention `<stepId>.input` / `<stepId>.operand`, so they are
  stable across re-renders.
- `applyGraphEdit(recipe, edit)` maps a canvas gesture (connect, rewire,
  add step, or delete steps) to a new `steps` array.

Normative rules for `applyGraphEdit`:

- Serialization emits a topological order computed with a stable Kahn's
  algorithm seeded by the previous array order. Steps not affected by the edit
  keep their relative order, so diffs against the `.ipci.yml` document stay
  minimal and saved canvas positions remain stable.
- Cycles are unrepresentable in the recipe and must be rejected before commit
  (at connect time). `applyGraphEdit` never receives a cyclic graph.
- Position-only gestures do not pass through `applyGraphEdit` and must not
  reorder `steps`.
- Validation is delegated to the existing `validateRecipeSemantics`; this
  module performs no width or reference checking of its own.

### Deletion rules

- Source properties are edited in the contextual Inspector.
- A step can be deleted only when no remaining step refers to it. If
  it is still in use, the canvas explains which nodes must be rewired first.
- Deleting several selected steps is allowed when all references from outside
  the selected group have been rewired. The selected steps are removed in one
  recipe update.
- These rules prevent a delete action from creating a recipe that the
  file-backed editor would reject.

### Node and port model

| Operation  | Symbol | Input ports                      | Card parameters | Width rule (from `validateRecipeSemantics`)    |
| ---------- | ------ | -------------------------------- | --------------- | ---------------------------------------------- |
| concat     | `{ }`  | `hi` (inputId), `lo` (operandId) | none            | width(hi) + width(lo)                          |
| slice      | `[ ]`  | `in`                             | `msb`, `lsb`    | msb - lsb + 1; range must lie inside the input |
| and        | `&`    | `a` (inputId), `b` (operandId)   | none            | operands equal width; output unchanged         |
| or         | `\|`   | `a`, `b`                         | none            | operands equal width; output unchanged         |
| xor        | `^`    | `a`, `b`                         | none            | operands equal width; output unchanged         |
| not        | `~`    | `in`                             | none            | unchanged                                      |
| shiftLeft  | `<<`   | `in`                             | `amount`        | unchanged                                      |
| shiftRight | `>>`   | `in`                             | `amount`        | unchanged                                      |
| zeroExtend | `0+`   | `in`                             | `width`         | `width`; must exceed the input width           |
| signExtend | `S+`   | `in`                             | `width`         | `width`; must exceed the input width           |
| truncate   | `[:]`  | `in`                             | `width`         | `width`; must be below the input width         |
| byteSwap   | `B<>`  | `in`                             | none            | unchanged; input must be whole bytes           |

Source nodes contribute `sources[].width`; step widths follow the operation
rules above. Every value is capped by the existing 4096-bit ceiling.

One deliberate capability gain: the current builder UI only offers _sources_ in
its operand dropdown, but the domain model has always allowed an operand to
reference any previously computed step (`valueWidths` in
`validateRecipeSemantics` accumulates step outputs as it walks). On the canvas,
wiring a step output into an `operand` port is just another edge. This is new
capability with zero model change.

### Position persistence and schema change

The recipe schema (`ipcraft-spec/schemas/data_inspector.schema.json`, draft-07,
`additionalProperties: false` throughout) gains one optional property on the
`view` definition:

```json
"canvas": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodes"],
  "properties": {
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "x", "y"],
        "properties": {
          "id": { "$ref": "#/$defs/stableId" },
          "x": { "type": "number" },
          "y": { "type": "number" }
        }
      }
    }
  }
}
```

In a saved recipe:

```yaml
view:
  laneWidth: 16
  zoom: bit
  canvas:
    nodes:
      - { id: input, x: 40, y: 120 }
      - { id: step1, x: 260, y: 120 }
```

Rules:

- An array of `{ id, x, y }` covers source and step nodes uniformly
  and matches the recipe's existing array-of-objects-with-id convention. `view`
  is the right home because it already holds presentation state (`laneWidth`
  and `zoom`); positions are view data, not semantics.
- The block is optional. Recipes without it (including every recipe that exists
  today) validate unchanged and open with deterministic auto-layout. Nodes
  missing an entry are auto-laid-out relative to the placed ones.
- Entries whose ID no longer exists in the recipe are dropped on the next
  write. Positions are best-effort layout data and always safe to discard.
- `version` stays `1`; the change is additive and optional.
- Forward-compatibility caveat, recorded deliberately: an _older_ extension
  validating with the previous schema will reject a recipe containing
  `view.canvas`, because of `additionalProperties: false`. This is the same
  tradeoff the strict-schema stance has always implied; it is accepted, not
  solved here.

Workflow for the change: `ipcraft-spec` is a git submodule, so the schema edit
lands there as its own commit/PR; the superproject then bumps the submodule
pointer and runs `npm run generate-types` to regenerate
`src/domain/dataInspector.types.ts` (never hand-edited). The submodule bump,
regenerated types, and the code that writes `view.canvas` ship in one
superproject change so they cannot drift.

### Webview component architecture

New code goes in a dedicated directory instead of growing
`DataInspectorApp.tsx` (already roughly 85 KB) further:

```
src/webview/dataInspector/
  transform/            Transform tab extracted from DataInspectorApp.tsx
    TransformTab.tsx      view toggle + shared builder state
    StepList.tsx          today's linear list, moved not rewritten
  canvas/
    TransformCanvas.tsx   React Flow provider, graph wiring, gesture handlers
    nodes/                SourceNode.tsx, StepNode.tsx
    palette.tsx           draggable operation palette
    layout.ts             pure auto-layout (decision 8)
```

Extracting the Transform tab out of `DataInspectorApp.tsx` is a phase 1 task in
its own right and must be behavior-neutral, guarded by the existing Jest and
Playwright suites. The canvas never lands inside the monolith.

Theming: React Flow exposes `--xy-*` CSS variables; `dataInspector.css` maps
them to `var(--vscode-*)` theme colors so the canvas follows dark and light
themes like the rest of the inspector. Node cards use plain `di-*` classes —
the inspector webview does not use Tailwind.

### Message contract and update discipline

No new message types. Node positions ride inside the recipe itself
(`recipe.view.canvas`) through the existing
`updateRecipe { recipe, baseDocVersion }` message, so the debounce and the
`docVersion` check in `DataInspectorRecipeEditorProvider` apply unchanged. Node
drags commit on drag-end only; intermediate drag frames stay in the webview. The
session panel (`DataInspectorPanel`), which has no backing document, keeps
positions in webview state and includes them when the user saves the session as
a recipe through the existing Save-As flow.

The file-backed editor rejects recipes with semantic errors today. The canvas
keeps that rule. It may show an invalid working edit, but it must not send that
recipe in `updateRecipe`. Fixing or cancelling the edit clears the local error.
This requires the extracted Transform tab to control when an update is sent,
instead of relying on every local state change to be written automatically.

### Dual-view invariant (normative)

- Both views render `currentRecipe.steps`. The list is order-sensitive (it _is_
  the array); the canvas is order-insensitive for rendering (it reads edges).
- Only edge-changing canvas gestures may rewrite step order, and only via the
  stable topological sort. List reorder keeps today's behavior, including the
  ability to create an invalid local order. That invalid order is not sent to
  the document. The canvas renders it as error-badged nodes, and the next valid
  edge edit repairs the order as part of serialization. There is no automatic
  repair on load.
- Switching views is lossless by construction — there is nothing to convert.

**Draft nodes.** The schema requires `inputId` on every step, so a freshly
dropped, unwired operation cannot be a valid step. A palette drop therefore
creates a webview-local draft node: dashed styling, present on the canvas, not
in the document — consistent with the established rule that transient state
(sample values, capture histories) stays out of recipes. The draft becomes a
saved step in one update after all required inputs and parameters are valid.
Consequences, stated as rules:

- The `input` edge of a persisted step can be rewired but not deleted.
- Binary operations require both input edges before a draft can be committed.
  Although `operandId` is optional in the JSON Schema, it is required by
  `validateRecipeSemantics` for concat, and, or, and xor. A persisted binary
  operand can be rewired but not deleted.
- Parameter edits may be temporarily invalid in local form state. They are
  written to the recipe only after `validateRecipeSemantics` accepts them.
- A persisted step can be deleted only under the deletion rules above.
- Drafts are discarded when the document is replaced from outside (external
  edit, `recipeError`, or a `forceResync`-style reload); they are never merged.

## Delivery phases

These phases describe the build order used for the implementation. The list
view remained functional throughout.

1. **Extraction and read-only canvas.** Extract the Transform tab from
   `DataInspectorApp.tsx` into `transform/` (behavior-neutral). Add
   `@xyflow/react`. Implement `recipeToGraph` and `layout.ts`. Render source,
   and step nodes with live values, width badges, and error states;
   fit-view; the `Canvas | List` toggle. No editing, no schema change —
   positions are all auto-laid-out. Shippable as a pipeline visualization.
2. **Editing and persistence.** `applyGraphEdit` with stable topological
   serialization; connect, rewire, and delete gestures; parameter editing on
   node cards; multi-select and keyboard delete. The `view.canvas` schema
   change lands in `ipcraft-spec`, the submodule pointer is bumped, types are
   regenerated, and drag-end position persistence ships — all in one change.
3. **Palette and drafts.** Draggable operation palette; the draft-node
   lifecycle; the auto-layout button and minimap.
4. **Provenance-linked selection and polish.** Node selection drives
   `LaneRibbon` highlighting via `ProvenanceBit`; the keyboard-parity audit; a
   performance pass at the wide end (4096-bit values, dozens of steps); E2E
   hardening.

## Tests and acceptance criteria

- **Pure unit tests (Jest)** for `recipeGraph.ts` and `layout.ts` in
  `src/test/suite/dataInspector/`: graph round-trip (`recipeToGraph` then
  `applyGraphEdit` reproduces equivalent steps), topological-sort determinism
  and the minimal-diff property (unaffected steps keep relative order), cycle
  rejection, draft-commit serialization, and layout output for known graphs.
  These run without React Flow.
- **jsdom tests (Jest)** stay smoke-level for the canvas: React Flow needs
  `ResizeObserver`, `DOMMatrixReadOnly`, and real element measurement that
  jsdom lacks; use React Flow's documented test mocks for render assertions
  only, and do not attempt gesture testing in jsdom. The existing
  `DataInspectorApp.test.tsx` covers the canvas-only workbench smoke behavior.
- **Playwright browser tests** (`src/test/browser/`) are the primary UI proof.
  Phase 1 adds a Data Inspector browser harness because the existing
  `window.__RENDER__` harness belongs to the Memory Map webview. The new harness
  mounts the `dataInspector` bundle, sends `recipe` messages with a document
  version, and records messages sent through the VS Code API mock. Tests render
  the graph for a fixture recipe; connect two nodes and assert the serialized
  step array; drop an operation and count nodes and steps; assert a width-mismatch
  edge shows the validator's message and sends no update; persist positions
  through a save/reload cycle; resize panels; and exercise the canvas toolbar.

Acceptance criteria:

- Wiring a step output into a bitwise operation's `b` port produces a recipe
  that `validateRecipeSemantics` accepts and `evaluateRecipe` evaluates.
- A recipe without `view.canvas` opens with deterministic auto-layout and is
  byte-identical on disk until the user moves a node.
- No canvas gesture produces more than one `updateRecipe` message. An invalid
  gesture produces none.
- An invalid imported step order renders as error-badged nodes on the canvas,
  is not written to the document, and the next valid canvas edge edit yields a
  valid order.
- All twelve operations can be created, wired, parameterized, and deleted on
  the canvas; every port label matches the table in this document.

## Risks

- **React Flow under jsdom.** Gesture-level Jest tests are impractical; if this
  is not accepted up front, phase 2 stalls on flaky mocks. Mitigation: the test
  strategy above names Playwright as the UI proof.
- **Schema forward-compatibility.** Older extensions strictly reject recipes
  containing `view.canvas`. Recorded as an accepted tradeoff in the schema
  section so it surfaces as a known behavior, not a bug report.
- **Submodule sequencing.** If the schema change, type regeneration, and writer
  code ship separately, generated types and the webview drift. Phase 2 bundles
  them into one superproject change.
- **The extraction refactor.** `DataInspectorApp.tsx` holds shared state
  (samples, evaluation, selection) that the Transform tab reads; the phase 1
  extraction is the riskiest step and must be behavior-neutral, with the
  existing suites as the guard.
- **Draft lifecycle vs. external edits.** Drafts are webview-local while the
  document is the source of truth; the rules above (discard on external
  replacement, never merge) prevent orphaned or duplicated drafts.
- **Bundle size.** `@xyflow/react` is the first large dependency in the
  `dataInspector` entry. The current development-build sizes are recorded near
  the start of this document and should be watched as the workspace grows.

## Assumptions and non-goals

- No simulation semantics. This is not actual Simulink: there are no clocks,
  solvers, or time-series execution. Evaluation remains the instantaneous
  `evaluateRecipe` pass over current sample values.
- No subsystems, hierarchy, grouping, or comment/annotation blocks in v1.
- No user-defined operations; the operation set stays the schema's twelve.
- The canvas covers the Transform surface only. Fields, overlay groups, and
  captures keep their existing tabs and interactions.
- The view toggle and minimap visibility are session-local, not persisted.
- Node positions are best-effort layout data with no merge semantics; losing
  them costs one auto-layout, nothing more.
- React Flow v12 (MIT) is acceptable as a dependency; if that ever changes, the
  graph projection model (`recipeGraph.ts`) is renderer-agnostic by design.
