## The memory map table editor

The `.mm.yml` file opens in a tabular editor designed for fast register entry.

### Structure

```
Address Block  (base address, range)
  └─ Register  (offset, access mode: RW / RO / WO)
       └─ Bit Field  (bits [hi:lo], reset value, description)
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `F2` or `e` | Edit selected cell |
| `Escape` | Cancel edit |
| `o` | Insert row below |
| `d` | Delete selected row |
| `↑` / `↓` or `j` / `k` | Navigate rows |
| `Alt+↑` / `Alt+↓` | Move bit field up / down |

### Bit-field visualizer

Each register row expands to show a visual bit-layout bar:

```
 31          16 15           8 7            0
 ┌─────────────┬──────────────┬─────────────┐
 │  (reserved) │   THRESHOLD  │   ENABLE    │
 └─────────────┴──────────────┴─────────────┘
```

- **Drag** field edges to resize
- **Shift+click** empty space to create a new field
- **Ctrl+drag** to reorder fields

### Access types that matter for generation

| Type | Generated behaviour |
|------|---------------------|
| `RW` | Read + write; value persists |
| `RO` | Read-only; driven by hardware |
| `WO` | Write-only; read returns zero |
| `W1C` | Write-1-to-clear; useful for status/interrupt flags |

> **Tip:** Add a description to each field — IPCraft can generate a Markdown register reference document from these descriptions using the `example-with-docs` scaffold pack.
