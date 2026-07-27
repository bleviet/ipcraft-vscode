# led_avmm Hardware Troubleshooting

Use this guide when the FPGA programs successfully but the LEDs do not show
the expected pattern.

## Expected behavior

- The firmware reads `VERSION` during startup.
- A valid version starts the cycling LED pattern.
- A version mismatch produces a persistent alternating `0xAA`/`0x55` pattern.
- The visible LED behavior does not depend on JTAG UART output.
- `EVENTS.HEARTBEAT_ACTIVE` toggles in hardware independently of the firmware.

## Interface contract

The Platform Designer component metadata and generated RTL use the following
Avalon-MM contract:

| Property            | Value                          |
| ------------------- | ------------------------------ |
| Address units       | Words                          |
| `avs_address` width | 2 bits                         |
| Register data width | 32 bits                        |
| Read latency        | Fixed; no `readdatavalid` port |
| SoC base address    | `0x00010010`                   |

The wrapper converts the word address to a byte offset:

```vhdl
address <= avs_address & "00";
```

Keep `led_controller_avmm.ip.yml`,
`altera/led_controller_avmm_hw.tcl`, and
`rtl/led_controller_avmm_avmm.vhd` consistent with this contract.

## Diagnostic sequence

### 1. Rebuild all dependent artifacts

Regenerate the Platform Designer system and rebuild the Quartus project after
an interface or address-map change:

```bash
cd examples/led_avmm/altera/quartus
make qsys project compile
make bsp app
```

The BSP must be regenerated when the hardware description or address map
changes.

### 2. Program the bitstream and firmware

```bash
make program-sof
make download-elf
```

The JTAG terminal is optional:

```bash
make terminal
```

An empty terminal does not prove that the firmware is stopped. Use register or
CPU-state inspection for an unambiguous result.

### 3. Check the registers through System Console

The debug bitstream exposes the Avalon-MM fabric through a JTAG master, so it
can diagnose the peripheral without Nios II firmware:

```bash
make debug-build
make debug-program
make debug-read-all
```

Expected reset values:

| Address      | Register      | Expected value                         |
| ------------ | ------------- | -------------------------------------- |
| `0x00010010` | `VERSION`     | `0x00000100`                           |
| `0x00010014` | `LED_PATTERN` | `0x00000000`                           |
| `0x00010018` | `EVENTS`      | Bits 0 and 1 depend on heartbeat state |

Write and verify the LED register:

```bash
make debug-write-led VALUE=0xFF
```

If readback matches but the physical LEDs do not, inspect the top-level LED
conduit and pin assignments. If readback fails, inspect the address map and
Avalon-MM interface contract.

### 4. Confirm heartbeat activity

```bash
make debug-poll REG=EVENTS COUNT=20 INTERVAL=0.5
```

`HEARTBEAT_ACTIVE` should change over time.
`HEARTBEAT_TOGGLED` is sticky and remains set until software clears it by
writing one to that bit.

### 5. Inspect firmware execution when needed

Use a Nios II GDB server when the direct register checks pass but the firmware
does not update `LED_PATTERN`:

```bash
nios2-download \
  /work/led_avmm/software/platform/nios2/led_avmm_demo.elf \
  --tcpport 2342
```

Connect with `nios2-elf-gdb`, break at `main`, and inspect:

```gdb
x/wx 0x00010014
x/wx 0x00010018
```

A changing `LED_PATTERN` value confirms that the CPU, firmware loop, and
Avalon-MM write path are active.

## Common failures

### No JTAG cable is available

Only one process can own the cable. Check for stale `jtagd`,
`nios2-terminal`, or debug processes and stop the specific process holding the
connection. Avoid broad process-name kills on shared systems.

### System Console reports no master service

The normal bitstream does not contain the JTAG-to-Avalon-MM master. Build and
program the debug variant:

```bash
make debug-build
make debug-program
```

Allow `jtagd` time to initialize before starting System Console. The provided
Makefile targets wait five seconds.

### Reads use the wrong addresses

System Console commands take byte addresses. Add each register's `.mm.yml`
offset to the SoC base address `0x00010010`. Do not convert the address to a
word index in the host tool; the Avalon interconnect and wrapper perform the
required conversion.

### `VERSION` is correct but firmware shows the fail-safe pattern

Regenerate the BSP and rebuild the application so the firmware uses the
current system description:

```bash
make bsp app
make download-elf
```

### Direct register access works but LEDs remain unchanged

Verify these boundaries in order:

1. `LED_PATTERN` readback matches the written value.
2. `led_controller_avmm_core.vhd` drives the LED output from the register
   value.
3. `led_external_connection` is exported by the Platform Designer system.
4. `de10_nano_top.vhd` connects the exported signal to the board LEDs.
5. `de10_nano_pin_assignments.tcl` assigns the correct device pins.

This sequence separates register-fabric failures from top-level wiring and
board-pin failures.
