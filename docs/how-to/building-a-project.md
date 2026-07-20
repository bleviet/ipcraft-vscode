# Building a Project

How to compile an IP core headlessly — without opening Vivado or Quartus — and inspect timing and utilization results inside VS Code.

## Prerequisites

- An IP Core file (`.ip.yml`) with vendor project files already generated (run `IPCraft: Scaffold Project` or `IPCraft: Generate Vivado Project` / `IPCraft: Generate Quartus Project` first)
- The vendor tool reachable from VS Code:
    - **Vivado**: configured via `ipcraft.vivado.runner` + `ipcraft.vivado.installDir` (local) or `ipcraft.vivado.dockerImage` (docker)
    - **Quartus**: configured via `ipcraft.quartus.runner` + `ipcraft.quartus.installDir` (local) or `ipcraft.quartus.dockerImage` (docker)

## Run a Build

1. Open a `.ip.yml` file in the IP Core editor
2. Run **IPCraft: Build** from the Command Palette (`Ctrl+Shift+P`), the editor title bar, or the **IPCraft** top-level menu
3. If multiple targets are available, a QuickPick appears — select one:
    - **Vivado OOC Synthesis** — fast, synthesis-only; good for checking synthesisability and resource estimates
    - **Vivado Full Implementation (XPR)** — synthesis + place + route; provides real timing numbers and a routed netlist
    - **Quartus Compile** — full synthesis + fitting + timing analysis
4. The *IPCraft Build* Output Channel opens automatically and streams the tool output line by line
5. When the run completes, the **IPCraft Build** panel in the Explorer sidebar updates with the parsed results

## Build Output Locations

| Target | Reports written to |
|--------|-------------------|
| Vivado OOC Synthesis | `xilinx/build/ooc/timing.rpt`, `utilization.rpt`, `cdc.rpt` |
| Vivado Full Implementation | `xilinx/build/xpr/timing.rpt`, `utilization.rpt`, `cdc.rpt` |
| Quartus Compile | `altera/build/output_files/<ip_name>.sta.summary`, `<ip_name>.fit.summary` |

Click any node in the **IPCraft Build** panel to open the corresponding report file directly in the editor.

## Reading the Build Panel

After a successful build the **IPCraft Build** panel in the Explorer sidebar shows a tree like:

```
Vivado — OOC           PASS
├── Timing             PASS
│   ├── WNS +1.234 ns  PASS
│   ├── WHS +0.456 ns  PASS
│   └── Failing paths: 0
└── Utilization
    ├── LUT:  1,234 / 53,200 (2.3%)
    ├── FF:   2,891 / 106,400 (2.7%)
    ├── BRAM: 4 / 140 (2.9%)
    └── DSP:  0 / 220 (0.0%)
```

For Quartus:

```
Quartus — Compile      PASS
├── Timing             PASS
│   └── Fmax: 156.25 MHz
└── Utilization
    ├── LUT:  1,234 / 41,910 (2.9%)
    ├── FF:   2,891
    └── BRAM: 16,384 / 5,662,720 (0%)
```

### Timing status

| Status | Meaning |
|--------|---------|
| PASS (green) | All timing constraints met |
| FAIL (red) | One or more timing violations |

A negative WNS (Worst Negative Slack) means setup timing is violated — the design cannot meet the target clock frequency as constrained.

> **Why this section has no screenshot:** the **IPCraft Build** panel is a native VS Code
> `TreeDataProvider` (`ReportsTreeProvider.ts`) rendered entirely by VS Code's own Explorer
> chrome — there is no webview or HTML behind it. It falls outside the
> [automated screenshot pipeline](../concepts/docs-screenshots.md), which only captures the
> three React webviews (Memory Map, IP Core, Data Inspector); reproducing this panel would
> require driving a real running VS Code window rather than a `file://` harness page.

## Status Bar

The status bar item shows the build state throughout the session:

| State | Status bar text |
|-------|----------------|
| Idle | `$(circuit-board) IPCraft` |
| Running | `$(loading~spin) Building…` |
| Vivado passed | `$(pass) WNS +1.23ns` |
| Quartus passed | `$(pass) Fmax 156 MHz` |
| Failed | `$(error) Build failed` |

Click the status bar item at any time to open the *IPCraft Build* Output Channel.

## Configuring the Build

### Local installation

| Setting | Default | Purpose |
|---------|---------|---------|
| `ipcraft.vivado.runner` | `"local"` | Set to `"local"` to use a native Vivado install |
| `ipcraft.vivado.installDir` | `""` | Path to Vivado installation directory (e.g. `/tools/Xilinx/Vivado/2024.2`). Leave empty to use `vivado` from PATH. |
| `ipcraft.quartus.runner` | `"local"` | Set to `"local"` to use a native Quartus install |
| `ipcraft.quartus.installDir` | `""` | Top-level Quartus installation directory (e.g. `/opt/intelFPGA_pro/23.1`). |
| `ipcraft.build.jobs` | `4` | Parallel jobs for Vivado `launch_runs` and Quartus compilation |

Example for a non-default Vivado installation on Linux:

```json
{
  "ipcraft.vivado.installDir": "/tools/Xilinx/Vivado/2024.2"
}
```

On Windows:

```json
{
  "ipcraft.vivado.installDir": "C:\\Xilinx\\Vivado\\2024.2"
}
```

### Docker

To run Vivado or Quartus inside a Docker container:

```json
{
  "ipcraft.vivado.runner": "docker",
  "ipcraft.vivado.dockerImage": "cvsoc/vivado:2024.2"
}
```

```json
{
  "ipcraft.quartus.runner": "docker",
  "ipcraft.quartus.dockerImage": "cvsoc/quartus:23.1"
}
```

## Under the Hood

The build targets are TCL scripts generated alongside the vendor project files:

| File | Purpose |
|------|---------|
| `xilinx/<ip_name>_run_ooc.tcl` | Sources `_project.tcl`, runs `launch_runs synth_1`, generates reports in `build/ooc/` |
| `xilinx/<ip_name>_run_xpr.tcl` | Creates a standalone XPR project in `build/xpr/`, runs synth + impl, generates reports |
| `altera/<ip_name>_project.tcl` | Creates the Quartus project (`.qpf`/`.qsf`) in `altera/build/` |

You can run these scripts manually from the command line:

```bash
# Vivado OOC synthesis
cd xilinx
vivado -mode batch -source <ip_name>_run_ooc.tcl -nojournal -nolog

# Vivado OOC synthesis with 8 parallel jobs
vivado -mode batch -source <ip_name>_run_ooc.tcl -nojournal -nolog -tclargs 8

# Vivado full implementation
vivado -mode batch -source <ip_name>_run_xpr.tcl -nojournal -nolog

# Quartus compile
cd altera/build
quartus_sh -t ../<ip_name>_project.tcl  # create project
quartus_sh --flow compile <ip_name>     # compile
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| *No build targets found* | Run `IPCraft: Scaffold Project` or `IPCraft: Generate Vivado Project` / `IPCraft: Generate Quartus Project` first |
| *Vivado not found* | Set `ipcraft.vivado.installDir` to your Vivado installation directory, or ensure `vivado` is in PATH |
| *Quartus not found* | Set `ipcraft.quartus.installDir` to your Quartus installation directory, or ensure `quartus_sh` is in PATH |
| Build exits with non-zero code | Check the *IPCraft Build* Output Channel for error messages from the tool |
| Reports panel shows no data | The tool ran but the expected report files were not written; check the Output Channel for synthesis/implementation errors |
| Timing violations (negative WNS) | Tighten the OOC constraints in `<ip_name>_ooc.xdc`, or review the critical paths in `timing.rpt` |
