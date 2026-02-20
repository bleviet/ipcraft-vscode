# Responsive Design Notes

This document summarizes the current responsive behavior in the webview UI.

Primary style source: `src/webview/index.css`.

---

## Breakpoints and Tokens

Defined in `:root`:

- `--breakpoint-mobile: 640px`
- `--breakpoint-tablet: 900px`
- `--breakpoint-desktop: 1200px`
- sidebar widths:
  - desktop `300px`
  - tablet `240px`
  - mobile overlay `280px`

---

## Shell Layout Model

Main app layout is a flex row with:

1. Sidebar (`aside.sidebar`)
2. Main details area (`section.flex-1`)

Critical constraints used to prevent overflow/push-off bugs:

- Sidebar: `shrink-0` + fixed width + `overflow-y-auto`
- Main area: `flex-1` + `min-w-0` + controlled overflow

These constraints are required for large tables and visualizers.

---

## Mobile Sidebar Behavior

For narrow viewports, sidebar becomes overlay/drawer style:

- hidden off-canvas by default
- toggled by header hamburger button
- backdrop click closes drawer

Key classes/states:

- `sidebar-open`
- `sidebar-backdrop`
- `sidebar-toggle-btn`

---

## Wide Content / Visualizers

Visualizers and dense tables rely on horizontal scrolling instead of forced shrinking.

Patterns used:

- wrappers with `overflow-x-auto`
- inner content with `min-w-max`
- explicit min widths for data-heavy cells/segments

This keeps bit/register layouts readable while preserving structural accuracy.

---

## Utility Classes Present

The stylesheet includes responsive utility helpers used by components over time:

- `.hide-on-mobile`
- `.show-on-mobile-only`
- `.hide-on-tablet`

Use these only when component-level Tailwind classes are insufficient.

---

## Known Design Bias

The current UI is optimized for desktop-first editing in VS Code and degrades gracefully for smaller panes.

Future enhancements (not yet fully standardized):

- richer mobile editing affordances for dense tables
- additional adaptive behaviors for very narrow side-by-side editor panes

---

## Verification Checklist

When changing layout-related code, verify:

- sidebar remains visible on desktop during wide content edits
- mobile sidebar opens/closes correctly with backdrop
- register/bit visualizers remain scrollable and legible
- table headers/columns do not overlap at tablet widths
- no horizontal growth pushes flex siblings off-screen
