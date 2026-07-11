# System Console Debug — `16_ipcraft_led_avmm`

Register peek/poke on real hardware via Altera System Console, using a
JTAG-to-Avalon-MM master added to the Platform Designer system. This is the
hardware validation for [ipcraft-vscode issue #36](https://github.com/bleviet/ipcraft-vscode/issues/36)
Part B/D — the SystemConsoleTransport pattern.

See [`docs/systemconsole_implementation_plan.md`](../docs/systemconsole_implementation_plan.md)
for the full implementation plan.

## Files

| File | Description |
|------|-------------|
| `read_all_registers.tcl` | System Console CLI Tcl: discover JTAG master, read all registers |
| `write_led_pattern.tcl` | System Console CLI Tcl: write LED_PATTERN, read back, verify |
| `debug_console.py` | Python transport + driver: sentinel-framed `system-console --cli` subprocess |

## Quick start (from `quartus/`)

```bash
# 1. Build the debug variant (adds JTAG-to-Avalon-MM master to the qsys system)
make debug-build

# 2. Program the FPGA
make debug-program

# 3. Read all registers via System Console Tcl
make debug-read-all

# 4. Write LED_PATTERN = 0xFF and verify readback
make debug-write-led VALUE=0xFF

# 5. Python debug console: full register dump with field decode
make debug-dump

# 6. Poll EVENTS register (watch the heartbeat toggle)
make debug-poll REG=EVENTS COUNT=20 INTERVAL=0.5
```

## Register map

Base address: `0x00010010` (from `qsys/led_avmm_system_debug.tcl`)

| Register | Offset | Access | Reset | Fields |
|----------|--------|--------|-------|--------|
| VERSION | `0x00` | read-only | `0x00000100` | `MINOR[7:0]=0`, `MAJOR[15:8]=1` |
| LED_PATTERN | `0x04` | read-write | `0x00` | `PATTERN[7:0]` — drives LED[7:0] |
| EVENTS | `0x08` | read-write-1-to-clear | `0x00` | `HEARTBEAT_ACTIVE[0]`, `HEARTBEAT_TOGGLED[1]` |

## Direct Python usage

```bash
# List registers from .mm.yml (no hardware needed)
python3 debug/debug_console.py list

# Read a single register
python3 debug/debug_console.py --base 0x00010010 read VERSION

# Write a register
python3 debug/debug_console.py --base 0x00010010 write LED_PATTERN 0xFF

# Write a single field (read-modify-write)
python3 debug/debug_console.py --base 0x00010010 write-field LED_PATTERN PATTERN 0x55

# Poll a register
python3 debug/debug_console.py --base 0x00010010 poll EVENTS 10 0.5
```

## Direct Tcl usage

```bash
# Read all registers
system-console --cli --script=debug/read_all_registers.tcl

# Write LED_PATTERN = 0xAA
system-console --cli --script=debug/write_led_pattern.tcl --script_args=0xAA
```

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code (future)        │  Python (this repo)                   │
│  SystemConsoleTransport  │  debug_console.py                     │
│  (TypeScript)            │  SystemConsoleTransport               │
│         │                │         │                              │
│         ▼                │         ▼                              │
│  child_process.spawn     │  subprocess.Popen                     │
│  "system-console --cli"  │  "system-console --cli"               │
│         │                │         │                              │
│         ▼                │         ▼                              │
│  sentinel-framed stdin   │  sentinel-framed stdin                │
│  /stdout pipe            │  /stdout pipe                         │
└──────────────────────────┴──────────────────────────┬───────────┘
                                                       │
                                                       ▼
                                    ┌──────────────────────────────┐
                                    │  system-console --cli         │
                                    │  (Altera Tcl shell)           │
                                    │                               │
                                    │  get_service_paths master     │
                                    │  claim_service master         │
                                    │  master_read_32 / write_32    │
                                    └──────────────┬───────────────┘
                                                   │ JTAG (USB-Blaster)
                                                   ▼
                                    ┌──────────────────────────────┐
                                    │  DE10-Nano (Cyclone V)        │
                                    │                               │
                                    │  jtag_debug_master            │
                                    │  (altera_jtag_avalon_master)  │
                                    │        │                      │
                                    │        ▼                      │
                                    │  Avalon-MM interconnect       │
                                    │        │                      │
                                    │        ▼                      │
                                    │  led_controller_avmm          │
                                    │  (IPCraft-generated)          │
                                    └──────────────────────────────┘
```

## Design validation for ipcraft-vscode

The Python `debug_console.py` is a 1:1 prototype of the proposed TypeScript
`SystemConsoleTransport`:

| Python (this repo) | TypeScript (ipcraft-vscode, proposed) |
|---------------------|---------------------------------------|
| `SystemConsoleTransport.connect()` | `SystemConsoleTransport.connect(): Promise<void>` |
| `SystemConsoleTransport.read32(offset)` | `SystemConsoleTransport.read32(addr): Promise<number>` |
| `SystemConsoleTransport.write32(offset, val)` | `SystemConsoleTransport.write32(addr, val): Promise<void>` |
| `SystemConsoleTransport._exec_tcl(cmd)` | internal sentinel-framed exec |
| `SystemConsoleTransport.close()` | `SystemConsoleTransport.dispose(): void` |
| `RegisterMap` (from `.mm.yml`) | `src/domain/parse.ts` + `registerProcessor.ts` |
| `RegisterDriver.read("VERSION")` | `LiveRegisterSession.readRegister("VERSION")` |
| `RegisterDriver.write_field(...)` | `FieldProxy.set()` (read-modify-write) |
| `RegisterDriver.poll(...)` | Watch feature (periodic re-read) |
| `RegisterDriver.dump()` | `liveValues` message → webview Debug Mode |
