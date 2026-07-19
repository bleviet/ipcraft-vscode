# Data Inspector Visual Workspace

## Overview

The Data Inspector presents a recipe as a visual dataflow graph. Sources and
transform steps are blocks, recipe references are edges, and each block shows
its evaluated value and width. This view is especially useful for fan-out and
multi-source composition, where a flat step list makes dependencies difficult
to scan.

![Data Inspector transform workspace](../images/data-inspector-workspace-light.png)

The graph is an editor for the existing recipe model. Sources seed the value
environment, while each step references earlier values through stable IDs. The
canvas does not introduce a second persisted transform representation.

## Workbench layout

The desktop workbench has three columns:

- **Library**: an Input primitive and the twelve transform operations;
- **center workspace**: Continuous Vector Bits above the Transform canvas; and
- **Inspector**: Properties for the selected node, plus Fields and Capture tabs
  when an input is selected.

The Library and Inspector can be resized or collapsed. A horizontal separator
resizes Bits and Transform, and either center view can be maximized. At narrow
widths, the same surfaces become mobile navigation tabs rather than being
removed.

Selecting a source or step changes the value shown in Bits. Source provenance,
transform-inserted ranges, masked bits, and projected field overlays remain
visible on the ribbon. Selection and panel layout are session state.

## Library and draft nodes

![Data Inspector operator Library](../images/data-inspector-operator-library-light.png)

Clicking a Library item creates it near the visible canvas center; dragging it
creates it at the drop point. Both paths are keyboard-accessible through the
Library buttons.

The Library exposes one Input primitive plus Concat, Slice, AND, OR, XOR, NOT,
Shift left, Shift right, Zero extend, Sign extend, Truncate, and Byte swap.
Search matches both the visible operation name and its short description. The
rail can be resized, collapsed to an icon, and restored without changing the
recipe.

A new operation cannot immediately become a recipe step because the schema
requires `inputId`, and binary operations also require `operandId` semantically.
The canvas therefore shows an unwired operation as a dashed draft node. A draft
is local to the webview and becomes persistent only after all required inputs
and parameters validate. Drafts are discarded when a replacement recipe arrives
from the host.

## Connections and graph edits

`src/dataInspector/recipeGraph.ts` provides the renderer-independent graph
projection:

- `recipeToGraph(recipe)` derives nodes and edges from stable IDs;
- `applyGraphEdit(recipe, edit)` connects, rewires, adds, or deletes graph
  components; and
- serialization applies a stable topological sort so unaffected steps retain
  their relative order.

Edge IDs follow `<stepId>.input` and `<stepId>.operand`. Each input port accepts
one edge; a new connection rewires that port. The canvas rejects cycles,
self-connections, and invalid source/target directions while the gesture is in
progress.

Width and parameter errors come from `validateRecipeSemantics`, the same
validator used outside the canvas. Invalid local edits remain visible for
correction but are not sent to a file-backed recipe. There is no duplicate
canvas validator.

Deleting a source or step is allowed only when surviving nodes do not reference
it. Multi-selection deletion happens in one recipe update. At least one input is
retained.

## Nodes and ports

| Operation   | Symbol | Inputs         | Parameters | Width rule                  |
| ----------- | ------ | -------------- | ---------- | --------------------------- |
| Concat      | `{ }`  | high, low      | none       | sum of input widths         |
| Slice       | `[ ]`  | input          | MSB, LSB   | inclusive selected range    |
| AND         | `&`    | input, operand | none       | equal input widths          |
| OR          | `\|`   | input, operand | none       | equal input widths          |
| XOR         | `^`    | input, operand | none       | equal input widths          |
| NOT         | `~`    | input          | none       | unchanged                   |
| Shift left  | `<<`   | input          | Amount     | unchanged                   |
| Shift right | `>>`   | input          | Amount     | unchanged                   |
| Zero extend | `0+`   | input          | Width      | greater than input width    |
| Sign extend | `S+`   | input          | Width      | greater than input width    |
| Truncate    | `[:]`  | input          | Width      | less than input width       |
| Byte swap   | `B<>`  | input          | none       | unchanged; whole bytes only |

Source and step cards show their current representation as hex, binary,
unsigned, or signed. The canvas toolbar controls representation, deletion,
auto-layout, zoom, fit, and the optional minimap.

## Canvas position persistence

Node positions are optional view data in `recipe.view.canvas.nodes`:

```yaml
view:
  laneWidth: 16
  zoom: bit
  canvas:
    nodes:
      - { id: input, x: 40, y: 120 }
      - { id: step1, x: 260, y: 120 }
```

Position entries use source or step IDs. Recipes without positions open with a
deterministic left-to-right auto-layout. Missing nodes are placed automatically,
and entries for deleted IDs are removed on the next write. Node dragging updates
the recipe only on drag end, so intermediate pointer frames never create a flood
of document edits.

Positions are presentation data. Losing them changes only the layout, not recipe
evaluation. Minimap visibility, selection, viewport zoom, collapsed rails,
split percentage, and maximized state are intentionally not persisted.

## Component and update architecture

The visual workspace uses `@xyflow/react` and lives under
`src/webview/dataInspector/`:

```text
WorkbenchLibrary.tsx
transform/TransformTab.tsx
canvas/TransformCanvas.tsx
canvas/layout.ts
canvas/nodes/SourceNode.tsx
canvas/nodes/StepNode.tsx
```

React Flow styles are mapped to VS Code theme variables in
`dataInspector.css`. Auto-layout is a small project-owned deterministic layout;
dagre and elkjs are not dependencies.

All valid edits flow through the existing recipe update path. File-backed
recipes send `updateRecipe { recipe, baseDocVersion }`; the provider validates
the recipe and enforces document revision ordering. The session panel keeps the
same state in memory and includes canvas positions when the user chooses
**Save recipe…**.

## Verification

Pure Jest tests cover graph projection, stable ordering, cycle rejection,
deletion, draft commits, and layout. The real browser behavior is covered by
`src/test/browser/data-inspector-canvas.spec.ts`, including connections,
rewiring, deletion, Library drops, canvas tools, panel resizing, maximized views,
position persistence, and error handling.

The screenshot above is generated from the compiled Data Inspector webview by
`npm run docs:screenshots`; it is not a hand-edited mockup.

## Non-goals

- The graph has no clocks, solvers, or time-series simulation semantics.
- Recipes cannot contain arbitrary JavaScript or user-defined operations.
- There are no subsystems, hierarchy, grouping, or annotation blocks.
- Fields and captures remain Inspector tabs rather than graph node types.
- The graph model does not depend on React Flow and can be tested without it.
