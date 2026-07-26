# Quartus processor platforms

The DE10-Nano integration has two independent soft-processor implementations:

- `platforms/nios2/`: the legacy Nios II/e Platform Designer system and
  Quartus project for Quartus 23.x. Its default container is
  `ipcraft-examples/quartus:23.1`; a compatible native installation also
  works.
- `platforms/niosv/`: the Nios V/m Platform Designer system and Quartus project
  for Quartus 24.x and newer. Quartus supplies the Nios V BSP tools; compiling
  firmware additionally requires `riscv32-unknown-elf-gcc`.

Use the dispatcher in this directory:

```bash
make processor
make                              # current native installation, auto-selected
make PROCESSOR=niosv hardware     # explicit current hardware build
make PROCESSOR=niosv software     # BSP and firmware
make PROCESSOR=niosv USE_DOCKER=0 program-sof
make PROCESSOR=niosv USE_DOCKER=0 download-elf  # native board download
make PROCESSOR=nios2 USE_DOCKER=1 # legacy Quartus 23.1 flow
```

`PROCESSOR=auto` selects Nios V when `intel_niosv_m` exists in the active
Quartus installation and otherwise selects Nios II. Set `USE_DOCKER=0` or
`USE_DOCKER=1` to override backend detection. Docker is selected only when the
configured image is locally available; no image is downloaded implicitly.

Generated `.qsys`, `.sopcinfo`, BSP, CMake build, and Quartus output files are
ignored. The Tcl system descriptions, project scripts, constraints, and
processor-specific firmware sources are committed.
