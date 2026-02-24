# Responsive Design

Layout architecture and responsive behavior of the webview UI.

## Breakpoints

| Range | Label | Key behaviors |
|-------|-------|---------------|
| <= 640px | Mobile | Sidebar becomes overlay. Tables switch to card view. Inputs get 44px min-height. |
| 641-900px | Tablet | Sidebar narrows to 240px. Access column hidden in field tables. |
| >= 901px | Desktop | Full sidebar (300px). All columns visible. Full bit cell size. |

The UI is optimized for desktop-first editing in VS Code and degrades gracefully for smaller panes.

## CSS Tokens

Defined in `:root` of `src/webview/index.css`:

| Token | Value | Purpose |
|-------|-------|---------|
| `--sidebar-width` | `300px` | Desktop sidebar width |
| `--sidebar-width-tablet` | `240px` | Tablet sidebar width |
| `--sidebar-width-mobile` | `280px` | Mobile overlay sidebar width |
| `--touch-target-min` | `44px` | Minimum touch target size |

## Shell Layouts

### Memory Map Editor

```text
#root (flex column)
+-- <main> (flex-1, overflow-hidden)
    +-- .sidebar-toggle-btn (mobile only)
    +-- .sidebar-backdrop (mobile only)
    +-- <aside class="sidebar"> -> <Outline />
    +-- <section> -> <DetailsPanel />
```

### IP Core Editor

```text
div.h-screen.flex.flex-col
+-- Header (filename, VLNV, validation count)
+-- div.flex-1.flex
    +-- <NavigationSidebar> (w-64)
    +-- <EditorPanel> (section editors)
+-- Validation errors (conditional)
```

Both editors share the `.sidebar` CSS class for responsive overlay behavior.

## Mobile Sidebar Overlay

Below 640px, the sidebar becomes a fixed overlay that slides in from the left:

- `.sidebar` gets `position: fixed; left: -300px` with a slide transition
- `.sidebar.sidebar-open` sets `left: 0`
- `.sidebar-backdrop.active` renders a semi-transparent overlay

## Theme Integration

VS Code theme CSS custom properties are used throughout. Key utility classes:

| Class | Maps to |
|-------|---------|
| `.vscode-surface` | `var(--vscode-editor-background)` |
| `.vscode-surface-alt` | `var(--vscode-editorWidget-background)` |
| `.vscode-border` | `var(--vscode-panel-border)` |
| `.vscode-muted` | `var(--vscode-descriptionForeground)` |

## Responsive Utility Classes

| Class | Effect |
|-------|--------|
| `.responsive-container` | Full width, overflow-x auto |
| `.stack-on-mobile` | Column layout, row at >= 641px |
| `.hide-on-mobile` | Hidden below 641px |
| `.show-on-mobile-only` | Visible only below 641px |

## Verification Checklist

When changing layout-related code, verify:

- Sidebar remains visible on desktop during wide content edits
- Mobile sidebar opens/closes correctly with backdrop
- Visualizers remain scrollable and legible
- Table headers do not overlap at tablet widths
- Touch targets meet 44px minimum on mobile
- Sticky table headers remain pinned during scroll
- High-contrast mode renders readable labels
