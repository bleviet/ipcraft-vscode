## Configuring your toolchain

IPCraft runs Vivado and Quartus in batch mode — no GUI needed. Point it at your installation once and it handles the rest.

### Vivado (Xilinx/AMD)

Open **IPCraft Settings** and set:

| Setting | Example value |
|---------|--------------|
| `ipcraft.vivado.installDir` | `/opt/Xilinx/Vivado/2023.2` |
| `ipcraft.vivado.defaultPart` | `xc7z020clg484-1` |

IPCraft finds `vivado` at `<installDir>/bin/vivado` automatically.

### Quartus (Intel/Altera)

| Setting | Example value |
|---------|--------------|
| `ipcraft.quartus.installDir` | `/opt/intelFPGA_pro/23.3` |
| `ipcraft.quartus.defaultDevice` | `5CSEBA6U23I7` |

IPCraft uses `quartus_sh` for compilation and `qsys-edit` for Platform Designer.

### Docker runner

If you do not have tools installed locally, set `ipcraft.vivado.runner` or `ipcraft.quartus.runner` to `docker` and provide a Docker image:

| Setting | Example value |
|---------|--------------|
| `ipcraft.vivado.runner` | `docker` |
| `ipcraft.vivado.dockerImage` | `xilinx/vivado:2023.2` |

### Verifying the configuration

After setting `installDir`, run any build command — IPCraft will report **Vivado not found** or **Quartus not configured** in the status bar if the path is incorrect. Click the status bar message to jump straight to the relevant setting.
