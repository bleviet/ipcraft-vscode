# Polarity-Aware Cocotb Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated Avalon-MM cocotb tests use final physical port names and effective polarity.

**Architecture:** `CocotbFramework` projects primary `bus_ports` metadata into a narrow transport-only render context. `cocotb_test.py.j2` consumes that context while leaving the manifest-driven scoreboard and transaction API unchanged.

**Tech Stack:** TypeScript, Jest with `config/jest.config.js`, Nunjucks, Python cocotb, GHDL, Icarus Verilog.

## Completion status

All six implementation steps are complete. The focused framework suite, full
unit and browser suites, type-check, compile, lint, snapshots, and the exact
open-source HDL integration command pass locally. The GitHub `hdl-integration`
check remains the post-push merge gate.

## Global Constraints

- Preserve the existing `AvalonTransport.write` and `AvalonTransport.read` API.
- Preserve register-model semantics, transaction ordering, and wait timing.
- Use camelCase in TypeScript and snake_case only at the Nunjucks context boundary.
- Add the regression before production changes and verify the expected failure.
- Do not weaken or skip the HDL integration gate.

---

### Task 1: Project polarity-aware Avalon transport signals

**Files:**
- Modify: `src/generator/testbench/frameworks/CocotbFramework.ts`
- Modify: `src/generator/templates/cocotb_test.py.j2`
- Test: `src/test/suite/generator/testbench/CocotbFramework.test.ts`

**Interfaces:**
- Consumes: `templateContext.bus_ports` entries containing `logical_name`, `name`, and optional `effective_polarity`.
- Produces: template-only `avmm_signals` entries containing `name`, `asserted`, and `deasserted` values.

- [x] **Step 1: Write the failing generated-output test**

  Render an AVMM testbench whose canonical `read`, `write`, `waitrequest`,
  `readdatavalid`, and `byteenable` entries use active-low physical names. Assert
  the Python resolves those names, drives command assertion as zero, waits for
  handshake assertion as zero, and complements the byte-enable mask.

- [x] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  npx jest --config config/jest.config.js src/test/suite/generator/testbench/CocotbFramework.test.ts --runInBand
  ```

  Expected: FAIL because the template still emits `dut.avs_read` and other
  canonical active-high references.

- [x] **Step 3: Add the transport-only projection**

  Build a lookup over `templateContext.bus_ports`, resolve final physical names
  with `bus_prefix` fallbacks, and compute asserted/deasserted values from
  `effective_polarity`. Pass it only to cocotb test rendering.

- [x] **Step 4: Render through resolved handles and levels**

  Resolve Avalon handles in `__init__`, drive `read`/`write` through their
  asserted levels, compare handshakes against their asserted levels, and invert
  active-low byte-enable masks within `_FULL_BYTE_ENABLE`.

- [x] **Step 5: Run focused tests and verify GREEN**

  Run the Step 2 command. Expected: PASS with the new regression and all
  existing CocotbFramework tests.

- [x] **Step 6: Run repository gates**

  Run `npm run lint`, `npm run type-check`, `npm test -- --runInBand`, and the
  HDL integration suite where cocotb is available. Push only after local gates
  pass. Treat the GitHub `hdl-integration` check as the post-push merge gate.
