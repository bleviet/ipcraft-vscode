# Keyboard Shortcuts

Shortcuts apply to the editor section that currently has focus. Text fields keep
normal typing shortcuts unless a table cell is explicitly in navigation mode.

## IP Core Canvas

These shortcuts are active when the canvas view is visible and no text field is focused.

| Key | Action |
|-----|--------|
| `Delete` | Delete the selected element (port, clock, reset, generic, or bus interface) |
| `Ctrl+D` / `Cmd+D` | Duplicate selected element; bus interfaces increment their array count instead of adding a copy |
| `Ctrl+Z` / `Cmd+Z` | Undo last canvas change (native VS Code document undo) |
| `Ctrl+Y` / `Cmd+Y` | Redo |
| `Ctrl+0` / `Cmd+0` | Reset zoom to 100 % |
| `Ctrl+F` / `Cmd+F` | Open port search (works even while another input is focused) |
| `Escape` | Close port search if open, otherwise deselect current element |

### Canvas Navigation

| Interaction | Action |
|-------------|--------|
| `Ctrl+Wheel` | Zoom in / out |
| Plain wheel | Pan (vertical scroll; trackpads also pan horizontally on shift/2-axis scroll) |
| Middle-mouse drag | Pan freely |
| Hold `Space` + left-button drag on background | Pan freely |
| Left-button drag on background (no `Space`) | Marquee-select multiple ports/interrupts |

---

## Register Fields Table

When the fields table is focused:

| Key | Action |
|-----|--------|
| Arrow keys | Navigate cells (row/column) |
| `h` `j` `k` `l` | Vim-style cell navigation |
| `F2` or `e` | Enter edit mode on current cell |
| `Enter` | Save edit |
| `Escape` | Exit edit mode / return focus to table |
| `o` | Insert field after selected row |
| `O` (Shift+O) | Insert field before selected row |
| `d` or `Delete` | Delete selected field |
| `Alt+Up` | Move selected field up |
| `Alt+Down` | Move selected field down |
| `Tab` | Next cell |
| `Shift+Tab` | Previous cell |

## Bit Field Visualizer (Pro Layout)

When a field in the visualizer has keyboard focus (Tab to it, or click then use the keys below):

| Key | Action |
|-----|--------|
| `Shift+Left` / `Shift+Right` (horizontal layout) or `Shift+Up` / `Shift+Down` (vertical layout) | Resize focused field by 1 bit |
| `Alt+Left` / `Alt+Right` (horizontal layout) or `Alt+Up` / `Alt+Down` (vertical layout) | Reorder focused field (swap with neighbor) |

## Outline Sidebar

| Key | Action |
|-----|--------|
| Arrow keys or `j` / `k` | Navigate tree items |
| `Enter` / `Space` | Toggle expand/collapse |
| `→` or `l` | Focus the details panel |
| `F2` or `e` | Inline rename |

## Pointer Interactions

### Shift + Pointer

| Target | Action |
|--------|--------|
| Existing field | Resize (drag edge to expand/shrink) |
| Gap (empty bits) | Create new field (drag to select range) |

### Ctrl/Cmd + Pointer

| Target | Action |
|--------|--------|
| Existing field | Reorder (drag to new position, live preview) |

## Reset Value Cells

| Interaction | Action |
|-------------|--------|
| Click bit cell | Toggle between 0 and 1 |
| Drag across cells | Set multiple bits to same value |
| Type in hex bar | Set register value directly |
