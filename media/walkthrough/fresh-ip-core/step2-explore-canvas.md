## Anatomy of the canvas

The canvas renders your IP core as a live block diagram. Every change you make in the editors is reflected here instantly — and vice versa.

```
┌─ Library Palette ──────────────────────────────── Inspector ─┐
│  AXI4-Lite Slave                                             │
│  AXI4 Master        ┌──────────────────┐   ← selected port  │
│  Avalon-MM Slave    │   clk  ●──────── │   Name: clk        │
│  ...                │   rst_n ●─────── │   Frequency: 100M  │
│                     │                  │                     │
│                     │ ─────────● data_o│   Direction: out   │
│                     │ ─────────● valid │   Width: 32        │
│                     │                  │                     │
│                     │ ═══════════● AXI │   Bus type: axi4.. │
│                     └──────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

| Edge | What appears there |
|------|--------------------|
| **Left** | Clocks and resets |
| **Right** | Scalar ports and bus interfaces |
| **Bottom** | Overflow ports and interrupts |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Delete` | Remove selected element |
| `Ctrl+D` | Duplicate selected port |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+0` | Reset zoom |
| `Ctrl+Wheel` | Zoom in / out |
