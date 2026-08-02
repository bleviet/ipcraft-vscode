# Block Design System Verification Design

**Status:** Proposed — reviewed in brainstorming, no issue or implementation plan yet.

This document defines the intended first product slice only; it does not
author or change a Vivado block design.

## Problem and value

IPCraft can generate and simulate an IP core in isolation. That does not prove
the core operates correctly in its assembled FPGA system. A system-level test
must exercise the real interconnect, address translation, clock/reset wiring,
and vendor or third-party IP surrounding the target core.

The feature lets a user recreate a checked-in Vivado design, select one
already-external memory-mapped entry interface and one IPCraft IP instance, and
verify the instance's `.mm.yml` register contract through the real system path.
The source design remains authoritative and is never modified or re-authored by
IPCraft. The first runner is a generated VHDL testbench executed with Vivado
XSim, so it does not require Cocotb, Questa, AXI VIP, or an open-source
mixed-language simulator.

## Scope

Version 1 supports Vivado only, with these limits:

- Input is a checked-in, reproducible Vivado recreation Tcl script.
- The selected test-entry interface is already exposed at the block-design
  boundary. IPCraft does not add an AXI VIP, expose an internal port, or alter
  the in-memory graph.
- The first supported transport is AXI4-Lite.
- One explicitly selected target is verified in a run.
- The target has an IPCraft `.mm.yml` file that supplies the register oracle.
- Other IPs may be from any source and remain part of the simulated DUT. They
  need no `.mm.yml` and receive no automatic traffic or assertions.
- The testbench drives only single-word, ordered AXI4-Lite reads and writes.
  Bursts, multiple outstanding transactions, random traffic, and AXI VIP are
  deferred.

The feature does not parse `.bd` files, guess an interface, import a GUI-only
design, inject AXI VIP, expose an internal port, or provide a common vendor
simulator implementation in version 1.

## Configuration and target binding

A project-level configuration owns system verification because a block design
can contain several independent IP cores. It is not an extension of an
individual `.ip.yml` or of the global Nunjucks `TemplateContext` contract.

```yaml
recreateScript: hardware/system/create_system.tcl
part: xc7z020clg484-1
designName: system
clockPath: /sys_clk
clockPeriodNs: 10
resetPath: /sys_rst_n
resetActiveLow: true
resetCycles: 5

target:
  driveInterfacePath: /S_AXI_TEST
  instancePath: /control_0
  memoryMap: ../ip/control.mm.yml
```

`driveInterfacePath` is the external block-design interface driven by a test
master. `instancePath` identifies the IPCraft IP whose local registers are
verified. `memoryMap` provides the expected register layout and behavior.
The clock and reset fields are explicit because a valid boundary port does not
give IPCraft a safe way to infer its simulated frequency, polarity, or reset
duration.

Vivado discovery must prove that the boundary interface reaches the selected
instance over a compatible AXI4-Lite path. It resolves the route and the
instance address segment, so transactions use the system address
`baseAddress + registerOffset`, not an isolated IP-local address.

The configuration later expands to a `targets` list. The first release
requires one bound target so reset, test isolation, and error reports are
unambiguous.

## Architecture

```text
recreation Tcl
  -> Vivado system discovery
  -> DiscoveredSystem (instances, interfaces, routes, address segments)
  -> SystemVerificationPlanner (target + memory-map binding)
  -> generated VHDL testbench, AXI4-Lite BFM, Makefile, and Vivado Tcl runner
  -> XSim batch simulation
  -> structured result, logs, and optional waveforms
```

`BlockDesignSimulationConfig` loads and validates the project configuration.
`VivadoSystemDiscovery` runs Vivado in a generated work directory and emits a
normalized `DiscoveredSystem` manifest. `SystemVerificationPlanner` is pure: it
checks the target binding and makes an absolute-address test plan from the
discovered route and the normalized memory map.

`VivadoXsimHdlRunner` recreates/exports sources and generates a self-checking
VHDL testbench for batch XSim. Its generated `Makefile` is mandatory and is the
supported developer, CI, and extension-host entry point; `run_xsim.tcl` is the
implementation layer called by `make run`. GNU Make and Vivado are explicit
toolchain prerequisites. Do not make a broad runner framework prematurely. The
stable reuse point for a future Platform Designer implementation is
`DiscoveredSystem` plus the system verification plan; vendor discovery and
simulator/export mechanics remain vendor-specific.

## Generated runner and testbench

The generated VHDL testbench instantiates the Vivado-generated system wrapper,
drives the configured clock and reset, and connects a VHDL AXI4-Lite master BFM
to the already-exposed `driveInterfacePath`. XSim provides the mixed-language
elaboration for the assembled DUT; the generated testbench itself is VHDL.

The BFM permits one ordered, single-word transaction at a time. It has a
bounded response timeout and reports the address, direction, data, AXI
response, and failing phase. It generates deterministic register values from
the verification plan: reset expectations plus `0`, all writable bits set, and
walking-one patterns where the field access semantics permit them. Complex user
logic, specialised side effects, bursts, randomization, and stress traffic
remain custom-test or future-runner responsibilities.

The generated runner directory is version-controlled beside the recreation Tcl:

```text
hardware/system/
  create_system.tcl
  verification/
    system-verification.yml
    Makefile
    scripts/run_xsim.tcl
    tb/system_verification_tb.vhd
    tb/axi4lite_master_bfm.vhd
```

`make run` recreates, discovers, validates, compiles, elaborates, and simulates.
`make run WAVES=1` retains waveform capture. `make clean` removes only local
run artifacts. Transient Vivado/XSim work, logs, waves, and `result.json` are
kept under `.ipcraft/system-verification/<run-id>/` and are not source files.

## User experience and staging

`Generate System Testbench from Vivado Tcl` is the entry command. It accepts a
checked-in recreation Tcl file, runs discovery in an isolated scratch workspace,
and lets the user select a target interface, target instance, memory map, clock,
and reset configuration. IPCraft then generates the complete runner scaffold in
memory and opens the existing Staging Panel before writing project files.

The Staging Panel lists `system-verification.yml`, `Makefile`, Tcl, and VHDL
files as new, modified, unchanged, or protected. The user can preview or diff
each file and explicitly accept overwrite choices. Cancelling writes no project
files and discards the temporary discovery workspace. Existing staging behavior
is reused rather than creating a new review UI.

System verification is a long-running, cancellable operation. The extension
shows a persistent System Simulation run view with typed lifecycle events:

1. Preflight: configuration and tool/version checks.
2. Recreate: Vivado runs the named Tcl script, with elapsed time.
3. Discover: design name, interface and instance counts, and selected route.
4. Plan: target instance, resolved base address, and memory-map oracle.
5. Export, compile, and elaborate: active command and live output.
6. Run: current scenario, test count, and waveform/output locations.
7. Complete: pass, fail, or cancelled status, duration, and first actionable
   diagnostic.

The view includes a compact route summary from the boundary interface through
the interconnect to the selected instance. Raw output is retained in a
dedicated Output channel and linked from the active stage. The extension host
emits typed events across the existing webview message boundary; the UI does
not scrape or poll console output.

Cancelling a simulation run terminates only the process tree started for that
run, preserves its logs and generated artifacts, and records a cancelled result
rather than a failure.

## Execution and errors

Report failures at the first invalid layer:

1. GNU Make or Vivado is unavailable, or the configuration is invalid.
2. Recreation Tcl or Vivado failed.
3. The expected design, external boundary, clock, reset, or target instance is
   absent.
4. The target bus is unsupported, not externally reachable, or has no unique
   compatible route/address segment.
5. The resolved address range conflicts with the linked memory map.
6. Simulation export, compilation, elaboration, a BFM timeout, an AXI error
   response, or a test assertion failed.

Each diagnostic identifies the configuration field, discovered object path, and
link to the relevant tool output when available. Test failures additionally
identify the register name, absolute system address, requested/expected/observed
values, access type, and AXI response. Logs, `result.json`, and waveforms remain
available after failure.

## Delivery sequence and feasibility

1. Define the project configuration, discovery manifest, pure route resolver,
   planner, and visible lifecycle reporting.
2. Add the Vivado discovery integration fixture and generate a plan for an
   external AXI4-Lite route through interconnect and a non-IPCraft neighbour.
3. Generate the staged, version-controlled Makefile/Tcl/VHDL scaffold.
4. Deliver the XSim self-checking VHDL runner and AXI4-Lite BFM.

The foundation is moderate effort and low conceptual risk because the project
already runs Vivado batch Tcl and has a memory-map verification model. The XSim
runner is the largest new component because the HDL BFM, artifact generator,
and assertion/test generator are new.

## Verification strategy

- Unit tests cover configuration validation, discovery-manifest parsing, route
  resolution, base-address calculation, deterministic test-vector construction,
  and verification-plan construction.
- Captured discovery manifests cover missing paths, ambiguous routes,
  unsupported buses, and unbound third-party IP.
- VHDL BFM tests run against a hand-written AXI4-Lite slave model and cover
  read/write handshakes, byte strobes, AXI errors, timeouts, and reset polarity
  and duration.
- Generator and process-contract tests cover staged artifacts, `make run`,
  `make run WAVES=1`, `make clean`, preflight diagnostics, and result/log
  creation without requiring Vivado.
- Vivado/XSim integration tests, gated when Vivado is available, recreate a
  fixture with AXI interconnect or SmartConnect, a VHDL IPCraft target, and a
  Verilog or SystemVerilog non-IPCraft neighbour. They prove reset values,
  legal reads, deterministic write/readback patterns, absolute-address routing,
  and one intentional failure diagnostic.

## Future extension

Platform Designer should implement its own recreate, discovery, export, and
simulator integration. It may produce the same `DiscoveredSystem` and consume
the same verification plan, but it is not within version 1. Supporting
additional bound targets, custom tests for unbound IPs, SystemVerilog AXI VIP,
bursts, randomized traffic, and Cocotb/Questa runners follows after the
single-target reset and reporting semantics are proven.
