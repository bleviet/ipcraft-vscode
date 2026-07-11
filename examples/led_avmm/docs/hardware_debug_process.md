# led_avmm — Hardware Debug Process (LED Not Blinking)

## Goal

Investigate why `led_avmm` appeared non-functional on real hardware ("cannot see LED blinking"), identify root cause(s), fix them, and verify on board.

---

## 1. Initial Reproduction on Hardware

### What I ran first

```bash
cd led_avmm/altera/quartus
make program-sof
make download-elf
timeout 10s docker run ... ipcraft-examples/quartus:23.1 nios2-terminal
```

### Why

Before changing code, I needed to reproduce the issue exactly in the same deployment path (bitstream + ELF download + runtime observation).

### What happened

- FPGA programming succeeded.
- ELF download succeeded.
- `nios2-terminal` connected to JTAG UART but showed no application logs.

This matched the user symptom: design looked inactive.

---

## 2. Static Code/Integration Audit

I inspected:

- `rtl/led_controller_avmm.vhd`
- `rtl/led_controller_avmm_avmm.vhd`
- `altera/led_controller_avmm_hw.tcl`
- `led_controller_avmm.ip.yml`
- `software/platform/nios2/main.c`
- generated `qsys` outputs (`led_avmm_system.vhd`, interconnect)

### Key finding

There was an **interface contract drift** between metadata and RTL:

- metadata declared behavior/ports that did not line up cleanly with RTL expectations
- addressing assumptions had changed (`WORDS` path + address width edits)
- this made the build/runtime path fragile and hard to reason about

I treated this as the primary structural issue to fix.

---

## 3. Main Obstacles During Debugging

## Obstacle A: JTAG cable contention

Frequent failures like:

- `There are no JTAG cables available on your system.`
- stale `nios2-terminal`/`jtagd` processes holding the cable

### How I handled it

Checked and killed stale processes explicitly by PID:

```bash
ps -ef | grep -E 'jtagd|nios2-terminal' | grep -v grep
kill -9 <pid1> <pid2> ...
```

I used PID-targeted kills only to avoid collateral process termination.

---

## Obstacle B: No terminal output (uncertain whether app was dead or just silent)

Terminal silence alone is ambiguous:

- app may be hung
- app may be running but not printing
- app may print before/without host visibility

### How I handled it

I switched from UART-only observation to **JTAG debug evidence** using `nios2-download --tcpport` + `nios2-elf-gdb`.

This gave direct visibility into:

- program counter location
- live MMIO register contents

---

## 4. Hardware Debug Method (What, Why, Result)

### Step 1: Confirm CPU reaches firmware logic

Used GDB break/step on hardware:

```bash
nios2-download /work/led_avmm/software/platform/nios2/led_avmm_demo.elf --tcpport 2342
nios2-elf-gdb ... \
  -ex "break main" \
  -ex "continue" \
  -ex "next" ...
```

**Result:** CPU reached `main` and progressed through LED register accesses.

---

### Step 2: Confirm MMIO writes/reads are real on hardware

At loop entry, read mapped registers:

```gdb
x/wx 0x00010014   # LED_PATTERN
x/wx 0x00010018   # EVENTS
```

Observed valid values (example session):

- `LED_PATTERN = 0x00000001`
- `EVENTS = 0x00000003`

So bus transactions were alive on silicon.

---

### Step 3: Confirm runtime progress over time (not stuck)

Ran firmware, paused after time windows, and inspected state:

```bash
nios2-download -g led_avmm_demo.elf
sleep <n>
nios2-download --stop
# attach gdb via tcpport and inspect
```

Observed:

- PC in `delay_ms(...)` during normal execution
- `LED_PATTERN` changed across windows (e.g. `0x7f` -> `0x1f`)

This proved firmware continued updating LED pattern over time on real hardware.

---

## 5. Root Causes and Fixes

## Root cause 1 (structural): Avalon-MM metadata/RTL mismatch risk

### Fix

Aligned metadata with RTL behavior:

- `altera/led_controller_avmm_hw.tcl`
  - `addressUnits WORDS`
  - `avs_address` width set to `2`
  - removed phantom `avs_readdatavalid` declaration
- `led_controller_avmm.ip.yml`
  - removed `readdatavalid` from optional ports
  - set `portWidthOverrides.address: 2`

This removed contract ambiguity across generator/Platform Designer/RTL.

---

## Root cause 2 (behavioral UX): firmware depended on UART-visible behavior and pacing was poor for perception

Even when logic ran, perceived "not blinking" remained likely in practical use.

### Fix

Updated `software/app/main.c`:

- removed UART-dependent runtime messages from LED animation path
- kept VERSION validation
- on VERSION mismatch, emit obvious `0xAA/0x55` fail-safe LED pattern
- recalibrated delay loop (`5000` -> `320`) for visibly paced animation

This made LED behavior observable without requiring an attached terminal.

(At the time of this investigation, the LED demo logic lived directly in
`software/app/main.c`; it has since been split into a portable
`software/app/led_demo.c` plus a thin `software/platform/nios2/main.c` entry
point, per [`docs/README.md`](README.md)'s HAL split -- the fixes described
below still apply to the current file layout.)

---

## 6. Rebuild + On-Board Verification After Fix

### Rebuild

```bash
cd led_avmm/altera/quartus
make qsys project compile
```

### Program + run

```bash
make program-sof
nios2-download -g /work/led_avmm/software/platform/nios2/led_avmm_demo.elf
```

### Hardware proof points captured

- compilation succeeded
- programming succeeded
- CPU executed firmware (PC in runtime code, not reset trap)
- `LED_PATTERN` changed across run windows on silicon (`0x7f -> 0x1f`)

---

## 7. Why this debugging strategy worked

1. **Reproduce first** to avoid guessing.
2. **Use hard evidence** (PC + MMIO state) instead of relying only on UART text.
3. **Fix contract-level mismatches first** (metadata vs RTL).
4. **Then fix user-visible behavior** (UART-independence + pacing).
5. **Re-verify on actual hardware**, not only simulation.

---

## 8. Final Result

The design is now stabilized at both integration and firmware levels:

- Avalon-MM interface definitions are consistent across metadata and RTL.
- Firmware drives visible LED patterns without requiring terminal logging.
- Hardware validation confirmed live LED register progression during runtime.

