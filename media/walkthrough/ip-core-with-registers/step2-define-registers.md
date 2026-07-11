## The memory map table editor

The `.mm.yml` file opens in a tabular editor designed for fast register entry.

### Structure

```
Address Block  (base address, range)
  └─ Register  (offset, access mode: read-write / read-only / write-only / ...)
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
| `read-write` | Read + write; value persists |
| `read-only` | Read-only; driven by hardware |
| `write-only` | Write-only; read returns zero |
| `write-1-to-clear` / `read-write-1-to-clear` | Writing 1 clears the bit; useful for status/interrupt flags |
| `write-self-clearing` / `read-write-self-clearing` | Bit auto-clears the cycle after a write-1 (e.g. one-shot triggers) |

> **Tip:** Add a description to each field — IPCraft can generate a Markdown register reference document from these descriptions using the `example-with-docs` scaffold pack.
