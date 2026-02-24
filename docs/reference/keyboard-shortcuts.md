# Keyboard Shortcuts

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

When hovering over a field in the visualizer:

| Key | Action |
|-----|--------|
| `Shift+Left` / `Shift+Right` | Resize hovered field by 1 bit |
| `Ctrl+Left` / `Ctrl+Right` | Reorder hovered field (swap with neighbor) |

## Outline Sidebar

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate tree items |
| `F2` | Inline rename |
| `Ctrl+H` | Focus outline from anywhere |
| `Ctrl+L` | Focus details panel from anywhere |

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
