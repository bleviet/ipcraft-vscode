## Reading the Build Reports panel

After a build completes, IPCraft parses the vendor report files and displays the key metrics in a tree view in the Explorer sidebar — no need to hunt through log files.

### Vivado metrics

| Metric | What it means | Pass condition |
|--------|--------------|----------------|
| **WNS** | Worst Negative Slack — how much timing margin your critical path has | ≥ 0 ns |
| **WHS** | Worst Hold Slack | ≥ 0 ns |
| **LUT** | Look-up table count | — |
| **FF** | Flip-flop count | — |
| **BRAM** | Block RAM count | — |
| **DSP** | DSP48 slice count | — |
| **CDC** | Clock domain crossing violations | 0 |

### Quartus metrics

| Metric | What it means |
|--------|--------------|
| **Fmax** | Maximum operating frequency for each clock |
| **LE / ALM** | Logic element / Adaptive logic module count |
| **M9K / M20K** | Memory block count |
| **DSP** | DSP block count |

### Clicking into reports

Click any metric row to open the corresponding raw report file:
- WNS → `timing.rpt`
- LUT → `utilization.rpt`
- CDC → `cdc.rpt`

The reports open as read-only text in VS Code. Use VS Code's built-in search to navigate to the critical path or the first failing constraint.

> **Tip:** Negative WNS means your design is failing timing. The number is how many nanoseconds you need to recover — pipeline the critical path or reduce logic depth.
