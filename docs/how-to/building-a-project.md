# Building a Project

IPCraft can run Vivado or Quartus without opening the vendor interface. This is
called a headless build. Tool output, timing, and resource use appear in VS Code.

## Before you build

You need:

- an `.ip.yml` file;
- generated Vivado or Quartus project files;
- the matching tool configured locally or through Docker.

Run **IPCraft: Scaffold Project**, **Generate Vivado Project**, or
**Generate Quartus Project** first if no build target exists.

## Run the build

1. Open the IP core.
2. Run **IPCraft: Build**.
3. If prompted, choose a target.
4. Follow live messages in the **IPCraft Build** output channel.
5. Review the Build panel in the Explorer when the tool finishes.

```mermaid
flowchart LR
    A[Generated project scripts] --> B[IPCraft: Build]
    B --> C[Vivado or Quartus batch process]
    C --> D[Tool reports]
    D --> E[Build panel and status bar]
```

## Choose a target

| Target | Work performed | Best use |
|---|---|---|
| Vivado out-of-context synthesis | Synthesizes the IP core alone | Fast syntax, clock, and resource check |
| Vivado full implementation | Synthesizes, places, and routes | Final timing for the chosen part |
| Quartus compile | Synthesizes, fits, and analyzes timing | Complete Quartus result |

Out-of-context means the IP core is built by itself, outside a complete FPGA
system. XPR is Vivado's saved project format.

## Read the result

The Build panel reports:

- pass, fail, or running state;
- timing summary;
- resource use such as lookup tables, registers, memory blocks, and DSP blocks;
- links to the complete vendor reports.

Timing slack is the margin between the required and actual signal arrival time.
A negative worst slack means at least one path misses its timing requirement.

```text
Vivado — OOC           PASS
├── Timing
│   ├── Worst setup slack: +1.234 ns
│   └── Failing paths: 0
└── Resources
    ├── LUT: 1,234 / 53,200
    ├── FF:  2,891 / 106,400
    └── BRAM: 4 / 140
```

Select a report node to open the underlying file.

The panel is native VS Code interface, so it is not part of the automated
webview screenshot pipeline. See [documentation screenshots](../concepts/docs-screenshots.md)
for the capture boundary.

## Report locations

| Target | Directory |
|---|---|
| Vivado out-of-context | `xilinx/build/ooc/` |
| Vivado full implementation | `xilinx/build/xpr/` |
| Quartus compile | `altera/build/output_files/` |

## Status bar

The IPCraft status item shows whether a build is running, passed, or failed.
A successful Vivado build shows worst timing slack; a successful Quartus build
shows maximum clock frequency. Select the item to reopen the output channel.

## Configure a local tool

```json
{
  "ipcraft.vivado.runner": "local",
  "ipcraft.vivado.installDir": "/tools/Xilinx/Vivado/2024.2",
  "ipcraft.quartus.runner": "local",
  "ipcraft.quartus.installDir": "/opt/intelFPGA_pro/23.1",
  "ipcraft.build.jobs": 4
}
```

Leave an installation directory empty when the tool command is already on
`PATH`.

## Configure Docker

```json
{
  "ipcraft.vivado.runner": "docker",
  "ipcraft.vivado.dockerImage": "cvsoc/vivado:2024.2"
}
```

Quartus uses the equivalent `ipcraft.quartus.runner` and
`ipcraft.quartus.dockerImage` settings.

## Troubleshooting

| Problem | Check |
|---|---|
| No build targets | Generate the vendor project first |
| Tool not found | Installation directory, `PATH`, or Docker image |
| Build command fails | First vendor error in the IPCraft Build output channel |
| Panel has no report | Confirm the vendor wrote files to the expected directory |
| Negative timing slack | Clock constraints and the critical path in the timing report |

For raw commands and every setting, see the
[commands and settings reference](../reference/commands.md).
