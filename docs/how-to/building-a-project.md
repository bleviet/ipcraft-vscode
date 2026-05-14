# Building a Project

How to compile an IP core headlessly — without opening Vivado or Quartus — and inspect timing and utilization results inside VS Code.

## Prerequisites

- An IP Core file (`.ip.yml`) with vendor project files already generated (run `IPCraft: Scaffold VHDL Project` or `IPCraft: Generate Vivado Project` / `IPCraft: Generate Quartus Project` first)
- The vendor tool reachable from VS Code:
    - **Vivado**: `vivado` in your system `PATH`, or the path configured in `ipcraft.vivadoPath`
    - **Quartus**: `quartus_sh` in your system `PATH`, or the path configured in `ipcraft.quartus.shellPath`

## Run a Build

1. Open a `.ip.yml` file in the IP Core editor, or right-click it in the Explorer
2. Run **IPCraft: Build** from the Command Palette (`Ctrl+Shift+P`), the editor title bar, or the Explorer context menu
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
Vivado — OOC           ✓
├── Timing             ✓
│   ├── WNS +1.234 ns  ✓
│   ├── WHS +0.456 ns  ✓
│   └── Failing paths: 0
└── Utilization
    ├── LUT:  1,234 / 53,200 (2.3%)
    ├── FF:   2,891 / 106,400 (2.7%)
    ├── BRAM: 4 / 140 (2.9%)
    └── DSP:  0 / 220 (0.0%)
```

For Quartus:

```
Quartus — Compile      ✓
├── Timing             ✓
│   └── Fmax: 156.25 MHz
└── Utilization
    ├── LUT:  1,234 / 41,910 (2.9%)
    ├── FF:   2,891
    └── BRAM: 16,384 / 5,662,720 (0%)
```

### Timing icons

| Icon | Meaning |
|------|---------|
| ✓ (green) | All timing constraints met |
| ✗ (red) | One or more timing violations |

A negative WNS (Worst Negative Slack) means setup timing is violated — the design cannot meet the target clock frequency as constrained.

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

| Setting | Default | Purpose |
|---------|---------|---------|
| `ipcraft.vivadoPath` | `vivado` | Path to the Vivado executable |
| `ipcraft.quartus.shellPath` | `quartus_sh` | Path to `quartus_sh` |
| `ipcraft.build.jobs` | `4` | Parallel jobs for Vivado `launch_runs` |

Example for a non-default Vivado installation on Linux:

```json
{
  "ipcraft.vivadoPath": "/tools/Xilinx/Vivado/2024.2/bin/vivado"
}
```

On Windows:

```json
{
  "ipcraft.vivadoPath": "C:\\Xilinx\\Vivado\\2024.2\\bin\\vivado.bat"
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
| *No build targets found* | Run `IPCraft: Scaffold VHDL Project` or `IPCraft: Generate Vivado Project` / `IPCraft: Generate Quartus Project` first |
| *'vivado' not found* | Set `ipcraft.vivadoPath` to the full path of the Vivado executable |
| *'quartus_sh' not found* | Set `ipcraft.quartus.shellPath` to the full path of `quartus_sh` |
| Build exits with non-zero code | Check the *IPCraft Build* Output Channel for error messages from the tool |
| Reports panel shows no data | The tool ran but the expected report files were not written; check the Output Channel for synthesis/implementation errors |
| Timing violations (negative WNS) | Tighten the OOC constraints in `<ip_name>_ooc.xdc`, or review the critical paths in `timing.rpt` |
