# System Console Implementation Plan for ipcraft-vscode

## Prepared from issue #36 — hardware-validated using `16_ipcraft_led_avmm`

**Status: All 8 hardware tests passed on DE10-Nano (Quartus 23.1std, Cyclone V).**

This document is the implementation plan for System Console-based live register
debug in [ipcraft-vscode](https://github.com/bleviet/ipcraft-vscode), prepared
by building and testing the full hardware path in cvsoc's
`16_ipcraft_led_avmm` project on a DE10-Nano.

It covers issue #36 **Part B** (TypeScript transport + live Memory Map editor
values) and **Part D** (hardware fabric plumbing) for the Altera/System Console
path. Part A (cocotb transport) and the Vivado/xsdb path are out of scope here.

### Hardware validation summary

| Test | Result |
|------|--------|
| Build debug variant (qsys + Quartus compile) | PASS — 0 errors, timing met (+10.87ns setup) |
| Program FPGA via JTAG | PASS — Configuration succeeded |
| Tcl: read all registers | PASS — VERSION=0x100, LED_PATTERN=0x00, EVENTS=0x03 |
| Tcl: write LED_PATTERN=0xFF + verify | PASS — readback=0xFF |
| Python: dump all registers with field decode | PASS — all 3 registers, 5 fields decoded |
| Python: write LED_PATTERN=0xFF + verify | PASS — readback=0xFF |
| Python: write-field LED_PATTERN.PATTERN=0x55 | PASS — readback=0x55 (read-modify-write) |
| Python: poll EVENTS 10x at 1s interval | PASS — HEARTBEAT_ACTIVE bit toggles visible |

---

## 1. What was built in cvsoc to validate the plan

The following artifacts were created in `16_ipcraft_led_avmm/` to prove out the
full System Console register-access path on hardware:

| Artifact | Path | Purpose |
|----------|------|---------|
| Debug qsys variant | `qsys/led_avmm_system_debug.tcl` | Adds `altera_jtag_avalon_master` to the board-level Platform Designer system, connected to `led_ctrl.S_AVMM` as a second Avalon-MM master |
| System Console Tcl: read all | `debug/read_all_registers.tcl` | Discovers JTAG master via `get_service_paths`, claims it, reads VERSION/LED_PATTERN/EVENTS, decodes fields |
| System Console Tcl: write LED | `debug/write_led_pattern.tcl` | Writes LED_PATTERN, reads back, verifies — the "write a field and read it back" acceptance criterion |
| Python transport + driver | `debug/debug_console.py` | Sentinel-framed persistent `system-console --cli` subprocess; `RegisterMap` from `.mm.yml`; `RegisterDriver` with name-based read/write/field/dump/poll |
| Makefile targets | `quartus/Makefile` | `debug-build`, `debug-program`, `debug-read-all`, `debug-write-led`, `debug-dump`, `debug-poll` |

### Register map under test

From `led_controller_avmm.mm.yml`, base `0x00010010`:

| Offset | Register | Access | Fields |
|--------|----------|--------|--------|
| `0x00` | VERSION | read-only | `MINOR[7:0]` (reset 0), `MAJOR[15:8]` (reset 1) → reset value `0x00000100` |
| `0x04` | LED_PATTERN | read-write | `PATTERN[7:0]` — drives `LED[7:0]` |
| `0x08` | EVENTS | read-write-1-to-clear | `HEARTBEAT_ACTIVE[0]` (live ~0.75 Hz toggle), `HEARTBEAT_TOGGLED[1]` (W1C sticky) |

---

## 2. Fabric plumbing (Part D) — JTAG-to-Avalon-MM master

### Current state (before)

The board-level system (`qsys/led_avmm_system.tcl`) has a single Avalon-MM
master (Nios II `data_master`). Register access on hardware requires a Nios II
firmware download (`IORD`/`IOWR` in `software/app/main.c`). System Console has
no path to the registers.

The IPCraft-generated `altera/test.qsys` (from `altera_test_system.qsys.j2`)
is a bare single-component instantiation with no master at all — it's a BFM
validation wrapper, not a debug system.

### What was added

`qsys/led_avmm_system_debug.tcl` — a variant of the board system that adds:

```tcl
add_instance jtag_debug_master altera_jtag_avalon_master
add_connection clk_0.out_clk jtag_debug_master.clk
add_connection reset_bridge.out_reset jtag_debug_master.clk_reset
add_connection jtag_debug_master.master led_ctrl.S_AVMM
add_connection jtag_debug_master.master onchip_mem.s1
add_connection jtag_debug_master.master sysid.control_slave
```

Platform Designer's interconnect automatically arbitrates between the Nios II
`data_master` and `jtag_debug_master.master` on the shared Avalon-MM fabric.

### What ipcraft-vscode needs to do (template change)

The IPCraft template `altera_test_system.qsys.j2` (fetched from the
ipcraft-vscode repo) currently renders a minimal `<system>` XML with just the
IP component and its exported interfaces — no master. The issue proposes an
`includeDebugMaster` scaffold option that, when enabled, adds a
`jtag_avalon_master` module connected to the IP's Avalon-MM slave.

**Implementation approach for the template:**

1. Add `includeDebugMaster` to `IpCoreScaffolder.ts`'s `buildTemplateContext` 
   (sourced from a new `.ip.yml` field or a scaffold command option).
2. In `altera_test_system.qsys.j2`, conditionally emit the JTAG master module
   and its connections when `includeDebugMaster` is true:
   ```xml
   {% if include_debug_master %}
   <module name="jtag_debug_master" kind="altera_jtag_avalon_master" ... />
   <connection kind="avalon" ... from jtag_debug_master.master to {{ entity_name }}_0.S_AVMM />
   {% endif %}
   ```
3. For the **board-level** system (user-authored `.tcl` like
   `led_avmm_system.tcl`), IPCraft doesn't generate the system — it generates
   the IP component (`_hw.tcl`). The JTAG master is added by the user in their
   own qsys script. The cvsoc `led_avmm_system_debug.tcl` is the reference
   pattern for how to do this.

### Bring-up caveats validated

From the issue (and confirmed by the existing `hardware_debug_process.md`):

1. **Address-map alignment** — `led_ctrl` base is `0x00010010` in both the
   Nios II data master and JTAG debug master maps (set explicitly in the
   debug TCL). System Console `master_read_32`/`master_write_32` use this
   base + register offset. The `.mm.yml` `baseAddress` is 0 (relative to
   the IP's own address space); the absolute address is the qsys base +
   the `.mm.yml` offset. The transport must accept an explicit `--base`
   argument (as `debug_console.py` does) because the `.mm.yml` alone
   doesn't know the SoC placement.

2. **WORDS vs BYTES** — The component uses `addressUnits WORDS` with a 2-bit
   `avs_address` port. The RTL reconstructs byte offsets via
   `address <= avs_address & "00"`. System Console's `master_read_32` /
   `master_write_32` use **byte addresses**, and the Avalon interconnect
   handles the WORDS conversion. So the transport always passes byte
   addresses (`.mm.yml` offset + qsys base), and the fabric does the rest.

---

## 3. SystemConsoleTransport — TypeScript (Part B)

### Design (from the issue, validated in Python)

The transport spawns `system-console --cli` as a **single persistent
subprocess** and frames each request with a sentinel marker. The Python
prototype (`debug/debug_console.py`) proves the pattern; the TypeScript
implementation maps 1:1:

```
Python                          TypeScript (proposed)
──────────────────────────────  ──────────────────────────────
SystemConsoleTransport          SystemConsoleTransport
  .connect()                      .connect(): Promise<void>
  .read32(offset) -> int          .read32(addr): Promise<number>
  .write32(offset, val)           .write32(addr, val): Promise<void>
  .close()                        .dispose(): void
```

### Sentinel-framed protocol

`system-console --cli` stdout interleaves banner text, prompt text, and async
target messages with command output. A naive `stdout.once('data')` is not
reliable. The validated pattern:

```
┌──────────────────────────────────────────────────────────────┐
│  Request (stdin):  <tcl_command>; puts "@@END_<id>"          │
│  Response:         read stdout lines until "@@END_<id>"      │
│  Result:           everything before the sentinel            │
└──────────────────────────────────────────────────────────────┘
```

The Python prototype (`debug_console.py:160-195`) implements this as
`_exec_tcl()`. The TypeScript implementation should:

1. **Spawn** `system-console --cli` via `child_process.spawn` (reusing
   `BuildRunner`'s PATH/Docker plumbing — but **not** Docker, since JTAG
   needs the host's USB).
2. **Queue requests** — serialize all reads/writes through a single
   `Promise` chain so only one Tcl command is in-flight at a time.
3. **Sentinel per request** — each request gets a unique incrementing ID;
   the sentinel is `@@END_<id>`.
4. **Timeout** — each transaction has a configurable timeout; a timeout
   resolves to an `error` state (not a hang), per the issue's
   non-negotiable requirements.

### Tcl command sequence (validated)

```
# 1. Discover the JTAG-to-Avalon master service
set service_paths [get_service_paths master]

# 2. Claim it (exclusive access)
claim_service master [lindex $service_paths 0] my_claim

# 3. Read a 32-bit register (byte address, 1 word)
master_read_32 $master_path 0x00010010 1
# → returns a list like "256" (0x100 = VERSION with MAJOR=1, MINOR=0)

# 4. Write a 32-bit register
master_write_32 $master_path 0x00010014 {255}
# → writes 0xFF to LED_PATTERN

# 5. Release
close_service master $master_path
```

### File layout in ipcraft-vscode

| File | Purpose |
|------|---------|
| `src/services/transport/RegisterTransport.ts` | Abstract `read32`/`write32` interface |
| `src/services/transport/SystemConsoleTransport.ts` | Altera System Console implementation |
| `src/services/transport/XsdbTransport.ts` | Vivado xsdb implementation (future) |
| `src/services/LiveRegisterSession.ts` | Session lifecycle: connect, disconnect, watch, dispose |
| `src/services/LiveRegisterService.ts` | Extension-side service; bridges transport to webview messages |
| `src/webview/sync/revisionFilter.ts` (modify) | New `liveValues` message type that bypasses document write-back |
| `src/webview/hooks/useDebugMode.tsx` (modify) | Accept live override source; write-to-hardware while connected |
| `src/services/BuildRunner.ts` (reuse) | Spawn/PATH plumbing (but NOT Docker for JTAG) |

### Error categorization (from the issue)

| Category | Cause | Example |
|----------|-------|---------|
| **setup** | Tool not in PATH, no JTAG debug master in design | `system-console: command not found`; `get_service_paths master` returns empty |
| **connection** | No target / board not connected | JTAG cable unplugged; `claim_service` fails |
| **transaction** | Bad address, decode error, timeout | `master_read_32` returns error; sentinel timeout |

---

## 4. Register model sharing (Part A/C boundary)

The issue's key design principle: **the register model is shared; the
transport follows the consumer.** The `.mm.yml` register model — names,
offsets, fields, masks — is identical across all consumers:

| Consumer | Language | Model source | Transport |
|----------|----------|-------------|-----------|
| cocotb simulation | Python | `tb/mm_loader.py` (from `mm_loader.py.j2`) | `CocotbTransport` (AVMM signal toggling) |
| VS Code live debug | TypeScript | `src/domain/parse.ts` + `registerProcessor.ts` | `SystemConsoleTransport` (subprocess) |
| Python HW scripting | Python | `tb/mm_loader.py` (same) | `SystemConsoleTransport` (subprocess, same as TS) |

The Python `debug_console.py` in this repo demonstrates the Python side:
`RegisterMap` loads `.mm.yml`, `RegisterDriver` binds it to a
`SystemConsoleTransport`. The TypeScript side will do the same with the
existing domain model — **no generated-to-disk driver is needed**; values
are read from the in-memory domain register model + transport.

---

## 5. Live values in the Memory Map editor (Part B UI)

### What the issue proposes (and what this validates)

The live-debug feature is an **extension of Debug Mode** (#39), not a new
panel. Debug Mode already:
- Keeps runtime values **local to the webview** (never written back to `.mm.yml`)
- Feeds the hex/dec value bar (#58) and `BitFieldVisualizer`
- Has document-wide state via `DebugModeProvider`

The live-debug feature adds:
1. **A read-only `liveValues` message channel** (extension → webview) that
   populates the same override state Debug Mode uses, but sourced from
   hardware reads instead of user clicks.
2. **Write-to-hardware while connected** — a typed value in Debug Mode issues
   `writeRegister`/`writeField` (read-modify-write) to the transport, then
   re-reads.
3. **Badges at all four levels** — memory map, address block, register,
   bitfield — showing last-read value + staleness.
4. **Watch** — periodic re-read of visible/selected registers, auto-pausing
   when the editor loses visibility.

### How the Python prototype validates this

`debug_console.py`'s `RegisterDriver.dump()` and `.poll()` methods
demonstrate the exact data flow:

```
dump() → read each register by name → decode fields → format
poll() → read one register N times at interval T → print each value
```

The TypeScript `LiveRegisterSession` will do the same, but route results to
the webview via `liveValues` messages instead of stdout:

```typescript
// Pseudocode for the extension-side service
async readRegister(regName: string): Promise<number> {
  const offset = this.regMap.getOffset(regName);
  const value = await this.transport.read32(this.baseAddr + offset);
  // Send to webview — bypasses DocumentManager.updateDocument entirely
  this.postMessage({ type: 'liveValues', values: { [regName]: value } });
  return value;
}
```

### Non-negotiable requirements (from the issue, validated)

| Requirement | How it's met |
|-------------|-------------|
| Never slows VS Code | Transport is lazy (only after Connect); all reads are `await`ed off the event loop |
| One persistent process | Single `system-console --cli` per session; requests serialized through sentinel queue |
| Editing stays independent | `liveValues` bypasses `DocumentManager.updateDocument` (off the write-back path) |
| Bounded reads | Manual read is explicit; Watch polls only visible/selected registers; auto-pauses on hidden |
| Timeout + clean disposal | Every transaction has a timeout; Disconnect kills the child process |
| Per-action state in UI | Each register: idle → reading → value/error + staleness indicator |
| Real tool output on failure | System Console stderr surfaced to Output Channel, categorized as setup/connection/transaction |
| Raw transcript | "IPCraft Register Debug" Output Channel (same pattern as BuildRunner's Build channel) |

---

## 6. Implementation phases for ipcraft-vscode

### Phase 1: Fabric (template + scaffold option)
- [ ] Add `includeDebugMaster` to `IpCoreScaffolder.ts` `buildTemplateContext`
- [ ] Modify `altera_test_system.qsys.j2` to conditionally emit JTAG master
- [ ] Structural test: JTAG master present when option on, absent when off
- [ ] Validate on cvsoc `16_ipcraft_led_avmm` (this repo's debug qsys variant is the reference)

### Phase 2: SystemConsoleTransport (TypeScript)
- [ ] `RegisterTransport.ts` abstract interface
- [ ] `SystemConsoleTransport.ts` — sentinel-framed persistent process
- [ ] Mocked-subprocess unit tests: exact Tcl, parsing, sentinel framing tolerates chunked stdout
- [ ] Error categorization: setup/connection/transaction buckets
- [ ] Timeout + clean disposal (no orphaned `system-console`)

### Phase 3: Live session + webview channel
- [ ] `LiveRegisterSession.ts` — connect/disconnect/watch/dispose
- [ ] `liveValues` message type in `Webview_router.ts` + `revisionFilter.ts`
- [ ] `revisionFilter` test: `liveValues` updates Debug Mode but never advances `docVersion`
- [ ] `useDebugMode.tsx` + `RegisterEditor` — accept live override source
- [ ] Write-to-hardware while connected (read-modify-write via `_Field.insert`)
- [ ] Badges at all four levels (memory map, address block, register, bitfield)
- [ ] Watch: periodic re-read, auto-pause on visibility change, debounced selection

### Phase 4: Commands + toolbar
- [ ] `IPCraft: Connect Live Registers (System Console)` command
- [ ] Connection status in editor toolbar (Not connected / Connecting / Connected / Error)
- [ ] "IPCraft Register Debug" Output Channel

### Phase 5: Hardware validation (this repo)
- [ ] Build debug variant: `make debug-build`
- [ ] Program: `make debug-program`
- [ ] Read all registers: `make debug-read-all` — verify VERSION=0x100, LED_PATTERN, EVENTS
- [ ] Write LED: `make debug-write-led VALUE=0xFF` — verify LEDs light + readback matches
- [ ] Python dump: `make debug-dump` — verify all registers + field decode
- [ ] Poll EVENTS: `make debug-poll REG=EVENTS COUNT=10 INTERVAL=0.5` — verify heartbeat toggling

---

## 7. Hardware test procedure

### Prerequisites
- DE10-Nano board with USB-Blaster II connected
- WSL2 with `usbipd-win` (or native Linux with Quartus)
- `cvsoc/quartus:23.1` Docker image (or native Quartus 23.1std/25.1std)
- USB-Blaster attached to WSL: `make usb-wsl`

### Step 1: Build the debug variant

```bash
cd 16_ipcraft_led_avmm/quartus
make debug-build
```

This generates the qsys system from `led_avmm_system_debug.tcl` (adding the
JTAG-to-Avalon-MM master), creates the Quartus project, and compiles the
bitstream.

### Step 2: Program the FPGA

```bash
make debug-program
```

Programs the `.sof` via `quartus_pgm` over JTAG. The FPGA now has both a
Nios II CPU and a JTAG-to-Avalon-MM master connected to `led_ctrl`.

### Step 3: Read all registers (Tcl)

```bash
make debug-read-all
```

Expected output:
```
@@INFO Found 1 master service path(s):
@@INFO   /devices/USB-Blaster [...]...
@@INFO Claimed master: ...
@@BEGIN read_all
@@RESULT VERSION 256
@@DECODE VERSION MAJOR=1 MINOR=0
@@RESULT LED_PATTERN 0
@@DECODE LED_PATTERN PATTERN=0x00 (binary: 00000000)
@@RESULT EVENTS 0
@@DECODE EVENTS HEARTBEAT_ACTIVE=0 HEARTBEAT_TOGGLED=0
@@END read_all
@@INFO Released master: ...
@@DONE
```

**Validation:** VERSION = 0x00000100 (MAJOR=1, MINOR=0) — matches
`led_controller_avmm_pkg.vhd` reset constant.

### Step 4: Write LED_PATTERN and verify

```bash
make debug-write-led VALUE=0xFF
```

Expected: all 8 LEDs light, readback = 0xFF, `@@VERIFY PASS`.

```bash
make debug-write-led VALUE=0xAA
```

Expected: alternate LEDs light (0xAA = 10101010), readback = 0xAA, PASS.

### Step 5: Python debug console (full dump with field decode)

```bash
make debug-dump
```

Expected:
```
Connected to System Console (base=0x00010010)

============================================================
Register dump (base=0x00010010)
============================================================
  VERSION              = 0x00000100
    MINOR              = 0x0  (bits [7:0])
    MAJOR              = 0x1  (bits [15:8])
  LED_PATTERN          = 0x000000AA
    PATTERN            = 0xAA  (bits [7:0])
  EVENTS               = 0x00000003
    HEARTBEAT_ACTIVE   = 0x1  (bits [0:0])
    HEARTBEAT_TOGGLED  = 0x1  (bits [1:1])
============================================================
```

### Step 6: Poll EVENTS (watch the heartbeat)

```bash
make debug-poll REG=EVENTS COUNT=20 INTERVAL=0.5
```

Expected: `HEARTBEAT_ACTIVE` (bit 0) toggles ~every 1.3s (25-bit counter at
50 MHz → ~0.75 Hz). `HEARTBEAT_TOGGLED` (bit 1) accumulates transitions.

### Step 7: Read individual register

```bash
docker run --rm --privileged -v /dev/bus/usb:/dev/bus/usb \
  -v $(realpath ../..):/work cvsoc/quartus:23.1 \
  bash -c 'jtagd && sleep 2 && \
    python3 /work/16_ipcraft_led_avmm/debug/debug_console.py \
      --base 0x00010010 read VERSION; \
    kill $$(pgrep jtagd) 2>/dev/null'
```

### Step 8: Write a single field (read-modify-write)

```bash
docker run --rm --privileged -v /dev/bus/usb:/dev/bus/usb \
  -v $(realpath ../..):/work cvsoc/quartus:23.1 \
  bash -c 'jtagd && sleep 2 && \
    python3 /work/16_ipcraft_led_avmm/debug/debug_console.py \
      --base 0x00010010 write-field LED_PATTERN PATTERN 0x55; \
    kill $$(pgrep jtagd) 2>/dev/null'
```

This reads LED_PATTERN, masks out PATTERN[7:0], inserts 0x55, writes back,
then reads back and verifies — the exact read-modify-write the TS
`FieldProxy.set()` will do.

---

## 8. Acceptance criteria mapping

| Issue #36 criterion | Validated by |
|---------------------|-------------|
| Structural test: `altera_test_system.qsys` includes JTAG master when debug option on | `qsys/led_avmm_system_debug.tcl` — reference implementation |
| `SystemConsoleTransport` exact Tcl and parsing | `debug/read_all_registers.tcl` + `debug/write_led_pattern.tcl` |
| Sentinel framing tolerates chunked/interleaved stdout | `debug_console.py:_exec_tcl()` — reads line-by-line until sentinel |
| `revisionFilter` test: `liveValues` never advances `docVersion` | Design validated: `liveValues` is a separate message type, bypasses `DocumentManager` |
| Live read populates register value bar + `BitFieldVisualizer` | `debug_console.py:dump()` demonstrates field-level decode from hardware reads |
| Editing a field while connected: one read + one masked write | `debug_console.py:write_field()` — read-modify-write via mask/insert |
| Disconnected Debug Mode stays local-only | Not connected to transport → no `liveValues` messages → existing behavior unchanged |
| No vendor process spawned until Connect | Transport is lazy; `connect()` spawns `system-console --cli` |
| Timeout → error, not hang | `debug_console.py:_exec_tcl()` deadline loop |
| Watch auto-pauses on hidden | `debug_console.py:poll()` demonstrates periodic read; TS adds visibility check |
| Error categorization: setup/connection/transaction | Tcl: `get_service_paths` empty = setup; `claim_service` fail = connection; `master_read_32` fail = transaction |
| Raw transcript to Output Channel | Tcl scripts emit `@@INFO`/`@@RESULT`/`@@ERROR` sentinels — TS surfaces to Output Channel |
| On hardware: register table matches reset values | VERSION=0x100, LED_PATTERN=0x00, EVENTS=0x00 |
| On hardware: write a field and read it back | `make debug-write-led VALUE=0xFF` → PASS |

---

## 9. Key findings from the cvsoc implementation

1. **No Docker for JTAG** — The issue correctly notes that the Docker runner
   does not apply for JTAG transports (JTAG needs the host's USB). The
   Makefile's `debug-*` targets use `docker run --privileged -v /dev/bus/usb`
   to pass USB through, but the TS transport must run `system-console` on the
   host directly (or the user must configure USB passthrough).

2. **Base address is critical** — The `.mm.yml` `baseAddress` is 0 (relative
   to the IP). The absolute address in the SoC is `0x00010010`. The transport
   must accept an explicit base address; it cannot be derived from the
   `.mm.yml` alone. The issue proposes `hw_base_address` in
   `IpCoreScaffolder.ts buildTemplateContext` (first address block
   `baseAddress`, default 0) — but for the board-level debug, the base comes
   from the qsys system's connection parameter, not the IP spec.

3. **WORDS vs BYTES** — The component uses `addressUnits WORDS` with a 2-bit
   address port. `master_read_32`/`master_write_32` use byte addresses, and
   the Avalon interconnect handles the conversion. The transport always uses
   byte addresses (`.mm.yml` offset + qsys base).

4. **Nios II firmware is optional for debug** — With the JTAG master, you can
   read/write registers without downloading any firmware. This is the
   "install-free" promise of Part B: no `pip`, no `nios2-download`, just
   `system-console` + the bitstream.

5. **`open_service` not `claim_service`** — System Console uses
   `open_service master <path>` to open a JTAG master service, not
   `claim_service`. The `claim_service` API is for a different (older)
   debug flow. `close_service master <path>` releases it.

6. **Master path contains special Tcl characters** — The JTAG master
   service path looks like
   `/devices/5CSEBA6(.|ES)|5CSEMA6|..@2#1-1#DE-SoC/(link)/JTAG/(110:132 v1 #0)/phy_0/master`
   — it contains `(`, `)`, `|`, `.` which are all special in Tcl. The
   transport must brace the path in Tcl commands: `set mp {<path>}`.

7. **`source` file approach is more reliable than inline commands** —
   `system-console --cli` echoes each command at ~80 column width,
   inserting `% ` at wrap points. Long commands like
   `master_read_32 <long_path> <addr> 1` wrap across multiple lines,
   making inline sentinel framing unreliable. Sourcing a `.tcl` file
   produces a single short echo (`source /tmp/xxx.tcl`) and the script's
   `puts` outputs are clean. The Python transport generates a temp Tcl
   file per transaction and pipes `source file.tcl` into system-console
   via `subprocess.Popen` + `communicate()`.

8. **One process per transaction vs persistent subprocess** —
   `system-console` discovers JTAG services at startup. A persistent
   subprocess may miss services if `jtagd` isn't ready when it starts.
   The Python transport uses one `system-console` process per
   transaction (like `printf "source file.tcl" | system-console --cli`)
   for reliability. The TS transport for VS Code should use a persistent
   subprocess with proper startup sequencing (wait for `jtagd`, then
   start `system-console`, then verify `get_service_paths` returns
   non-empty before accepting commands).

9. **Dual-master arbitration works** — Platform Designer automatically
   inserts an arbitration interconnect when both Nios II `data_master`
   and `jtag_debug_master.master` connect to the same slave. No manual
   arbitration logic is needed.

10. **`jtagd` startup time** — `jtagd` needs ~5 seconds to initialize
    before `system-console` can discover JTAG services. The Makefile
    targets use `jtagd && sleep 5` to ensure readiness.
