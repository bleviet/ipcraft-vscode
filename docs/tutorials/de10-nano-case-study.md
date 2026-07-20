# DE10-Nano Register-Map Case Study

This case study summarizes an end-to-end use of IPCraft on a Terasic DE10-Nano. The complete
board project, software, build scripts, and hardware-validation results live in the
[`cvsoc` repository](https://github.com/bleviet/cvsoc), where they can evolve with the board
design rather than being duplicated here.

## What the Case Study Covers

The project starts from an IPCraft `.ip.yml` and `.mm.yml`, generates an Avalon-MM peripheral,
and carries it through four verification stages:

1. Generate VHDL, a register file, an Avalon-MM wrapper, testbench files, and Quartus metadata.
2. Extend the generated cocotb testbench with assertions for reset values, read/write behavior,
   and write-one-to-clear events.
3. Compile the generated project headlessly with Quartus and review timing and utilization.
4. Integrate the peripheral into a DE10-Nano Platform Designer system and access its registers
   from Nios II software and System Console.

The register map includes read-only status, read/write control, and a write-one-to-clear event
field driven by `monitorChangeOf`. Hand-written application logic is marked `managed: false` so
re-scaffolding cannot overwrite it.

## What IPCraft Verifies

IPCraft owns the specification-to-generated-artifact path: normalized YAML, RTL generation,
vendor component metadata, simulation scaffolding, project creation, and headless builds. The
board repository owns pin assignments, the Platform Designer system, firmware, programming, and
hardware-specific automation.

This boundary matters: compiling generated RTL is necessary, but exercising the same register
semantics through a real interconnect catches integration problems that a standalone generator
fixture cannot.

## Reproduce the IPCraft Portion

You can exercise the repository-independent part without owning the board:

1. Follow [Creating Your First IP Core](../how-to/create-your-first-ip-core.md) to create the IP
   Core and register-map specifications.
2. Use [Generating a Project](../how-to/generating-a-project.md) to scaffold the RTL and vendor
   files.
3. Run the generated tests using [How to Run Simulations](../how-to/run-cocotb-simulation.md).
4. If Quartus is installed, follow [Building a Project](../how-to/building-a-project.md) for a
   headless compile.

For the physical-board portion and its validation logs, use the `16_ipcraft_led_avmm`,
`17_ipcraft_regmap_conformance`, and `18_ipcraft_regmap_conformance_axil` examples in `cvsoc`.
