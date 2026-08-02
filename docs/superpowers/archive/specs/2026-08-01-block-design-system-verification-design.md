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
IPCraft.

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

The feature does not parse `.bd` files, guess an interface, import a GUI-only
design, or provide a common vendor simulator implementation in version 1.

## Configuration and target binding

A project-level configuration owns system verification because a block design
can contain several independent IP cores. It is not an extension of an
individual `.ip.yml` or of the global Nunjucks `TemplateContext` contract.

```yaml
recreateScript: hardware/system/create_system.tcl
part: xc7z020clg484-1
designName: system

target:
  driveInterfacePath: /S_AXI_TEST
  instancePath: /control_0
  memoryMap: ../ip/control.mm.yml
```

`driveInterfacePath` is the external block-design interface driven by a test
master. `instancePath` identifies the IPCraft IP whose local registers are
verified. `memoryMap` provides the expected register layout and behavior.

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
  -> runner-specific generated work
     -> Questa and Cocotb
     -> Vivado XSim and self-checking HDL testbench
```

`BlockDesignSimulationConfig` loads and validates the project configuration.
`VivadoSystemDiscovery` runs Vivado in a generated work directory and emits a
normalized `DiscoveredSystem` manifest. `SystemVerificationPlanner` is pure: it
checks the target binding and makes an absolute-address test plan from the
discovered route and the normalized memory map.

Keep the two runners separate:

- `VivadoQuestaCocotbRunner` recreates/exports the simulation sources that
  Questa needs and generates the Python/Cocotb test.
- `VivadoXsimHdlRunner` recreates/exports sources and generates a
  self-checking HDL testbench for batch XSim.

Do not make a broad runner framework prematurely. The stable reuse point for a
future Platform Designer implementation is `DiscoveredSystem` plus the system
verification plan; vendor discovery and simulator/export mechanics remain
vendor-specific.

## Simulation paths

The Questa path can reuse the current Cocotb register semantics and
memory-map-derived verification artifacts, but must add Vivado simulation
export, library, and source-order orchestration.

The XSim path cannot depend on Cocotb. It generates an HDL AXI4-Lite BFM and
self-checking assertions from the same verification plan, then runs the Vivado
compile, elaboration, and batch simulation flow. IPCraft does not currently
contain an HDL bus BFM; this is the largest new technical component.

Initially, the XSim test verifies reset behavior, readable reset values, legal
reads, and basic writes. Complex user logic and specialised side effects remain
custom-test responsibilities until the HDL BFM and assertion library are
extended.

## User experience

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

Cancelling terminates only the process tree started for the run, preserves its
logs and generated artifacts, and records a cancelled result rather than a
failure.

## Errors

Report failures at the first invalid layer:

1. Recreation Tcl or Vivado failed.
2. The expected design, external boundary, or target instance is absent.
3. The target bus is unsupported, not externally reachable, or has no unique
   compatible route/address segment.
4. The resolved address range conflicts with the linked memory map.
5. Simulation export, compilation, elaboration, or a test assertion failed.

Each diagnostic identifies the configuration field, discovered object path, and
link to the relevant tool output when available.

## Delivery sequence and feasibility

1. Define the project configuration, discovery manifest, pure route resolver,
   planner, and visible lifecycle reporting.
2. Add the Vivado discovery integration fixture and generate a plan for an
   external AXI4-Lite route through interconnect and a non-IPCraft neighbour.
3. Deliver the Vivado-exported Questa/Cocotb runner.
4. Deliver the XSim self-checking HDL runner and AXI4-Lite BFM.

The foundation is moderate effort and low conceptual risk because the project
already runs Vivado batch Tcl and has a memory-map verification model. Questa
integration is moderate risk due to vendor-exported source and library
handling. XSim is high effort and higher risk because the HDL BFM and
assertion/test generator are new.

## Verification strategy

- Unit tests cover configuration validation, discovery-manifest parsing, route
  resolution, base-address calculation, and verification-plan construction.
- Captured discovery manifests cover missing paths, ambiguous routes,
  unsupported buses, and unbound third-party IP.
- Generator tests cover runner inputs and emitted source/command artifacts.
- Vivado integration tests recreate a fixture with AXI interconnect or
  SmartConnect, the selected IPCraft target, and a non-IPCraft neighbour.
- Simulator integration tests are separately gated when Vivado or Questa is
  unavailable, consistent with existing vendor-tool testing.

## Future extension

Platform Designer should implement its own recreate, discovery, export, and
simulator integration. It may produce the same `DiscoveredSystem` and consume
the same verification plan, but it is not within version 1. Supporting
additional bound targets and custom tests for unbound IPs follows after the
single-target reset and reporting semantics are proven.
