## Out-of-Context synthesis

Out-of-Context (OOC) synthesis runs without board-level constraints. It synthesises your IP core in isolation and estimates timing relative to its own clocking, not a specific board.

### Why OOC?

| | OOC | Full implementation |
|-|-----|---------------------|
| **Speed** | ~2–5 minutes | 15–60+ minutes |
| **Result** | Timing estimate, utilization | Final placed-and-routed results |
| **Use case** | IP verification, early timing closure | Release build, board bring-up |

OOC is the right tool for iterating on your IP core. Run full implementation when you need final numbers.

### Running the build

**Generate & Build (Vivado OOC)** is a combined command that:
1. Generates all RTL and vendor packaging from your `.ip.yml`
2. Launches `vivado -mode batch` with an OOC synthesis script
3. Shows a live status bar: `$(loading~spin) Building…`
4. Displays `✓ WNS +1.23 ns` (or `✗ WNS -0.45 ns`) when done

**Generate & Build (Quartus)** runs the full Quartus flow:
1. Generates RTL and `_hw.tcl`
2. Launches `quartus_sh --flow compile`
3. Shows `✓ Fmax 156 MHz` in the status bar when done

### Status bar shortcut

The status bar item is clickable — click it at any time to open the Build Output panel and see the full synthesis log.
