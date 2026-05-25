# IP Core Editor Reference

The IP Core editor is the custom visual editor for `*.ip.yml` files. It provides dedicated section editors for all aspects of an IP Core definition.

## Structure

The editor uses a sidebar + panel layout:

```text
+---------------------------+------------------------------------------+
| NavigationSidebar         | EditorPanel                              |
|                           |                                          |
| Metadata                  |  (selected section editor)               |
| Clocks                    |                                          |
| Resets                    |                                          |
| Ports                     |                                          |
| Parameters                |                                          |
| Bus Interfaces            |                                          |
| Memory Maps               |                                          |
| File Sets                 |                                          |
| Generator                 |                                          |
+---------------------------+------------------------------------------+
| Validation Errors (if any)                                           |
+----------------------------------------------------------------------+
```

Keyboard shortcuts: `Ctrl+H` focuses the sidebar, `Ctrl+L` focuses the editor panel.

## Section Editors

### MetadataEditor

Edits the IP Core's VLNV (Vendor, Library, Name, Version) and description. Fields use inline editing with save/cancel.

### ClocksTable

Tabular editor for clock definitions. Each clock has a name, logical name, direction, frequency, and description.

### ResetsTable

Tabular editor for reset signals. Each reset has a name, logical name, direction, polarity (active high/low), and description.

### PortsTable

Tabular editor for user-defined ports (non-bus signals). Each port has a name, logical name, direction, width (can reference a parameter for parameterized widths), and description.

### ParametersTable

Tabular editor for generic parameters. Each parameter has a name, value, data type, and description. Parameter names can be referenced in port widths.

### BusInterfacesEditor

Card-based editor for bus interfaces. Each card shows the interface name, type, mode, physical prefix, and associated clock/reset. Supports:

- Bus interface arrays with configurable count, index start, and naming patterns
- Optional port selection from bus library definitions
- Port width overrides
- Port mapping table for physical-to-logical signal mapping

### MemoryMapsEditor

Editor for memory map references. Displays linked memory maps with `$ref` resolution. Shows registers and address blocks from imported memory map files.

### FileSetsEditor

Editor for file set definitions. Organizes generated and source files into named groups (e.g., RTL, Testbench, Integration).

### GeneratorPanel

VHDL project scaffolding UI. See the [Generator Reference](generator.md) for details on generation options, vendor integration, and template system.

### PortMappingTable

Sub-editor within Bus Interfaces for mapping physical port names to logical signal names and configuring port widths.

## State Management

### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useIpCoreState` | `ipcore/hooks/useIpCoreState.ts` | Parsed IP Core state, update methods, validation |
| `useIpCoreSync` | `ipcore/hooks/useIpCoreSync.ts` | Sends YAML updates to extension host |
| `useNavigation` | `ipcore/hooks/useNavigation.ts` | Section navigation state |
| `useCanvasDrop` | `ipcore/hooks/useCanvasDrop.ts` | Resolves drag-and-drop payloads into IP Core updates |
| `useCanvasUndo` | `ipcore/hooks/useCanvasUndo.ts` | Undo/redo stack for canvas changes |
| `useCanvasSelection` | `ipcore/hooks/useCanvasSelection.ts` | Canvas element selection state |
| `useCanvasValidation` | `ipcore/hooks/useCanvasValidation.ts` | Real-time canvas constraint checks |

### Layout Components

| Component | File | Purpose |
|-----------|------|---------|
| `NavigationSidebar` | `ipcore/components/layout/NavigationSidebar.tsx` | Section navigation with keyboard |
| `EditorPanel` | `ipcore/components/layout/EditorPanel.tsx` | Routes to section editors |

## Validation

The IP Core editor performs cross-reference validation:

- Checks that `associatedClock` references an existing clock name
- Checks that `associatedReset` references an existing reset name
- Checks that `memoryMapRef` references an existing memory map

Validation errors appear in a panel at the bottom of the editor. Clicking an error navigates to the relevant section and highlights the field.

## Implementation Files

| File | Purpose |
|------|---------|
| `src/webview/ipcore/IpCoreApp.tsx` | App shell, message handling, keyboard shortcuts, view-mode toggle |
| `src/webview/ipcore/components/layout/` | NavigationSidebar, EditorPanel |
| `src/webview/ipcore/components/sections/` | All section editors (12 files) |
| `src/webview/ipcore/hooks/` | State management hooks (7 files) |

---

## Canvas View

The IP Core editor opens in **Canvas view** by default. A toggle in the toolbar switches between Canvas and Form (table) view. Undo/Redo buttons are available in Canvas view.

```text
+--------------------------------------------------+
| [Undo] [Redo]              [Canvas] [Form]       |
+----------------+-------------------------+-------+
| Library        | IP Block Diagram (SVG)  | Insp- |
| Palette        |                         | ector |
|  Generics      |   ┌──────────────────┐  |       |
|  Infrastr.     |   │   my_core        │  | (prop |
|  Bus Protocols |   │ clk ──○    ○── irq│  |  erty |
|                |   │ rst ──○    ○── data│  | panel|
|                |   └──────────────────┘  |       |
+----------------+-------------------------+-------+
```

### Library Palette

The palette lists draggable primitives, organised into three collapsible categories:

| Category | Items |
|----------|-------|
| **Generics** | Integer Generic, Natural Generic, Boolean Generic, String Generic |
| **Infrastructure** | Clock, Reset, Interrupt (output), Input Port, Output Port, Inout Port |
| **Bus Protocols** | AXI4-Lite, AXI4-Full, AXI-Stream, Avalon-MM, Avalon-ST, Custom Interface |

Drag any item from the palette and drop it onto the canvas to add it to the IP Core. The item's default name is auto-assigned from a hint (e.g., `clk`, `axi_lite`, `DATA_WIDTH`) and can be renamed via the inspector.

### IP Block Canvas

The canvas renders the IP Core as an SVG schematic:

- **Clocks and resets** appear on the left edge as thin stubs.
- **Ports** appear on the left (inputs) or right (outputs/inout) edge.
- **Bus interfaces** appear as wide "bundle" connectors with a protocol badge and a mode indicator (S / M / Src / Sink). Click the expand button to reveal individual bus signals.
- **Generics** appear at the bottom edge.
- **Array bus interfaces** display a count badge (e.g., `×3`) in the top-right corner of the protocol badge.
- **Clock domain colour coding** — each unique clock reference gets a distinct colour applied to its bus bundles.

Navigation:

| Interaction | Action |
|-------------|--------|
| `Ctrl+Wheel` | Zoom in / out |
| Plain wheel | Pan vertically |
| Middle-mouse drag | Pan freely |
| Left-drag on background | Pan freely |
| `Ctrl+0` / `Cmd+0` | Reset zoom to 100 % |

### Canvas Inspector

Clicking any element on the canvas selects it and opens the **Inspector** panel on the right. The inspector shows context-specific fields:

| Element kind | Editable properties |
|--------------|---------------------|
| **Clock / Reset** | Name |
| **Port** | Name, direction, width (numeric or generic reference) |
| **Generic** | Name, data type, default value |
| **Bus interface** | Name, mode, physical prefix, associated clock/reset, memory map reference (file picker), port width overrides, array count |
| **Bus signal** (expanded) | Width override |

Clicking a signal inside an expanded bus bundle also opens the inspector with the signal's width configuration.

### Canvas Keyboard Shortcuts

These shortcuts are active when the canvas is visible and no text field is focused:

| Key | Action |
|-----|--------|
| `Delete` | Delete the selected element |
| `Ctrl+D` / `Cmd+D` | Duplicate the selected element (bus interfaces increment their array count) |
| `Ctrl+Z` / `Cmd+Z` | Undo last canvas change |
| `Ctrl+Y` / `Cmd+Y` | Redo |
| `Ctrl+0` / `Cmd+0` | Reset zoom to 100 % |
| `Escape` | Deselect current element |
| `Ctrl+H` | Focus the library palette |
| `Ctrl+L` | Focus the canvas area |

### Drag-to-Remove

Dragging an element from the canvas and dropping it outside the canvas (onto the **Remove Zone** strip that appears during the drag) removes the element. This is an alternative to the `Delete` key.

### Custom Interface (Conduit)

Dragging **Custom Interface** from the palette adds a conduit bus interface. In the inspector, you can:

1. Add named signals with configurable directions and widths.
2. Save the interface under a name — it is written to a `<name>.busdef.yml` file in the project directory and becomes reusable across IP Cores in the same workspace.
