# Responsive Design Notes

This document describes the layout architecture and responsive behavior of the webview UI.

Primary style source: `src/webview/index.css`.
Tailwind utility classes: configured in `tailwind.config.js` (content scope: `src/webview/**/*.{ts,tsx}`).

---

## CSS Tokens

Defined in `:root` of `src/webview/index.css`:

| Token | Value | Purpose |
|---|---|---|
| `--sidebar-width` | `300px` | Desktop sidebar width |
| `--sidebar-width-tablet` | `240px` | Tablet sidebar width |
| `--sidebar-width-mobile` | `280px` | Mobile overlay sidebar width |
| `--header-height` | `40px` | App header height |
| `--touch-target-min` | `44px` | Minimum touch target size |
| `--breakpoint-mobile` | `640px` | Mobile breakpoint reference |
| `--breakpoint-tablet` | `900px` | Tablet breakpoint reference |
| `--breakpoint-desktop` | `1200px` | Desktop breakpoint reference |

High-contrast / forced-colors tokens (`--ipcraft-pattern-*`) adjust under `@media (forced-colors: active), (prefers-contrast: more)` to use solid `var(--vscode-foreground)` values and disable text shadows.

---

## Tailwind Configuration

```js
// tailwind.config.js
module.exports = {
    content: ['./src/webview/**/*.{ts,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--vscode-font-family)', 'sans-serif'],
                mono: ['var(--vscode-editor-font-family)', 'monospace'],
            },
        },
    },
    plugins: [],
};
```

No custom screens or breakpoints are defined in Tailwind. All responsive logic uses raw CSS media queries in `index.css`. Tailwind provides utility classes only; fonts bridge to VS Code CSS custom properties.

---

## Shell Layout -- Memory Map Editor

Root mount: `#root`. Source: `src/webview/index.tsx`.

```
#root  (flex flex-col, 100% height, min-height: 0)
|
+-- <header>  (shrink-0, px-6 py-3, border-bottom)
|   +-- left:  .sidebar-toggle-btn + <h1> + breadcrumbs (file name + selection path)
|   +-- right: Save + Validate icon buttons
|
+-- <main>  (flex-1 flex overflow-hidden)
    +-- .sidebar-backdrop  (mobile only, fixed overlay, z-index: 99)
    +-- <aside class="sidebar">  (flex flex-col shrink-0 overflow-y-auto)
    |   +-- <Outline />
    +-- <section class="flex-1 overflow-hidden min-w-0">
        +-- <DetailsPanel />
```

Key layout constraints:
- `body`: `overflow: hidden`, no padding/margin.
- `#root`: `display: flex; flex-direction: column; min-height: 0`.
- Sidebar: `flex-shrink: 0` + fixed width + `overflow-y: auto` + `border-right`.
- Main content: `flex: 1` + `min-width: 0` + `overflow: hidden`. The `min-w-0` is critical to prevent large tables/visualizers from pushing the sidebar off-screen.

---

## Shell Layout -- IP Core Editor

Root mount: `#ipcore-root`. Source: `src/webview/ipcore/IpCoreApp.tsx`.

```
div.h-screen.flex.flex-col
|
+-- Header  (px-4 py-2, sideBar-background, border-bottom)
|   +-- .sidebar-toggle-btn + filename + VLNV info
|   +-- Validation error count
|
+-- div.flex-1.flex.overflow-hidden
|   +-- .sidebar-backdrop  (mobile only)
|   +-- <NavigationSidebar class="w-64 sidebar">  (256px via Tailwind, + .sidebar CSS class)
|   +-- <EditorPanel class="flex-1 overflow-y-auto min-w-0">
|       +-- Section-specific editor (MetadataEditor, ClocksTable, etc.)
|
+-- Validation errors panel  (conditional, border-top, warning background)
```

| Aspect | Memory Map Editor | IP Core Editor |
|---|---|---|
| Root element | `#root` | `#ipcore-root` |
| Sidebar component | `<Outline>` (hierarchical tree) | `<NavigationSidebar>` (flat section list) |
| Sidebar width | `var(--sidebar-width)` = 300px | `w-64` = 256px (Tailwind) |
| Details panel | `<DetailsPanel>` routing to sub-editors | `<EditorPanel>` switching between section editors |

Both editors share the `.sidebar` CSS class, so the responsive overlay behavior on mobile applies identically.

---

## Sidebar / Outline

Source: `src/webview/components/Outline.tsx`.

```
<aside class="sidebar">
  <Outline>
    +-- <OutlineHeader />          -- Search filter input + expand/collapse toggle
    +-- div.flex-1.overflow-y-auto.py-2
    |   +-- div.px-3.mb-2          -- "Memory Map" section label
    |   +-- div[role="tree"]       -- tabIndex=0, keyboard navigable
    |       +-- .tree-item         -- Root node
    |       +-- <OutlineTreeNodes> -- BlockNode, RegisterNode, RegisterArrayNode
    +-- div.outline-footer.p-3     -- Item count + base address
  </Outline>
</aside>
```

Tree items use `.tree-item`:
- `display: flex; align-items: center; padding: 4px 8px; border-left: 3px solid transparent`
- Hover: `var(--vscode-list-hoverBackground)` + 35% focus border
- Selected: `var(--vscode-list-activeSelectionBackground)` + solid focus border

Inline rename renders an `<input>` with `var(--vscode-input-background)` and dynamic width `max(80, editingValue.length * 8)px`.

---

## Details Panel Architecture

Source: `src/webview/components/DetailsPanel.tsx`.

`DetailsPanel` is a routing coordinator with no layout of its own. Based on `selectedType`, it renders:

| `selectedType` | Component | Source |
|---|---|---|
| `'register'` | `<RegisterEditor>` | `components/register/RegisterEditor.tsx` |
| `'memoryMap'` | `<MemoryMapEditor>` | `components/memorymap/MemoryMapEditor.tsx` |
| `'block'` | `<BlockEditor>` | `components/memorymap/BlockEditor.tsx` |
| `'array'` | `<RegisterArrayEditor>` | `components/memorymap/RegisterArrayEditor.tsx` |
| `null` / fallback | Centred placeholder | -- |

Array-element masquerade: when an array element is selected (`__element_index` present), single-register arrays render as `'register'`, multi-register arrays render as `'block'`.

### Sub-editor Layout Pattern

`BlockEditor` and `MemoryMapEditor` use the same two-section vertical layout:

```
div.flex.flex-col.w-full.h-full.min-h-0
|
+-- div.vscode-surface.border-b.vscode-border.p-8.shrink-0.relative.overflow-hidden
|   +-- Header (h2 + description)
|   +-- Visualizer component
|
+-- div.flex-1.flex.overflow-hidden.min-h-0
    +-- Scrollable table area (flex-1, overflow-auto)
        +-- <table class="w-full text-left border-collapse table-fixed">
```

The top section (visualizer + header) is `shrink-0` so it never collapses. The bottom section (table) takes remaining space via `flex-1` and scrolls independently.

### RegisterEditor Layout Modes

`RegisterEditor` now supports a persisted layout toggle with two modes:

| Mode | Structure | BitFieldVisualizer layout |
|---|---|---|
| `side-by-side` (default) | Header bar on top, then split pane (`.register-visualizer-pane` on left + `FieldsTable` on right) | `layout="vertical"` |
| `stacked` (legacy) | Header bar on top, visualizer section under header, fields table below | `layout="pro"` |

Preference key: `registerLayout` in webview state (`vscode.getState()` / `vscode.setState()`).

---

## Table Layout

All editor tables share this pattern:

```
div.flex-1.overflow-auto.min-h-0       -- scrollable container
  table.w-full.text-left.border-collapse.table-fixed
    colgroup                            -- percentage widths with min-w constraints
    thead.sticky.top-0.z-10            -- pinned header row
    tbody
```

Column widths per editor:

| Editor | Columns (width / min-width) |
|---|---|
| MemoryMapEditor | Name 25%/200px, Base 20%/120px, Size 15%/100px, Usage 15%/100px, Description 25% |
| BlockEditor | Name 30%/200px, Offset 20%/120px, Access 15%/100px, Description 35% |
| FieldsTable | Name 18%/120px, Bit(s) 14%/100px, Access 14%/120px, Reset 14%/110px, Description 40%/240px |

Active cell highlight: `.vscode-cell-active` applies `box-shadow: inset 0 0 0 2px var(--vscode-focusBorder)`.

Sticky header: `thead th` gets `position: sticky; top: 0; z-index: 1; background: var(--vscode-editorWidget-background)`.

---

## Visualizer Layouts

### BitFieldVisualizer

Source: `src/webview/components/BitFieldVisualizer.tsx`. Three layout modes via `layout` prop.

**Default layout** (`DefaultLayoutView`):
```
div.w-full.flex.flex-col.items-center
+-- div.flex.flex-row-reverse.gap-0.5.select-none
|   +-- per-bit cells: div.w-10.h-20  (40px x 80px each)
+-- value bar
```
Bits render right-to-left (`flex-row-reverse`). Each bit cell is a fixed 40x80px.

**Pro layout** (`ProLayoutView`):
```
div.w-full
+-- #bitfield-keyboard-help  (sr-only, accessibility text)
+-- div.relative.w-full.flex.items-start.overflow-x-auto.pb-2
|   +-- div.relative.flex.flex-row.items-end.gap-0.5.pl-4.pr-2.pt-12.pb-2.min-h-[64px].w-full.min-w-max
|       +-- per-segment: div with width: calc({bitCount} * 2rem)
|           +-- div.h-20.w-full.rounded-t-md  (colored segment)
|           +-- Tooltip: absolute -top-12, adaptive horizontal positioning
|           +-- Bit indices: div.w-10.text-center
+-- value bar
```

Segment widths computed as `calc(N * 2rem)`. Container has `overflow-x-auto` + inner `min-w-max` for horizontal scrolling when segments overflow.

**Vertical layout** (`VerticalLayoutView`):
```
div.h-full.flex.flex-col
+-- sr-only keyboard help text
+-- div.flex-1.overflow-y-auto
|   +-- per-segment rows with height: calc({bitCount} * 2rem)
|       +-- left bit labels (MSB top, LSB bottom)
|       +-- center vertical strip (fixed width, per-bit stacked cells)
|       +-- right inline field meta (name/range/value, truncated)
+-- value bar (bottom)
```

Segment height is proportional to bit count (`calc(N * 2rem)`), mirroring `pro` layout width semantics. Vertical cells reuse the same shared field color palette (`FIELD_COLORS`/`getFieldColor`) as table rows and pro-layout cells.

Vertical interaction cues:
- Shift-hover shows top/bottom resize handle indicators using the same constraint model as `ProLayoutView`.
- Ctrl-hover/drag adds a focus border and drag indicator badge.

### AddressMapVisualizer

Source: `src/webview/components/AddressMapVisualizer.tsx`.

```
div.w-full
+-- div.relative.w-full.flex.items-start.overflow-x-auto.pb-2
    +-- div.relative.flex.flex-row.items-end.gap-0.pl-4.pr-2.pt-12.pb-2.min-h-[64px].w-full
        +-- per-block: div.relative.flex-1.min-w-[120px]
            +-- div.h-20.w-full  (colored block, rounded-md)
            +-- Tooltip: absolute -top-12
            +-- Address label below
```

Blocks use `flex-1` with `min-w-[120px]`. Container scrolls horizontally when constrained.

### RegisterMapVisualizer

Source: `src/webview/components/RegisterMapVisualizer.tsx`.

Same structure as AddressMapVisualizer but per-register. Each register is `flex-1 min-w-[120px]`. Array registers get a `border-2 border-dashed` treatment. Supports Ctrl+drag reorder with ghost preview.

---

## Responsive Breakpoints

| Range | Label | Key behaviors |
|---|---|---|
| <= 640px | Mobile | Sidebar becomes fixed overlay. Toggle button shown (44x44px). Tables switch to card view. Form grids go single-column. Inputs get 44px min-height and 16px font. Header wraps, toolbar buttons become icon-only. |
| 641--900px | Tablet | Sidebar narrows to 240px, always visible. Toggle button hidden. Access column hidden in field tables. Details split stays horizontal. Register side-by-side pane narrows to 260px min 220px. |
| >= 901px | Desktop | Sidebar at full 300px. All columns visible. Full bit cell size. |

Register side-by-side specifics:
- `.register-visualizer-pane` width is 340px (`min-width: 280px`, `max-width: 460px`) on desktop.
- `.register-visualizer-pane` uses `overflow-x: hidden` to avoid dual-axis scrolling in the visualizer pane.
- At `<= 640px`, `.register-visualizer-pane` is hidden by CSS; the table remains full width.
- The layout toggle still switches persisted state on mobile; hidden-pane behavior is purely CSS-driven.

### Mobile Sidebar Overlay

```css
@media (max-width: 640px) {
  .sidebar {
    position: fixed;
    left: -300px;
    width: var(--sidebar-width-mobile);  /* 280px */
    height: calc(100vh - var(--header-height));
    top: var(--header-height);
    z-index: 100;
    transition: left 0.3s ease-in-out;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3);
  }
  .sidebar.sidebar-open { left: 0; }
  .sidebar-backdrop.active {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99; opacity: 1; pointer-events: all;
  }
}
```

React state `sidebarOpen` toggles the `sidebar-open` class and renders the backdrop. Clicking the backdrop calls `setSidebarOpen(false)`.

### Responsive Header

At <= 640px: header wraps, title shrinks to `0.875rem`, toolbar buttons become icon-only (`span:not(.codicon)` hidden), all buttons get `var(--touch-target-min)` sizing.

### Responsive Tables

At <= 640px: `.fields-table` is `display: none`, replaced by `.fields-table-mobile` (card layout with `.field-card` items including header/badge/body grid). At 641--900px: Access column (`:nth-child(3)`) is hidden.

### Responsive Visualizers

At <= 900px: bit cells reduce from default to 1.5rem via `!important` overrides on `.bitfield-visualizer .bit-cell`. AddressMapVisualizer and RegisterMapVisualizer handle overflow via `overflow-x-auto` + `min-w-[120px]` per item.

### Details Split

At <= 900px: `.details-split` switches from `flex-direction: row` to `column`. The right panel (`details-right`) loses its fixed width and max-width constraints. The left panel border changes from `border-right` to `border-bottom`.

---

## Utility Classes

Defined in `src/webview/index.css`:

| Class | Effect |
|---|---|
| `.responsive-container` | `width: 100%; max-width: 100%; overflow-x: auto` |
| `.stack-on-mobile` | `flex-direction: column`, switches to `row` at >= 641px |
| `.hide-on-mobile` | Hidden below 641px |
| `.show-on-mobile-only` | Hidden at >= 641px |
| `.hide-on-tablet` | Hidden between 641--900px |

Use these only when component-level Tailwind classes are insufficient.

---

## Theme Helpers

VS Code theme integration classes defined in `index.css`:

| Class | Maps to |
|---|---|
| `.vscode-surface` | `var(--vscode-editor-background)` + `var(--vscode-foreground)` |
| `.vscode-surface-alt` | `var(--vscode-editorWidget-background)` |
| `.vscode-border` | `border-color: var(--vscode-panel-border)` |
| `.vscode-muted` | `color: var(--vscode-descriptionForeground)` |
| `.vscode-icon-button` | Muted color, hover: toolbar background + link foreground |
| `.vscode-row-hover` | `var(--vscode-list-hoverBackground)` |
| `.vscode-row-selected` | `var(--vscode-list-activeSelectionBackground)` |
| `.vscode-cell-active` | Inactive selection background + 2px focus border inset |
| `.vscode-error` | `var(--vscode-errorForeground)` |
| `.vscode-badge` | Badge background/foreground with subtle border |
| `.fpga-grid-bg` | 12% foreground grid lines (1px) |
| `.fpga-bit-grid-bg` | 14% foreground grid lines (1px) |

---

## Touch and Accessibility

- **Touch targets**: All interactive elements use `min-width/min-height: var(--touch-target-min)` (44px) on mobile. The sidebar toggle button is 44x44.
- **iOS zoom prevention**: `font-size: 16px` on inputs at mobile widths.
- **Keyboard navigation**: `Ctrl+H` focuses outline, `Ctrl+L` focuses details. Outline supports vim-style `j/k` navigation, `F2` for inline rename. Tables support full arrow-key cell navigation via `useTableNavigation` hook.
- **ARIA**: Outline tree uses `role="tree"`, `aria-expanded`, `aria-selected`. BitFieldVisualizer pro-layout segments use `role="button"`, `tabIndex={0}`, `aria-describedby` (keyboard help), `aria-keyshortcuts`.
- **Screen reader**: ProLayoutView includes an `sr-only` help div: "Use Alt plus Left or Right arrow to reorder a field..."

---

## Design Bias

The UI is optimized for desktop-first editing in VS Code and degrades gracefully for smaller panes.

---

## Verification Checklist

When changing layout-related code, verify:

- Sidebar remains visible on desktop during wide content edits
- Mobile sidebar opens/closes correctly with backdrop
- Register/bit visualizers remain scrollable and legible
- Table headers/columns do not overlap at tablet widths
- No horizontal growth pushes flex siblings off-screen
- Touch targets meet 44px minimum on mobile
- Sticky table headers remain pinned during scroll
- Details split stacks vertically at tablet widths
- Card view renders correctly when table is hidden on mobile
- High-contrast mode tokens render readable labels
