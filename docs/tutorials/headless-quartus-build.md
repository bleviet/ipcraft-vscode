# Headless Quartus Build: Timing, Utilization, and Two More Bugs

Part 4 of the [LED Controller on Real Hardware](led-controller-avmm-authoring.md)
series. This part drives the standalone, pin-less Quartus project IPCraft
already generated in Part 1 (`altera/`, `VIRTUAL_PIN ON -to *` — suitable for
IP-core timing/utilization verification without board pin assignments)
through a real, native Quartus 25.1std install — no Docker, no VS Code
`IPCraft: Build` command, just the same TCL scripts run directly, exactly as
`docs/how-to/building-a-project.md` documents they can be.

!!! info "What you will learn"
    - How to run IPCraft's generated Quartus TCL scripts headlessly, outside
      VS Code.
    - Two more real bugs this exercise found — both in the *scaffold pack*
      rather than the core generator, and both invisible until a real
      Quartus install actually tried to use the files.

## Running it

```bash
cd altera
quartus_sh -t led_controller_avmm_project.tcl   # create the project
quartus_sh --flow compile led_controller_avmm   # synthesis, fit, timing
```

The first run reported `Critical Warning (332148): Timing requirements not
met`, worst-case setup slack **-1.807 ns**. For a 3-register peripheral at
50 MHz, that's not remotely plausible — worth investigating before trusting
the number.

## Bug 5 — a `trimBlocks` gotcha, again

`cat altera/led_controller_avmm.sdc` showed the actual problem immediately:

```tcl
# clk — 50MHzcreate_clock -period 20.000 -name clk [get_ports { clk }]
```

The comment and the `create_clock` command are concatenated onto **one
line**. Since the line starts with `#`, the entire `create_clock` statement
is swallowed as part of the Tcl comment — **no clock constraint was ever
applied**, on any IPCraft-generated Quartus project, ever. The cause: this
repo's own documented `trimBlocks: true` gotcha (see `CLAUDE.md`) —
`quartus_sdc.j2` used an inline
`{% if clock.frequency %} — {{ clock.frequency }}{% endif %}`, and the
trailing `{% endif %}`'s newline was consumed, merging the next template
line into this one. Fixed with the documented pattern: hoist the
conditional into a `{% set %}` on its own line first.

## Bug 6 — right template, wrong number of `..`

Fixing the content wasn't enough — the constraint file still wasn't found:

```
Critical Warning (332012): Synopsys Design Constraints File file not found:
'../led_controller_avmm.sdc'.
```

`quartus_project.tcl.j2` referenced `SDC_FILE` through the same
`[file join .. {{ path }}]` wrapper used for `rtl_files` — but `rtl_files`
entries already carry their own `../rtl/...` prefix (RTL lives one directory
up from `altera/`), while the `.sdc` is written as a **sibling** of
`project.tcl`, directly in `altera/`. Wrapping it in an extra `..` pointed
one directory too high. Confirmed empirically on the real Quartus install
(not just by inspection) by trying the bare filename directly and re-running
the build before committing to the fix.

## Verification

Before both fixes: worst-case setup slack **-1.807 ns**, "Design is not
fully constrained." After: full clean build on a real Quartus 25.1std
install (Cyclone V, `5CSEBA6U23I7`):

| Metric | Result |
|--------|--------|
| Logic utilization | 77 ALMs / 41,910 (< 1%) |
| Registers | 45 |
| Worst-case setup slack | +16.99 ns (Slow 1100mV -40C) |
| Worst-case hold slack | +0.12 ns (Fast 1100mV -40C) |
| Worst-case pulse-width slack | +9.18 ns |

All four timing corner models (Slow/Fast × 100C/-40C) show positive slack.
Both fixes ship with regression tests in `IpCoreScaffolder.test.ts`,
confirmed to fail without the fix and pass with it.

## An aside: the same host runs cvsoc's own CI

This build ran on the same physical machine
(`.github/workflows/integration-vendor.yml`'s self-hosted runner) that
already validates IPCraft's own Vivado/Quartus integration tests natively —
no Docker needed there either
(`SKIP_DOCKER: 1`, native `QUARTUS_SH_BIN`). The two projects already share
real toolchain infrastructure — the `cvsoc/quartus:23.1` Docker image
referenced throughout IPCraft's test suite is built from cvsoc's own
`common/docker/Dockerfile`.

Next: [Part 5](led-controller-avmm-on-hardware.md) — programming an actual
DE10-Nano and watching the register file it drives control real LEDs.
