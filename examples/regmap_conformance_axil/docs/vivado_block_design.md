# Vivado Block Design

`xilinx/` holds the Vivado side of this example: the IPCraft-generated IP-XACT
package of `regmap_conformance_axil`, and an example block design that uses it
on a ZedBoard (`xc7z020clg484-1`). The block design is a reference for the
IPCraft system viewer, including its resource usage view. It is built through
place and route, not run on hardware: the hardware validation of this IP is the
Quartus flow in `altera/` (see `hardware_validation_results.md`).

## Files

| Path | Origin | Content |
|---|---|---|
| `xilinx/component.xml`, `xilinx/xgui/` | IPCraft (`ipcraft generate --target vivado`) | The IP package; the IP repository is `xilinx/` |
| `xilinx/regmap_conformance_axil_project.tcl`, `_run_ooc.tcl`, `_run_xpr.tcl`, `_ooc.xdc` | IPCraft | The IP core's own Vivado build (IPCraft **Build**), written to `xilinx/build/` |
| `xilinx/system/regmap_axil_system.tcl` | Vivado `write_bd_tcl` | The block design |
| `xilinx/system/zedboard.xdc` | Hand-written | The pins of the eight user LEDs |
| `xilinx/system/build_system.tcl` | Hand-written | Creates the project and builds the block design |

## The block design

`regmap_axil_system` has these blocks:

- `processing_system7_0`: the Zynq processing system. Its `M_AXI_GP0` is the
  AXI master, and `FCLK_CLK0` (100 MHz) clocks the design.
- `rst_ps7_0_100M`: the reset synchronizer.
- `axi_smc`: an AXI SmartConnect with one slave and two master interfaces.
- `conformance`: a hierarchy block that holds two instances of the IP,
  `regmap_0` at `0x43C0_0000` and `regmap_1` at `0x43C1_0000`, and `irq_concat`.
  `irq_concat` joins their four interrupts into `IRQ_F2P`. The LEDs of
  `regmap_0` drive the board's LD0 to LD7.

## Build it

With Vivado 2024.2 on the path, from `xilinx/system/`:

```bash
vivado -mode batch -source build_system.tcl -nojournal -nolog
```

The script creates the project `regmap_axil_system.xpr` in `xilinx/system/`,
runs synthesis (each IP out of context first) and implementation up to
`route_design`, and writes hierarchical utilization reports into the run
folders:

- `regmap_axil_system.runs/synth_1/regmap_axil_system_wrapper_utilization_hier_synth.rpt`
- `regmap_axil_system.runs/impl_1/regmap_axil_system_wrapper_utilization_hier_routed.rpt`

No bitstream is written. The build takes about ten minutes on a laptop. The
project files are ignored by Git.

## See the resource usage

Open `xilinx/system/regmap_axil_system.tcl` in VS Code, open the system diagram
and turn on **Resources**. The viewer finds the project next to the design and
offers the post-route and post-synthesis reports. The post-route report is used
first. With Vivado 2024.2 the post-route numbers are:

| Block | LUTs | FFs |
|---|---:|---:|
| `axi_smc` | 514 | 647 |
| `conformance` | 272 | 565 |
| `conformance/regmap_0` | 147 | 295 |
| `conformance/regmap_1` | 126 | 270 |
| `rst_ps7_0_100M` | 17 | 33 |
| Design | 800 | 1245 |

`regmap_1` uses fewer resources than `regmap_0` after routing because its LED
output is not connected, so implementation removes that logic.

The **Per-IP OOC** source needs the `xci_name` of each IP, which only the `.bd`
file records. To see it, open the project's
`regmap_axil_system.srcs/sources_1/bd/regmap_axil_system/regmap_axil_system.bd`
instead of the script. That source lists "4 of 6 IPs":

- `regmap_0` has no out-of-context report. Its configuration is the same as
  `regmap_1`, so its run was an IP cache hit. Use **Extract missing IPs** to
  write the report from its checkpoint.
- `irq_concat` (`xlconcat`) is not synthesized out of context.

To see the numbers of the IP core's own build, run it from `xilinx/`:

```bash
vivado -mode batch -source regmap_conformance_axil_run_ooc.tcl -nojournal -nolog
```

Then attach `xilinx/build/ooc/utilization.rpt` (**Attach Report...** in the
Resources tab). The viewer recognizes it as a build of
`regmap_conformance_axil` and shows 149 LUTs and 295 FFs on both `regmap_0`
and `regmap_1`. When the workspace has the `.ip.yml` of the core, the viewer
also offers it on its own as **IPCraft builds**.

The command line gives the same numbers:

```bash
ipcraft resources xilinx/system/regmap_axil_system.tcl \
  xilinx/system/regmap_axil_system.runs/impl_1/regmap_axil_system_wrapper_utilization_hier_routed.rpt
```
