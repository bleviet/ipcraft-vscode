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
  the top left, or the mouse back button, to go up one level.
- **Expand in place.** Click the **+** button in the header of a hierarchy block,
  or right-click it and choose **Expand In-Place**, to see inside without leaving
  the level. The block becomes a frame with its pins on the border: wires from
  outside meet the pins from outside, and the wires inside meet them from
  inside. Click **-** in the frame header, or right-click and choose
  **Collapse**, to fold it again. **Open Subsystem** in the same menu enters the
  block like a double-click. Hierarchy blocks inside a frame can be expanded
  too, and expanded blocks stay expanded when you go to another level and back.
  Isolate works on the blocks of the level on show, not on those inside a frame.
- **Outline.** Lists the instances of the current design and its external
  ports. Select an item to select it in the diagram and center it.
- **Search.** Type in **Search instances** to dim the blocks whose name or
  type does not match. Press Enter or Shift+Enter to go to the next or
  previous match on any level; a counter shows the position, and Escape
  clears the search.
- **Details.** Shows the selected block, net, or port: type, where it is
  defined in the file, the parameters set in the file, and its pins with their
  nets. Select a line link to open the file at that line.
- **Address map.** Lists the address segments found in the design. Select a
  row to select its instance.
- **Problems.** Lists what the reader could not resolve. The **N problems**
  button in the toolbar opens this list; it is hidden when there are none.

![A hierarchy level with clocks and resets drawn](../images/system-diagram-hierarchy-light.png)

## Isolate blocks

To focus on a few blocks of a busy level, select them and isolate them.

1. Click a block or port, then Cmd+Click (macOS) or Ctrl+Click (Windows and Linux) to add more, or to remove one that is already selected. Details shows "N selected" with a list of the names; clicking a name selects that block alone.
2. Right-click one of the selected blocks and choose **Isolate N Selected** (N is the number of selected blocks). Right-clicking a block that is not selected selects it alone, and the item reads **Isolate Selection**.

The diagram then shows the selected blocks, the wires that touch them, and the block or port at the other end of each of those wires, laid out compactly. Wires between two of the other blocks stay hidden. Clock and reset wires count only while Clocks and resets is on. A toolbar chip reads "Isolated · N selected · M shown", where M counts every block and port on screen.

Choose **Show All** from the right-click menu (on a block or on the empty canvas) or the toolbar to return to the full level, with the zoom and pan it had before. Isolation also ends when you go to another level (breadcrumb, opening a hierarchy block, the mouse back button, or an outline or search jump) or when a search step or outline row selects a block that the isolated view hides.

## Find unconnected pins

To review the pins that nothing connects to, turn on **Unconnected pins** in the toolbar. The button shows the number of unconnected pins in the whole design, in the warning color when any is undriven. Turning it on also opens the **Unconnected** tab of the bottom panel; turning it off leaves the tab as it is.

A pin is unconnected when no net touches it on its level. There are two kinds:

- **Undriven**: an input (or a slave interface) that nothing drives. The vendor tool ties such an input to a constant, usually its default value, so an active-low reset tied to 0 holds the block in reset. Undriven pins are drawn in the warning color.
- **Unused**: an output, master interface, or bidirectional pin that nothing uses. This is often intentional, so unused pins are drawn muted.

While the review is on, the diagram dims wires and blocks without findings. Each unconnected pin gets a short dashed stub ending in a hollow circle, a block header shows a warning icon (a disconnect icon when nothing is undriven) with the count, and hovering it gives the undriven and unused split (hierarchy blocks count the pins inside them too), and a banner summarizes the level on show. The outline shows a count on each block and external port.

Only blocks whose full pin list is known can be checked: blocks with an `.ip.yml` or HDL definition, hierarchy blocks and their pins, and external ports. For the other blocks (drawn with a dashed border), the viewer knows only the pins that appear in connections, so it cannot tell which pins are open. They are listed as not checked; see Problems for the reason.

The **Unconnected** tab lists every finding with its pin, block, level, direction, type, where the pin is known from, and a link to the line that created it. The **Undriven** and **Unused** chips filter the rows. Click a row to go to its level, select the block, centre it (zooming in if it is too small to read), and mark the pin on the diagram and in Details. A hierarchy pin that is open on both sides is listed twice: once on the hierarchy block in the parent level and once as the port inside. Details shows `undriven` or `unused` in the Net column of every unconnected pin, with or without the review on.

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

A module whose kind is the base name of another `.qsys` file in the workspace
(for example `kind="sub_system"` and `sub_system.qsys`) is a Platform Designer
subsystem. IPCraft reads that file and shows the module as a hierarchy level:
double-click the block to enter it, or expand it in place with its **+** button. Go to source from inside the subsystem opens
the subsystem file. Subsystems that instantiate each other, or a file that cannot
be read, stay opaque blocks and are listed in Problems.

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
