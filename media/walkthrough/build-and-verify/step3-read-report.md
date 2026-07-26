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

### Opening raw reports

Metric rows are summaries and are not all clickable:

- For Vivado, click the parent **Timing** row to open `timing.rpt`. The WNS,
  WHS, and failing-path child rows only display parsed values.
- When CDC violations are present, click the **CDC** row to open `cdc.rpt`.
- Utilization rows display parsed LUT, FF, BRAM, and DSP counts but do not open
  `utilization.rpt`.
- Quartus timing metrics are summaries and do not currently link to a raw
  report.

Raw reports open as normal text editors in VS Code. Use VS Code's built-in
search to navigate to a critical path or failing constraint. Use **Show Build
Output** to inspect the complete build log.

> **Tip:** Negative WNS means your design is failing timing. The number is how many nanoseconds you need to recover — pipeline the critical path or reduce logic depth.
