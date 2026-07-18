# Access column UX redesign (fields table)

## Problem

In the Memory Map register fields table, the Access column is unusable, worst in the
stacked ("pro") register layout and at narrow pane widths:

1. **Truncated values.** The schema access enum has 7 values up to 24 chars
   (`read-write-self-clearing`); the column is `w-[14%]` in a `table-fixed` layout
   (`src/webview/components/register/FieldsTable.tsx:255`), and `<col min-w>` is
   decorative under `table-layout: fixed` (see issue #99 browser test). The
   `VSCodeDropdown` ellipsizes to "write-1-t...". 5 of 7 values share prefixes
   (`read-write-*`, `write-*`), so the visible prefix is not distinguishing.
2. **Broken popup.** The dropdown listbox inherits host width (options truncated too)
   and, when it opens upward, is painted over by the sticky `thead` (`z-10`,
   `FieldsTable.tsx:259`) and overlapped by neighboring positioned cells. The cell's
   `overflow: visible` (`FieldTableRow.tsx:551`) does not save it from ancestors.
3. **Tooltip pile-up.** `[data-tooltip]::after` ("Double-click to edit", z-index 200,
   `src/webview/index.css:1194`) renders exactly where the popup opens, and keeps
   showing while the cell is being edited.
4. **W1C "Monitors:" sub-row.** For write-1-to-clear access, a second labeled dropdown
   is crammed into the same cell (`FieldTableRow.tsx:576-600`), breaking the uniform
   `h-12` row height and truncating its own content ("-- non...", "LINK_S...").

Agreed direction: **A** (abbreviated access tokens) + **B** (popup/stacking/tooltip
cleanup) + **D** (move Monitors out of the cell).

## Design decisions

**Keep `VSCodeDropdown` for the access cell; do not build a custom select.** The
toolkit dropdown already integrates with the table editing state machine
(`cancelEditRef`, `pointerEvents` gating in `CellInput`, and the explicit
`vscode-dropdown` carve-out in `useTableNavigation.ts:145-157` that yields arrow keys
to an open dropdown). Rebuilding that keyboard contract is over-engineering; every
problem here is presentational.

**Short-closed / long-open via option text + CSS.** The fast `Select.displayValue`
shown in the closed control is the selected option's `textContent`. So: make each
`VSCodeOption`'s text the short token (`W1C`), and append the full name in the open
listbox only, via a light-DOM pseudo-element on the option
(`vscode-option[data-option-detail]::after { content: " -- " attr(data-option-detail) }`).
`VSCodeOption` children are light DOM, so no shadow piercing is needed, and pseudo
content never leaks into `displayValue`. The toolkit exposes `part="listbox"`
(verified in `node_modules/@vscode/webview-ui-toolkit/dist/toolkit.js`), so the popup
can be widened with `vscode-dropdown::part(listbox)`.

**Token vocabulary** (industry-standard SVD/IP-XACT style; display only, YAML keeps
full enum strings):

| Enum value | Token |
|---|---|
| `read-only` | `RO` |
| `write-only` | `WO` |
| `read-write` | `RW` |
| `write-1-to-clear` | `W1C` |
| `read-write-1-to-clear` | `RW1C` |
| `write-self-clearing` | `WSC` |
| `read-write-self-clearing` | `RWSC` |

**Monitors becomes an icon button + anchored menu.** The sub-row is removed. W1C rows
get a small codicon button next to the access dropdown that opens a fixed-position
anchored menu (same proven pattern as `TableContextMenu`: `position: fixed`,
`z-[200]`, `useClampedMenuPosition`, Esc/outside-click close). Fixed positioning
escapes the scroll container entirely, so this control has no clipping problem by
construction.

## Implementation steps

### Step 1 — Access token constants

`src/webview/shared/constants.ts`:

- Add `ACCESS_ABBREVIATIONS: Record<(typeof ACCESS_OPTIONS)[number], string>` with the
  table above. Keep `ACCESS_OPTIONS` as the single source of enum values.

### Step 2 — `CellInput` dropdown options with labels/details

`src/webview/shared/components/CellInput.tsx`:

- Extend `options` to `readonly (string | { value: string; label: string; detail?: string })[]`
  (plain strings keep today's behavior).
- Render: `<VSCodeOption value={value} data-option-detail={detail}>{label}</VSCodeOption>`.
  Omit the attribute when `detail` is undefined.
- Add optional `position?: 'above' | 'below'` prop passed through to `VSCodeDropdown`.

### Step 3 — Access cell rework in `FieldTableRow`

`src/webview/components/register/FieldTableRow.tsx`:

- Build options from `ACCESS_OPTIONS`:
  `{ value: opt, label: ACCESS_ABBREVIATIONS[opt], detail: opt }`. Stored value and
  `onUpdate(['fields', index, 'access'], next)` payload remain the full enum string.
- Pass `position="below"` (prevents the opens-upward-under-sticky-header case; a
  downward popup extends the scroll container's scrollable area, so it stays
  reachable for bottom rows).
- Delete the Monitors sub-row (current lines 576-600) and the wrapping
  `flex flex-col gap-1 py-0.5`; the cell content returns to a single
  `flex items-center h-10` line, restoring uniform `h-12` rows.
- Keep the existing rule that switching access away from W1C clears
  `monitorChangeOf` (lines 567-573).
- For W1C rows, render after the dropdown: a `shrink-0` icon button
  (`codicon codicon-pulse`) with `onClick` stopPropagation, opening the monitor
  picker (Step 4). Visual states: monitor set -> normal foreground +
  `data-tooltip={"Monitors: " + monitorChangeOf}`; unset -> muted +
  `data-tooltip="Set monitored field"`.
- Fix the name-cell indicator tooltip: line 449 uses `title=`, which VS Code webviews
  suppress (see comment at `index.css:1191`); switch it to `data-tooltip`.

### Step 4 — `AnchoredPickerMenu` shared component

New `src/webview/shared/components/AnchoredPickerMenu.tsx` (export via `index.ts`):

- Props: `position: {x, y} | null`, `items: { value: string; label: string }[]`,
  `selectedValue: string | null`, `onSelect(value: string | null)`, `onClose()`.
- Rendering/behavior copied from `TableContextMenu` (fixed, `z-[200]`,
  `useClampedMenuPosition`, outside-pointerdown + Esc close). Selected item gets a
  `codicon-check`. Minimal keyboard support: ArrowUp/Down move a highlight index,
  Enter selects, Esc closes.
- `FieldTableRow` uses it for the monitor picker: items = `-- none --` (value null)
  plus sibling field names (exclude self and unnamed), selection calls
  `onUpdate(['fields', index, 'monitorChangeOf'], value)` (null to clear).
- Do not modify `TableContextMenu`; it stays purpose-built.

### Step 5 — CSS cleanup (`src/webview/index.css`)

```css
/* Open dropdown listbox: size to content, not to the (narrow) host. */
vscode-dropdown::part(listbox) {
    width: max-content;
    min-width: 100%;
    max-width: 320px;
}

/* Full access name shown in the open listbox only; the closed control shows
   the option's textContent (the short token). */
vscode-option[data-option-detail]::after {
    content: " \2014  " attr(data-option-detail);
    opacity: 0.7;
}

/* The active cell's popup must paint above the sticky thead (z-10) and
   later rows' positioned cells. The td is already position: relative. */
.vscode-cell-active {
    z-index: 20;
}

/* No "Double-click to edit" while the cell is being edited. */
[data-tooltip]:focus-within::after {
    opacity: 0;
    transition: none;
}
```

(`z-index: 20` is added to the existing `.vscode-cell-active` rule at
`index.css:132`; the rest are new rules near the tooltip block.)

These rules are global on purpose: `RegisterTableRow`/`BlockTableRow`/
`RegisterArrayEditor` cells get the same z-order and tooltip fixes for free. Verify
during implementation that no other `[data-tooltip]` host relies on showing a tooltip
while focused (grep `data-tooltip`; current hosts are table cells and BlockEditor
identity strips, where suppression-while-editing is equally correct).

## Non-goals

- No column-width rebalance: with 4-char tokens the 14% column is comfortably
  sufficient; Description keeps its 40%.
- No changes to the register/block table editors (they have no access column), to
  `RegisterTableRow`, to serialization, or to the schema. `monitorChangeOf` semantics
  are unchanged.
- No emojis anywhere (project rule); the monitor affordance uses a codicon.

## Tests

Unit (`src/test/suite/components/FieldTableRow.test.tsx`, extend; jsdom):

1. Access dropdown renders one option per `ACCESS_OPTIONS` entry, option text is the
   token, `value` and `data-option-detail` are the full enum string; committed
   updates emit the full enum value at path `['fields', index, 'access']`.
2. W1C field: monitor icon button present; non-W1C: absent; no Monitors
   `VSCodeDropdown` remains inside the cell.
3. Clicking the monitor button opens the picker listing sibling names minus self and
   `-- none --`; selecting a name emits `['fields', index, 'monitorChangeOf'], name`;
   `-- none --` emits null.
4. Changing access from `write-1-to-clear` to `read-write` still emits the
   `monitorChangeOf: null` companion update.

Unit (new `AnchoredPickerMenu.test.tsx`): renders items, marks selected, Esc and
outside-click close, ArrowDown+Enter selects.

Browser (Playwright, extend `src/test/browser/fields-table-narrow-width.spec.ts` or a
sibling spec, harness `window.__RENDER__`): at 900px width with the issue-#99-style
fixture plus a W1C field, (a) the closed access control shows the untruncated token
(no ellipsis, measured via scrollWidth <= clientWidth on the control), (b) opening
the dropdown yields a listbox whose bounding box is fully inside the viewport and not
under the sticky header, (c) all body rows have equal height.

Gates: `npm run lint` (zero warnings), `npm run type-check`, `npm run test`,
`npm run test:browser`.

## Manual verification

F5 Extension Development Host with a fixture containing W1C + `monitorChangeOf`
fields (e.g. the CSR example used in the report). Check both register layouts
(stacked "pro" and side-by-side), dark and light themes, and a narrow editor pane:
closed cells show tokens, the open popup shows `TOKEN -- full-name` untruncated, the
monitor button opens its picker, and W1C rows are the same height as other rows.

## Suggested order and branch

Branch: `access-column-ux` (no GitHub issue number known at planning time; if one is
filed, rename to `issue-NNN-access-column-ux`).

1. Step 1 + Step 2 (pure, unit-testable in isolation)
2. Step 4 (`AnchoredPickerMenu`)
3. Step 3 (cell rework)
4. Step 5 (CSS)
5. Tests, then lint/type-check/test gates
6. Manual verification

Do not commit/push; leave the working tree for developer review.
