# Viewing a System Design

IPCraft can show a Vivado block design or a Platform Designer system as a
diagram. The view is read-only and works offline. It needs no vendor tool and
no license, and it never runs your script.

![System diagram with the outline and details panels open](../images/system-diagram-overview-light.png)

## Supported files

| File | Source |
|---|---|
| `.tcl` | Vivado block design script written by `write_bd_tcl` |
| `.qsys` | Platform Designer system (Standard) |
| `.tcl` | Platform Designer system script for `qsys-script` |

IPCraft recognizes a `.tcl` file by its commands. A `_hw.tcl` file is a
component description, not a system. It keeps its own preview.

Files are read as text. The Tcl is never executed, so values that a script
computes are not available. See [What the offline view cannot
show](#what-the-offline-view-cannot-show).

## Open the diagram

1. Open the `.tcl` or `.qsys` file in the text editor.
2. Press `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS), or run **IPCraft: Open as
   System Diagram**.
3. Press the same keys again to return to the text editor.

The diagram updates as you edit the file. If an edit breaks the file, the
diagram keeps the last valid design and shows a banner with the reason.

## Navigate

The diagram shows one hierarchy level at a time.

- **Levels.** Double-click a hierarchy block to enter it. Use the breadcrumb at
  the top left to go back up.
- **Outline.** Lists the instances of the current design and its external
  ports. Select an item to select it in the diagram and center it.
- **Search.** Type in **Search instances** to dim the blocks whose name or
  type does not match.
- **Details.** Shows the selected block, net, or port: type, where it is
  defined in the file, the parameters set in the file, and its pins with their
  nets. Select a line link to open the file at that line.
- **Address map.** Lists the address segments found in the design. Select a
  row to select its instance.
- **Problems.** Lists what the reader could not resolve. The **Offline view,
  partial** note in the toolbar opens this list.

![A hierarchy level with clocks and resets drawn](../images/system-diagram-hierarchy-light.png)

## Panels

The outline, details, and bottom panels start hidden so the diagram has the
full width. Use the three buttons at the top right to show or hide them. Drag
the edge of a panel to resize it. For the arrow-key resize and the double-click
that collapses a panel, see [Keyboard Shortcuts](../reference/keyboard-shortcuts.md#system-diagram).

## Clocks and resets

Clock and reset nets are hidden by default. Each pin that is on one shows a
small badge with the net name, or the first name and `+N` when the pin is on
several nets. This keeps data paths readable.

Turn on **Clocks and resets** in the toolbar to draw those nets.

## Zoom

- Scroll or use **+** and **-** to zoom, and drag the canvas to pan.
- **Fit** fits the whole level.
- Double-click a block (other than a hierarchy block) or a port to zoom to it.
- Double-click empty canvas to fit the level.
- Each level remembers its own zoom and position while the diagram is open.

## Names and hover

Blocks are sized to their names and pins. A pin or port name that is still too
long is shortened with an ellipsis in the middle.

Hover a pin to see its full name, its direction, its interface or signal type
when known, the nets it is on, and whether it comes from an `.ip.yml` or HDL
definition.

![Hover card over a pin](../images/system-diagram-hover-light.png)

## IP definitions from your workspace

A design file lists the IP it uses, but often not every pin. IPCraft looks for
matching definitions in your workspace and adds what it finds:

- an `.ip.yml` file, matched by its VLNV (Vivado) or by its Platform Designer
  component name;
- a VHDL or Verilog file, matched by entity or module name, for Vivado module
  references.

A match adds pins that the design leaves unconnected, pin directions, and
interface types. The details panel then shows a **Defined by** link that opens
the definition. When several files match, a Platform Designer component first
prefers the file with the same version; otherwise the file nearest to the design
file wins. Large HDL files and generated or dependency folders are skipped.
Matches that cannot be decided are listed in Problems.

In an untrusted workspace, IPCraft reads no definitions and says so in
Problems. Trust the workspace to turn them on.

## Platform Designer scripts

A system script does not always say what a connection carries. IPCraft infers
the kind from an explicit statement, from parameters, by propagating the kind
along connections, and as a last step from names. Connections whose kind came
from names, or could not be determined, are listed in Problems. A script that
uses Tcl that cannot be evaluated marks the view partial.

![A Platform Designer system with the address map open](../images/system-diagram-platform-designer-light.png)

## What the offline view cannot show

- Default and propagated parameters. Only values set in the file appear.
- Unconnected pins of an instance that has no definition in the workspace.
- Address ranges in Platform Designer systems, both `.qsys` files and system
  scripts. Base addresses are shown, and ranges that come from the IP
  definitions are not filled in yet.
- Anything that needs Tcl to be evaluated, such as loops and computed names.
  The view is marked partial and the cause is listed in Problems.

For the design behind this feature, see [Offline System
Viewer](../concepts/brainstorm/offline-system-viewer.md).
