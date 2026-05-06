# IP Core Architect -- Canvas-First Visual Editor

> **Goal:** Replace the table-driven IP Core editor with a canvas-based schematic
> block diagram. The primary interaction happens on a live SVG schematic;
> existing table editors remain accessible via a toggle and as an inspector panel.
>
> **Supersedes:** Task 4.2 (ASCII IP symbol diagram) from `port_python_features.md`.

---

## Architecture Overview

### Existing Stack

| Layer | Technology |
|---|---|
| Webview framework | React 18, webpack (`config/webpack.config.js`) |
| IP Core entry | `src/webview/ipcore/IpCoreApp.tsx` |
| Editor provider | `src/providers/IpCoreEditorProvider.ts` (CustomTextEditorProvider) |
| State management | `useIpCoreState` hook (YAML parse) + `useIpCoreSync` (write back) |
| Type system | `src/webview/types/ipCore.d.ts` (generated from JSON schema) |
| Bus definitions | `ipcraft-spec/bus_definitions/*.yml` |
| CSS | Tailwind utilities + custom CSS in `src/webview/index.css` |

### Design Decisions

- **Pure SVG + React** -- no external graph library. The block diagram is a
  single rectangle with ports along edges; React Flow or similar would add
  ~200KB of unnecessary bundle weight.
- **Coexistence** -- canvas and table views are toggle modes in the same editor.
  Canvas is the default; table is accessible via a toolbar button.
- **No extension host changes** -- the canvas is purely a webview concern. The
  same `postMessage` protocol and `IpCoreEditorProvider` are reused.
- **Layout is a pure function** -- `computeLayout(ipCore)` is side-effect free
  and trivially unit-testable.

### Data Flow

```
.ip.yml --> IpCoreEditorProvider --> postMessage('update') --> IpCoreApp
  --> useIpCoreState --> IpCore object --> computeLayout() --> CanvasLayout
  --> IpBlockCanvas (SVG render)
  --> click --> useCanvasSelection --> CanvasInspector --> onUpdate
  --> useIpCoreState.updateIpCore --> serialize YAML --> postMessage
  --> IpCoreEditorProvider.applyEdit --> .ip.yml
```

---

## File Inventory

### New Files

| File | Phase | Purpose |
|---|---|---|
| `src/webview/ipcore/components/canvas/canvasLayout.ts` | 1 | Pure layout computation function |
| `src/webview/ipcore/components/canvas/CanvasPort.tsx` | 1 | Individual port stub renderer (SVG) |
| `src/webview/ipcore/components/canvas/CanvasBusBundle.tsx` | 1 | Bus interface bundle renderer (SVG) |
| `src/webview/ipcore/components/canvas/IpBlockCanvas.tsx` | 1 | Main canvas SVG component |
| `src/webview/ipcore/components/canvas/canvas.css` | 1 | Canvas-specific styles (VS Code theme tokens) |
| `src/webview/ipcore/hooks/useCanvasSelection.ts` | 2 | Selection state management |
| `src/webview/ipcore/components/canvas/CanvasInspector.tsx` | 2 | Context-aware property editor panel |
| `src/webview/ipcore/components/canvas/LibraryPalette.tsx` | 3 | Draggable protocol/infrastructure palette |
| `src/webview/ipcore/hooks/useCanvasDrop.ts` | 3 | Drop handler for adding new elements |
| `src/webview/ipcore/hooks/useCanvasUndo.ts` | 4 | Undo/redo stack |
| `src/webview/ipcore/components/canvas/RemoveZone.tsx` | 4 | Visual delete zone overlay |
| `src/webview/ipcore/hooks/useCanvasValidation.ts` | 5 | Live validation annotations |
| `src/test/suite/webview/canvasLayout.test.ts` | 1 | Unit tests for layout algorithm |

### Modified Files

| File | Phase | Change |
|---|---|---|
| `src/webview/ipcore/components/layout/EditorPanel.tsx` | 1 | Added `viewMode` prop + canvas rendering path |
| `src/webview/ipcore/IpCoreApp.tsx` | 1-3 | View mode toggle, canvas layout, inspector wiring |

---

## Implementation Phases

### Phase 1 -- Read-Only Canvas View [DONE]

Render the IP core as a non-editable SVG schematic block. Introduces the
canvas/table view toggle.

- [x] **`canvasLayout.ts`** -- Pure function `computeLayout(ipCore: IpCore): CanvasLayout`.
  Classifies every element by direction and computes (x, y) positions:
  - Left edge (top-down): clocks, resets, slave/sink buses, input ports
  - Right edge (top-down): master/source buses, output ports
  - Bottom edge: bidirectional (inout) ports
  - Block height scales with `max(leftCount, rightCount) * PORT_PITCH`
  - Returns `blockRect`, `ports[]` (with id, position, kind, label), `viewBox`
  - Exports constants: `PORT_PITCH`, `EDGE_PADDING`, `MIN_BLOCK_HEIGHT`,
    `BLOCK_WIDTH`, `STUB_LENGTH`

- [x] **`CanvasPort.tsx`** -- SVG group rendering a port stub:
  - Horizontal/vertical stub line from block edge (length = `STUB_LENGTH`)
  - Connector dot at block edge (larger for buses)
  - Port name label (monospace, positioned outside the block)
  - Width annotation (e.g., `[31:0]`, `[DATA_WIDTH]`)
  - Kind icons: sine wave for clock, counterclockwise arrow for reset
  - Selection ring when active
  - Hit area (invisible wider stroke) for easy clicking
  - CSS classes: `.canvas-port`, `.canvas-port--clock`, `.canvas-port--reset`,
    `.canvas-port--selected`

- [x] **`CanvasBusBundle.tsx`** -- SVG group rendering a bus interface:
  - Thick stub line (strokeWidth 4)
  - Connector block at block edge
  - Protocol badge (e.g., "AXI4-Lite") -- 80px rounded rect with label
  - Mode indicator (S/M/Sink/Src) -- small badge above the stub
  - Name label below the stub
  - Association indicator dots (green = clock, orange = reset, yellow = memmap)
  - Selection ring (dashed rect) when active
  - CSS classes: `.canvas-bus-bundle`, `.canvas-bus-bundle--selected`

- [x] **`IpBlockCanvas.tsx`** -- Main canvas SVG component:
  - Calls `computeLayout(ipCore)` via `useMemo`
  - Renders SVG with dot-grid background pattern
  - Block body: rounded rect with drop shadow
  - Block header stripe with core name (bold, monospace)
  - VLNV subtitle (smaller, muted)
  - Description text (truncated at 40 chars)
  - Delegates to `CanvasPort` / `CanvasBusBundle` per element
  - Hover state tracking (per-element `onMouseEnter`/`onMouseLeave`)
  - Background click deselects
  - Edge count badges (port count at bottom of each edge)
  - Hover tooltip (positioned bottom-left, shows port details)
  - `preserveAspectRatio="xMidYMid meet"` for fit-to-view

- [x] **`canvas.css`** -- All styles use `var(--vscode-*)` tokens:
  - Block body: editor background fill, panel border stroke
  - Header: focus border tint
  - Port stubs: foreground color, kind-specific colors (green=clock,
    orange=reset, blue=bus)
  - Hover: increased opacity, thicker stroke, link-colored label
  - Selected: focus border color, bold label
  - Bus bundle: blue accent, purple mode badge
  - Tooltip: hover widget background, panel border, box shadow
  - View toggle button: secondary button style, active = primary button

- [x] **`EditorPanel.tsx`** (modified):
  - New `viewMode: 'table' | 'canvas'` prop (exported as `ViewMode` type)
  - New optional props: `canvasSelectedId`, `onCanvasSelect`
  - When `viewMode === 'canvas'`: renders `IpBlockCanvas` instead of section editors
  - Table mode rendering unchanged

- [x] **`IpCoreApp.tsx`** (modified):
  - `viewMode` state, defaults to `'canvas'`
  - Canvas/table toggle buttons in header (codicons: `symbol-misc`, `list-flat`)
  - Sidebar hidden in canvas mode
  - `viewMode` + canvas props passed to `EditorPanel`

- [x] **`canvasLayout.test.ts`** -- 10 unit tests:
  - Empty core (no ports) produces valid layout
  - Clocks placed on left edge
  - Resets placed on left edge below clocks
  - Slave buses left, master buses right, with correct protocol/mode labels
  - Input ports left, output ports right, with width labels
  - Bidirectional ports on bottom edge
  - Block height scales with many ports
  - All IDs unique
  - Width label formatting (1 = none, 8 = `[7:0]`, string = `[DATA_WIDTH]`)
  - Sink/source bus modes mapped correctly

---

### Phase 2 -- Context-Aware Inspector [DONE]

Clicking a port/bus on the canvas opens a slide-in inspector panel that reuses
the existing section editors.

- [x] **`useCanvasSelection.ts`** -- Hook managing selection state:
  - `CanvasElement` type: `{ kind, index, id }` where kind is
    `clock | reset | port | busInterface | body`
  - `parseCanvasId(id: string)` converts layout IDs (e.g., `bus:0`) to
    structured elements
  - Returns `{ selected, selectedId, select, deselect }`

- [x] **`CanvasInspector.tsx`** -- Slide-in panel (360px, right side):
  - Header with element kind label (uppercase), element name, close button
  - Content area renders the matching existing editor:
    - `body` -> `MetadataEditor`
    - `clock` -> `ClocksTable`
    - `reset` -> `ResetsTable`
    - `port` -> `PortsTable`
    - `busInterface` -> `BusInterfacesEditor`
  - Hidden when nothing is selected

- [x] **`IpCoreApp.tsx`** (modified):
  - Replaced simple `canvasSelectedId` state with `useCanvasSelection` hook
  - Renders `CanvasInspector` next to `EditorPanel` in canvas mode
  - Inspector closes on `canvasDeselect` (click empty canvas or close button)

---

### Phase 3 -- Drag-and-Drop Interface Library [DONE]

Users drag protocol primitives from a palette onto the canvas to add them.

- [x] **`LibraryPalette.tsx`** -- Collapsible left sidebar with draggable items:
  - **Protocols**: AXI4-Lite (S/M), AXI4-Full, AXI-Stream (Source/Sink),
    Avalon-MM (S/M), Avalon-ST
  - **Infrastructure**: Clock, Reset, Interrupt, GPIO (in/out)
  - Each item uses HTML drag-and-drop API with JSON payload:
    ```json
    { "kind": "bus", "type": "ipcraft.busif.axi4_lite.1.0", "mode": "slave" }
    ```
    or `{ "kind": "clock" }`, `{ "kind": "reset" }`, etc.

- [x] **`useCanvasDrop.ts`** -- Drop handler hook:
  - Parses drag payload from `dataTransfer`
  - Determines placement side from drop position (left half -> slave, right -> master)
  - Generates default name (e.g., `s_axi_0`, `clk_0`)
  - Calls `onUpdate` with YAML path and new element
  - Auto-selects the new element to open inspector

- [x] **`IpBlockCanvas.tsx`** (modify):
  - Add `onDragOver` and `onDrop` handlers
  - Show drop zone highlight on valid edges during drag
  - CSS transition for new port appearing

- [x] **`IpCoreApp.tsx`** (modify):
  - Render `LibraryPalette` as left sidebar in canvas mode

---

### Phase 4 -- Drag-to-Remove and Undo [DONE]

Dragging a port off the block edge deletes it. An undo stack provides safety.

- [x] **`useCanvasUndo.ts`** -- Undo/redo stack:
  - `push(snapshot: string)` -- captures raw YAML before each mutation
  - `undo() / redo()` -- returns previous/next YAML snapshot
  - `canUndo / canRedo` -- boolean flags
  - Wired to `Ctrl+Z` / `Ctrl+Y` keyboard shortcuts

- [x] **`RemoveZone.tsx`** -- Visual overlay:
  - Red-tinted area with trash icon and "Release to remove" text
  - Appears when dragging a port > 40px beyond block boundary
  - CSS fade-in animation

- [x] **`CanvasPort.tsx` / `CanvasBusBundle.tsx`** (modify):
  - Make elements `draggable="true"`
  - Drag payload: `{ action: 'remove', kind: '...', index: N }`
  - Visual feedback during drag (opacity reduction on source element)

- [x] **`IpBlockCanvas.tsx`** (modify):
  - Track drag-out state (is port being dragged beyond boundary?)
  - On drop outside block, dispatch removal via `onUpdate`
  - Push undo snapshot before removal

---

### Phase 5 -- Visual Validation and Polish [TODO]

Overlay validation feedback directly on canvas elements and polish interactions.

- [ ] **`useCanvasValidation.ts`** -- Validation hook:
  - Returns `ValidationAnnotation[]` per element
  - Rules:
    - Bus interface missing `associatedClock` -> warning
    - Bus interface missing `associatedReset` -> warning
    - Port name collision -> error on both ports
    - Bus interface with invalid type -> error
    - Referenced clock not in `clocks[]` -> error on bus bundle

- [ ] **`CanvasPort.tsx` / `CanvasBusBundle.tsx`** (modify):
  - Accept `annotations: ValidationAnnotation[]` prop
  - Render colored indicator dot (orange = warning, red = error)
  - Show annotation messages in hover tooltip

- [ ] **`IpBlockCanvas.tsx`** (modify):
  - Compute annotations from `useCanvasValidation`
  - Pass annotations down to each port/bundle component

- [ ] **Polish items** (across existing canvas files):
  - Smooth CSS transitions on port add/remove/reorder
  - Keyboard shortcuts: `Delete` removes selected element, `Escape` deselects
  - Responsive: canvas fills available space, text scales for readability

---

## Port Placement Rules

Reference for the layout algorithm in `canvasLayout.ts`:

```
+--------------------------------------------------+
|                   [Core Name]                     |
|                vendor:lib:name:ver                |
|                                                   |
|  CLK  ~~~|                            |~~~ M_AXI  |
|  RST  <--|                            |           |
|          |                            |           |
|  S_AXI ==|                            |=== M_AXIS |
|          |                            |           |
|  data_in -|                           |- data_out |
|  enable  -|                           |- irq      |
|          |                            |           |
+--------------------------------------------------+
               |           |
              sda         scl
           (bidirectional ports)
```

| Position | Element Types |
|---|---|
| Left edge, top | Clocks (icon: sine wave) |
| Left edge, below clocks | Resets (icon: loop arrow) |
| Left edge, below resets | Slave / sink bus interfaces (thick stub + protocol badge) |
| Left edge, bottom | Input ports (thin stub + width annotation) |
| Right edge, top | Master / source bus interfaces |
| Right edge, below buses | Output ports |
| Bottom edge | Bidirectional (inout) ports |

---

## Verification

### Automated

```bash
# Run canvas layout tests
npx jest --config config/jest.config.js --testPathPatterns="canvasLayout" --no-coverage

# Run full test suite (must pass with zero failures)
npx jest --config config/jest.config.js --no-coverage

# Lint all canvas files (must pass with zero errors/warnings)
npx eslint src/webview/ipcore/components/canvas/ \
           src/webview/ipcore/hooks/useCanvasSelection.ts \
           src/webview/ipcore/IpCoreApp.tsx \
           src/webview/ipcore/components/layout/EditorPanel.tsx \
           --max-warnings 0
```

### Manual

1. Open a `.ip.yml` file and verify the canvas renders the IP block correctly
2. Toggle between canvas and table views via header buttons
3. Verify port names, directions, bus protocols, and widths match the YAML
4. Click a port on the canvas and verify the inspector opens with the correct editor
5. Edit a property in the inspector and verify the canvas updates
6. (Phase 3) Drag a bus interface from the palette and verify it appears in YAML
7. (Phase 4) Drag a port off the block edge and verify removal + undo
8. (Phase 5) Remove a clock referenced by a bus interface and verify warning indicator
9. Edit the `.ip.yml` in the text editor side-by-side and verify real-time sync
