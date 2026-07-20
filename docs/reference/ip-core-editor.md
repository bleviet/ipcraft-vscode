# IP Core Editor Reference

The IP Core editor is the visual editor for `.ip.yml` files. It presents the
core as a block with parameters, clocks, resets, ports, and bus interfaces.

VLNV means vendor, library, name, and version. It is the four-part identity
shown in the toolbar.

![IP Core editor with the palette, canvas, and inspector](../images/ipcore-editor-light.png)

## Layout

```text
+------------------------------------------------------------------+
| Toolbar: identity, target, language, scaffold pack, actions       |
+----------------+-------------------------------+-----------------+
| Library        | IP block canvas               | Inspector       |
| palette        |                               |                 |
+----------------+-------------------------------+-----------------+
```

| Area | Purpose |
|---|---|
| Toolbar | Chooses generation options and starts project actions |
| Library palette | Supplies items that can be dragged onto the core |
| Canvas | Shows the core's public structure |
| Inspector | Edits the selected item |

## Toolbar

![IP Core editor toolbar](../images/ipcore-toolbar-light.png)

Controls are ordered from left to right:

| Group | Purpose |
|---|---|
| History | Undo or redo canvas changes |
| Target | Choose Vivado, Quartus, or both |
| Language | Choose VHDL or SystemVerilog |
| Scaffold Template | Choose the generated file structure |
| Generate | Generate the project, HDL, tests, documentation, or a register map |
| Integration | Generate, open, edit, or build vendor projects |
| Consistency | Compare the specification with generated files |
| Utilities | Open walkthroughs, settings, and feedback |

Vendor actions remain disabled until their required project or component file
exists. Hover over a control to see its name and any shortcut.

## Library palette

| Category | Items |
|---|---|
| Parameters | Integer, Boolean, and String parameters |
| Infrastructure | Clock, reset, interrupt, and individual port |
| Bus protocols | AXI, Avalon, streaming, and custom interfaces |

Drag an item onto the canvas. IPCraft assigns an initial name; use the Inspector
to change it.

## Canvas

- clocks, resets, and input ports appear on the left;
- outputs and bidirectional ports appear on the right;
- bus interfaces appear as bundles with a protocol and mode label;
- parameters appear along the bottom;
- interface arrays show their element count;
- related interfaces use a shared clock-domain color.

Select the expand control on a bus bundle to see its individual signals.

### Canvas navigation

| Interaction | Action |
|---|---|
| `Ctrl`/`Cmd` + wheel | Zoom |
| Wheel | Pan |
| Middle-button drag | Pan freely |
| Space + background drag | Pan freely |
| Background drag | Select several items |
| `Ctrl`/`Cmd` + `0` | Return to 100% zoom |

## Inspector

The Inspector changes with the selection:

| Selection | Editable information |
|---|---|
| Clock or reset | Name and relationships |
| Port | Name, direction, and width |
| Parameter | Name, type, and default value |
| Bus interface | Name, mode, prefix, clock, reset, memory map, widths, and array count |
| Expanded bus signal | Signal width override |

Widths may be numbers, parameter names, or supported arithmetic expressions.

## Keyboard commands

These commands work when no text box is being edited:

| Key | Action |
|---|---|
| `Delete` | Delete the selection |
| `Ctrl`/`Cmd` + `D` | Duplicate the selection |
| `Ctrl`/`Cmd` + `Z` | Undo |
| `Ctrl`/`Cmd` + `Y` | Redo |
| `Ctrl`/`Cmd` + `F` | Find a port |
| `Ctrl`/`Cmd` + `0` | Reset zoom |
| `Escape` | Close search or clear the selection |

Dragging an item to the Remove Zone is another way to delete it.

## Validation

The editor checks that clock, reset, and memory-map references point to existing
items. Select a validation message to navigate to the affected canvas item.

**Check Consistency** performs a broader comparison with generated HDL and
vendor files. See [Checking consistency](../how-to/check-consistency.md).

## Custom interfaces

Dragging **Custom Interface** creates a conduit: a named group of signals that
does not use a built-in protocol. Add its signals in the Inspector. You can save
the definition as a reusable `.busdef.yml` file.

See [Defining a custom interface](../how-to/defining-a-custom-interface.md).

## Generation review

Generation first opens a staging view. Review which files are new, changed,
protected, or skipped before accepting the output.

The selected scaffold pack controls the output layout. See
[Generating a project](../how-to/generating-a-project.md) and
[scaffold packs](../how-to/customizing-generated-files-with-scaffold-packs.md).

## Contributor implementation

The application entry is `src/webview/ipcore/IpCoreApp.tsx`. Canvas components
are under `src/webview/ipcore/components/canvas/`, and state hooks are under
`src/webview/ipcore/hooks/`.

The main responsibilities are:

| Module | Responsibility |
|---|---|
| `useIpCoreState` | Parsed core data, updates, and validation |
| `useIpCoreSync` | Versioned updates to the extension host |
| `useCanvasDrop` | Converts dropped palette items into model changes |
| `useCanvasSelection` | Current canvas selection |
| `useCanvasUndo` | Canvas history |
| `IpBlockCanvas` | Layout, rendering, and drop handling |
| `CanvasInspector` | Selection-specific forms |
| `StagingOverlay` | Generated-file review |

See [webview architecture](../architecture/webview.md) for the process boundary
and shared domain rules.
