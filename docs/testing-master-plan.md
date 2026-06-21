# IPCraft Master Test Plan

## Goal

Deliver a testing infrastructure that gives us **high confidence** in every release:

1. Generated HDL (VHDL + SystemVerilog) synthesizes cleanly in both **Vivado** and **Quartus** for every bus interface, every fixture, every corner case.
2. Every parser (importer) produces a valid `.ip.yml` that, when fed back to the generator, produces correct output.
3. The webview UI (Memory Map + IP Core) handles all user interactions correctly: keyboard navigation, insert/delete, drag-reorder, undo/redo, format-preserving writes.
4. CI runs the full matrix automatically -- no manual vendor-tool runs required.

---

## Current State (as of June 2026)

| Layer | What exists | Coverage |
|---|---|---|
| Unit (Jest, tiers 1-3) | 97 test files across algorithms, components, generator, hooks, parser, services, utils, webview, yamledit | Moderate. 25% statement coverage (by design -- React code unreachable by Jest). |
| VS Code smoke (test-electron, tier 4) | 5 tests: extension present, activates, registers editors, opens .mm.yml, opens .ip.yml | Thin. Activation and file-open only. |
| Playwright browser (tier 5) | 4 tests: render + edit + postMessage, insert-below via context menu, IP Core canvas render, VLNV header display | Thin. No keyboard nav, no delete, no undo, no field editor, no address block table. |
| HDL integration (tier 1) | GHDL analyze/elaborate/synthesize (VHDL), iverilog compile (SV), Verilator lint (SV) | Good for open-source tools. |
| Vivado integration (tier 2) | ipx::check_integrity on all Xilinx fixtures; project creation for all; OOC synthesis for minimal_vhdl + minimal_sv only | Partial. Synthesis only on 2 of ~14 fixtures. |
| Quartus integration (tier 2) | hw.tcl stub validation (all Altera fixtures); project creation (all) | Partial. No actual synthesis/fit. |
| IP-XACT (tier 1) | xmllint well-formedness, SPIRIT namespace, VLNV elements, validate.sh | Good structural validation. |
| Snapshot / roundtrip (tier 0) | Golden-file snapshots for component.xml + hw.tcl; generate-then-parse round-trip | Good. |
| Conformance (tier 0) | Pack apiVersion check, contract validation, third-party pack harness | Good. |
| CI | `ci.yml` (push/PR): lint, type-check, unit, smoke, browser. `vivado-nightly.yml`: tier 0 + tier 1 only. | **Vivado and Quartus never run in CI.** |

### Known gaps

- **VerilogParser has no test.** The only parser out of 5 without a `.test.ts`.
- **Synthesis matrix is too narrow.** Only `minimal_vhdl` and `minimal_sv` get OOC synthesis in Vivado. Quartus has no synthesis at all.
- **No cocotb testbench execution.** The generator produces `tb/` with Python test files and a Makefile, but they are never run.
- **Playwright coverage is 4 tests.** Keyboard navigation, field editor, address block table, undo/redo, drag-reorder, format-preserving round-trip -- all untested.
- **No parser round-trip pipeline.** Import from VHDL/Verilog/component.xml/hw.tcl into `.ip.yml`, then generate, then validate -- this end-to-end loop does not exist as an automated test.
- **Vivado and Quartus are absent from CI.** Tier 2 tests self-skip with a warning. No self-hosted runner or Jenkins.

---

## Phased Plan

### Phase 1: Close the obvious unit-test gaps

**Scope:** Fast wins. No infrastructure changes.

| Task | Deliverable | Effort |
|---|---|---|
| Add `VerilogParser.test.ts` | Test file covering all import paths: module declarations, port directions, parameter extraction, bus interface inference. Mirror structure of `VhdlParser.test.ts`. | Small |
| Add `ReportParser.test.ts` | Test file for `src/services/ReportParser.ts` (currently untested). | Small |
| Expand `yamledit.test.ts` | Add cases for: hex spelling preservation, comment preservation, multi-path batch edits, delete-then-insert, nested array edits. The format-preserving write path is a critical correctness surface. | Medium |
| Add corner-case fixtures | Create `src/test/fixtures/` YAML files for: register arrays with strides, mixed access modes (RO/WO/RW/W1C), address gaps between blocks, parameters with arithmetic expressions, wide fields (>32 bit), single-bit fields, fields spanning full register width. | Medium |

**Exit criteria:** All 5 parsers have tests. Yamledit has >30 test cases. Corner-case fixtures exist and are consumed by unit tests.

---

### Phase 2: Generator synthesis matrix expansion

**Scope:** Every bus interface, both HDLs, both vendors must synthesize. Not just minimal fixtures.

#### 2a. Expand Vivado OOC synthesis targets

Currently `vivado.test.ts` only synthesizes `minimal_vhdl` and `minimal_sv`. Expand to cover every distinct bus interface:

| Fixture | Bus interface | Why it matters |
|---|---|---|
| `axi_slave_vhdl` / `axi_slave_sv` | AXI4-Lite | Most common bus protocol |
| `comprehensive_axi_vhdl` / `comprehensive_axi_sv` | AXI4-Lite (full feature set) | All register types, field access modes |
| `avalon_peripheral_vhdl` / `avalon_peripheral_sv` | Avalon-MM | Altera/Intel bus, tests cross-vendor |
| `basic_peripheral_vhdl` / `basic_peripheral_sv` | Simple peripheral | Baseline |
| `multi_interface_accelerator_vhdl` / `multi_interface_accelerator_sv` | Multiple bus interfaces | Tests multi-interface generation |

**Implementation:** Add a `synthesisTargets` array in `vivado.test.ts` that lists all fixtures that must pass OOC synthesis. The test iterates over this list and fails if any fixture is missing from the generated set.

#### 2b. Add Quartus synthesis/fit tests

Currently Quartus only validates `_hw.tcl` stubs and project creation. Add a test that runs actual Quartus compilation inside the `cvsoc/quartus:23.1` Docker container:

```
quartus_sh --flow compile <project_name>
```

This requires:
- A new Tcl script: `scripts/integration/quartus/run_compile.tcl` that opens the generated project, runs Analysis & Synthesis, Fitter, and Assembler.
- A new test in `quartus.test.ts`: `it('representative Quartus projects compile successfully')` that runs the compile flow on representative fixtures.
- The Docker container must have write access to the fixture output directory.

#### 2c. Cross-vendor consistency test

Add a test that verifies: for a given `.ip.yml`, the Vivado `component.xml` and the Quartus `_hw.tcl` declare the **same** set of bus interfaces, ports, and parameters. This is a pure-Node test (tier 0) that parses both generated files and compares their structural content.

**Exit criteria:** Every bus interface type (AXI4-Lite, AXI4, Avalon-MM, custom) synthesizes in both Vivado and Quartus. Cross-vendor structural consistency is verified.

---

### Phase 3: Parser round-trip pipeline

**Scope:** Automated end-to-end test for every importer.

The pipeline for each parser:

```
External source (VHDL/Verilog/component.xml/hw.tcl)
    --> Parser --> .ip.yml
    --> Generator --> HDL + component.xml + hw.tcl
    --> Validator (Vivado/Quartus/GHDL/iverilog)
```

| Parser | Source format | Round-trip test |
|---|---|---|
| `ComponentXmlParser` | Vivado `component.xml` | Parse an existing component.xml, generate a new one, diff the structural content |
| `HwTclParser` | Quartus `_hw.tcl` | Parse an existing hw.tcl, generate a new one, validate via stub Platform Designer |
| `VhdlParser` | VHDL entity + architecture | Parse a generated VHDL file, re-generate, compile with GHDL |
| `VerilogParser` | Verilog/SystemVerilog module | Parse a generated SV file, re-generate, compile with iverilog |
| `VivadoInterfaceXmlParser` | Vivado interface XML | Parse, re-generate, validate structure |

**Implementation:** New integration test file `src/test/integration/parser-roundtrip.test.ts`. For each parser:
1. Start from a known-good generated fixture (the output of `generateFixtures()`).
2. Parse the generated file back into a `.ip.yml` domain object.
3. Feed the parsed object back through `IpCoreScaffolder.generateAll`.
4. Diff the two generated outputs structurally (not byte-for-byte -- formatting may differ).
5. Optionally: run the second-generation output through the HDL/vendor validators.

**Exit criteria:** Every parser has an automated round-trip test. Structural equivalence between first and second generation is verified.

---

### Phase 4: Local Jenkins + Docker for vendor tools

**Scope:** Self-hosted CI that runs Vivado and Quartus on every PR.

#### 4a. Jenkins setup

A local Jenkins instance running in Docker, with two agent types:

| Agent | Tools | Purpose |
|---|---|---|
| `ipcraft-oss` | Node.js 20, GHDL, iverilog, Verilator, xmllint, Docker | Open-source tier 0 + tier 1 tests |
| `ipcraft-vendor` | Node.js 20, Vivado 2024.2 (host install with license), Docker (for Quartus image) | Tier 2 vendor tests |

**Jenkinsfile structure:**

Toolchain versions and Docker images are passed as **Jenkins parameters** so the
pipeline can be re-run against different versions without editing the Jenkinsfile.

```groovy
pipeline {
    agent none
    parameters {
        string(name: 'VIVADO_BIN',
               defaultValue: '/tools/Xilinx/Vivado/2024.2/bin/vivado',
               description: 'Path to Vivado binary on the vendor agent')
        string(name: 'VIVADO_VERSION',
               defaultValue: '2024.2',
               description: 'Vivado version (for reporting)')
        string(name: 'QUARTUS_DOCKER_IMAGE',
               defaultValue: 'cvsoc/quartus:23.1',
               description: 'Docker image for Quartus tests')
        string(name: 'QUARTUS_VERSION',
               defaultValue: '23.1',
               description: 'Quartus version (for reporting)')
        string(name: 'VIVADO_LICENSE_SERVER',
               defaultValue: '',
               description: 'FlexLM license server (e.g., 2100@host)')
    }
    stages {
        stage('Quick checks') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npm ci'
                sh 'npm run lint'
                sh 'npm run type-check'
                sh 'npm run test:unit -- --coverage'
            }
        }
        stage('HDL integration') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npm run test:integration:hdl'
                sh 'npm run test:integration:ipxact'
                sh 'npm run test:integration:conformance'
            }
        }
        stage('Vendor synthesis') {
            agent { label 'ipcraft-vendor' }
            environment {
                VIVADO_BIN             = "${params.VIVADO_BIN}"
                VIVADO_VERSION         = "${params.VIVADO_VERSION}"
                QUARTUS_DOCKER_IMAGE   = "${params.QUARTUS_DOCKER_IMAGE}"
                QUARTUS_VERSION        = "${params.QUARTUS_VERSION}"
                VIVADO_LICENSE_SERVER  = "${params.VIVADO_LICENSE_SERVER}"
            }
            steps {
                sh 'REQUIRE_VIVADO=1 npm run test:integration:vivado'
                sh 'REQUIRE_QUARTUS=1 npm run test:integration:quartus'
            }
        }
        stage('Browser + E2E') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npm run compile && npm run compile-tests'
                sh 'xvfb-run -a npm run test:e2e'
                sh 'npm run test:browser'
            }
        }
    }
}
```

#### 4b. Configurable toolchain versions and Docker images

All Docker image names and toolchain versions are **configurable via environment variables**, not hardcoded. This allows the same test suite to run on different machines with different tool installations.

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `QUARTUS_DOCKER_IMAGE` | `cvsoc/quartus:23.1` | Docker image for Quartus validation and synthesis |
| `VIVADO_BIN` | `/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado` | Path to Vivado binary (host install or Docker-mounted) |
| `VIVADO_VERSION` | `2024.2` | Vivado version string (used for reporting and version-specific workarounds) |
| `QUARTUS_VERSION` | `23.1` | Quartus version string (used for reporting) |
| `VIVADO_LICENSE_SERVER` | _(unset)_ | FlexLM license server URL (e.g., `2100@license.example.com`) |
| `OSS_DOCKER_IMAGE` | _(none -- runs on host)_ | Optional Docker image for open-source tools (GHDL, iverilog, Verilator) |

**Version matrix testing:**

To test against multiple toolchain versions, run the integration suite in a matrix:

```bash
# Vivado 2023.2
VIVADO_BIN=/tools/Xilinx/Vivado/2023.2/bin/vivado \
VIVADO_VERSION=2023.2 \
npm run test:integration:vivado

# Vivado 2024.2 (default)
VIVADO_BIN=/tools/Xilinx/Vivado/2024.2/bin/vivado \
VIVADO_VERSION=2024.2 \
npm run test:integration:vivado

# Quartus 22.1
QUARTUS_DOCKER_IMAGE=cvsoc/quartus:22.1 \
QUARTUS_VERSION=22.1 \
npm run test:integration:quartus

# Quartus 24.1
QUARTUS_DOCKER_IMAGE=myregistry/quartus:24.1 \
QUARTUS_VERSION=24.1 \
npm run test:integration:quartus
```

The Jenkins pipeline (or GitHub Actions matrix) can parameterize these env vars to run the full version matrix nightly or on tag releases.

**Docker image requirements:**

The Quartus Docker image must provide:
- `tclsh` at a known path (currently `/opt/intelFPGA/quartus/bin/tclsh`)
- `quartus_sh` for project creation tests
- `quartus_map`, `quartus_fit`, `quartus_asm` for full compilation (Phase 2b)

The Vivado setup can be either:
- **Host install:** Vivado installed directly on the CI agent machine, `VIVADO_BIN` points to the binary.
- **Docker container:** Vivado in a Docker image with the license server configured. The test spawns `docker run` with the image name from `VIVADO_DOCKER_IMAGE` (optional, not yet implemented -- host install is simpler for licensed tools).

**No hardcoded image names in test code.** The existing `quartus.test.ts` and `vivado.test.ts` already read from env vars with defaults. All new tests must follow this pattern.

#### 4c. GitHub Actions bridge

The existing `ci.yml` continues to run on `ubuntu-latest` for fast feedback (lint, unit, browser). The Jenkins pipeline runs the full vendor matrix on PRs and pushes status back to GitHub via the [Jenkins GitHub plugin](https://plugins.jenkins.io/github/).

Alternatively, a **GitHub Actions self-hosted runner** on the vendor-tools machine could replace Jenkins entirely. This is simpler if only one machine has Vivado.

**Decision:** Local Jenkins + Docker for vendor tool CI (dedicated Vivado machine available).

**Exit criteria:** Every PR triggers Vivado OOC synthesis (all target fixtures) and Quartus compile (all target fixtures). Results visible as PR check status. Toolchain versions are configurable via env vars, not hardcoded.

---

### Phase 5: cocotb testbench execution

**Scope:** Run the generated Python testbenches, not just check they exist.

The generator already produces `tb/` with:
- `conftest.py` -- pytest fixtures
- `*_test.py` -- cocotb register access tests
- `*_sim.py` -- simulation-level tests
- `Makefile` -- GHDL/iverilog simulation driver

**Implementation:**

1. Add a new integration test: `src/test/integration/testbench.test.ts`
2. For each fixture that has `tb/Makefile`:
   - Run `make -C <fixture>/tb SIM=ghdl` (for VHDL fixtures)
   - Run `make -C <fixture>/tb SIM=icarus` (for SV fixtures)
3. Assert exit code 0 and parse cocotb output for PASS/FAIL counts.

**Prerequisites:** GHDL and iverilog are already installed in CI. cocotb is a Python package -- add `pip install cocotb` to the CI setup or the Docker image.

**Exit criteria:** Every generated testbench runs to completion. Register read/write tests pass against the generated RTL.

---

### Phase 6: Comprehensive Playwright UI coverage

**Scope:** All user interactions in both Memory Map and IP Core editors.

#### 6a. Memory Map editor interactions

| Interaction | Test scenario |
|---|---|
| Keyboard insert (register) | Press `o` below a register, verify new register appears and is selected |
| Keyboard insert (above) | Press `O` above a register, verify new register appears above |
| Keyboard insert (field) | `Shift+A` to add field, verify field row appears in fields table |
| Keyboard delete | Select a register, press `dd`, verify it disappears |
| Keyboard edit | Press `e` on a register name, type new name, press Enter, verify update |
| Arrow navigation | Arrow keys move selection through registers and fields |
| Drag reorder | Drag a register to a new position, verify order changes |
| Context menu | Right-click register, "Insert Below", verify behavior matches keyboard |
| Undo/redo | Edit a value, Ctrl+Z, verify revert. Ctrl+Shift+Z, verify re-apply. |
| Address block insert/delete | Add/remove address blocks via the block editor |
| Format-preserving write | Edit a register name, save, re-read YAML, verify comments and hex spellings are preserved |

#### 6b. IP Core editor interactions

| Interaction | Test scenario |
|---|---|
| Add bus interface | Click "Add Interface", select AXI4-Lite, verify it appears on canvas |
| Remove bus interface | Select an interface, delete, verify removal |
| Edit VLNV | Change vendor/library/name/version fields, verify canvas updates |
| Parameter editing | Add/edit/remove parameters in the parameters panel |
| Canvas layout | Drag nodes on the canvas, verify positions persist |
| Map conduit to bus | Use the conduit mapping dialog, verify mapping is applied |

#### 6c. Cross-cutting UI tests

| Scenario | What it validates |
|---|---|
| YAML round-trip through editor | Inject YAML, make edits via UI, capture outbound postMessage, parse back, verify structural correctness |
| Large fixture rendering | Load a fixture with 50+ registers, verify no rendering glitches or performance issues |
| Error handling | Inject malformed YAML, verify error state is displayed gracefully |
| Theme switching | Toggle VS Code theme, verify colors adapt |

**Exit criteria:** Every keyboard shortcut, mouse interaction, and cross-cutting scenario has a Playwright test. The test count goes from 4 to 30+.

---

### Phase 7: Snapshot regression management

**Scope:** Make golden-file snapshots a reliable regression detector.

Currently `snapshots.test.ts` captures file lists and full text of `component.xml` and `_hw.tcl`. This is good but needs:

| Task | Deliverable |
|---|---|
| Snapshot update workflow | Document how to update snapshots when generator changes are intentional (`jest -u`). |
| Diff-friendly snapshots | Consider splitting component.xml snapshots into structural sections (ports, bus interfaces, parameters) so diffs are readable. |
| Snapshot CI artifact | Upload `__snapshots__/` as a CI artifact on failure so reviewers can diff without checking out the branch. |
| Snapshot coverage | Add snapshots for: generated VHDL pkg file, generated SV pkg file, generated testbench Makefile, generated project Tcl scripts. |

**Exit criteria:** Every generated file type has a snapshot. Snapshot diffs are part of PR review.

---

### Phase 8: CI hardening and monitoring

**Scope:** Make the CI pipeline robust and observable.

| Task | Deliverable |
|---|---|
| Skip telemetry dashboard | Parse `skip-telemetry.ndjson` and produce a visible coverage-gap report (which tools were absent, which tests were skipped). |
| Flaky test detection | Add `jest-circus` retry-on-failure (max 2 retries) for integration tests that depend on external tools with timing variability. |
| Test duration tracking | Log per-test durations and flag tests that take >60s for optimization. |
| Coverage growth targets | Raise Jest coverage thresholds incrementally: statements 25% -> 35%, branches 18% -> 25%, functions 19% -> 28% over 6 months. |
| Playwright coverage report | Integrate `@playwright/test` coverage reporting to measure which React components are exercised. |
| Mutation testing (optional) | Evaluate Stryker Mutator for the `src/domain/` and `src/generator/` modules. |

---

## Priority Order

Recommended execution order, based on risk and effort:

| Priority | Phase | Rationale |
|---|---|---|
| **P0** | Phase 1 (unit gaps) | Low effort, high value. VerilogParser and yamledit gaps are real bugs waiting to happen. |
| **P0** | Phase 2a (Vivado synthesis matrix) | Expanding synthesis from 2 to ~10 fixtures catches bus-interface-specific generator bugs. |
| **P1** | Phase 4 (Jenkins / self-hosted runner) | Without this, vendor tests never run in CI. The entire tier 2 suite is currently unvalidated. |
| **P1** | Phase 2b (Quartus synthesis) | Quartus has zero synthesis testing today. |
| **P2** | Phase 6 (Playwright expansion) | 4 tests is not enough for a complex UI. But UI bugs are less severe than synthesis bugs. |
| **P2** | Phase 5 (cocotb execution) | Validates the generated testbenches actually work. Important for user trust. |
| **P3** | Phase 3 (parser round-trip) | End-to-end importer validation. Important but lower risk than synthesis. |
| **P3** | Phase 7 (snapshot management) | Improves developer workflow, not correctness. |
| **P4** | Phase 8 (CI hardening) | Polish. Do after the core pipeline is solid. |

---

## Estimated Effort

| Phase | Estimated effort | Dependencies |
|---|---|---|
| Phase 1 | 2-3 days | None |
| Phase 2a | 1-2 days | Vivado available (manual or CI) |
| Phase 2b | 2-3 days | Quartus Docker image with full toolchain |
| Phase 2c | 1 day | None |
| Phase 3 | 3-5 days | Phase 1 (parsers tested individually first) |
| Phase 4 | 3-5 days | Machine with Vivado license, Docker |
| Phase 5 | 2-3 days | cocotb installed in CI |
| Phase 6 | 5-7 days | None (can parallelize with other phases) |
| Phase 7 | 1-2 days | None |
| Phase 8 | 2-3 days | Phases 1-7 mostly complete |
| **Total** | **~22-34 days** | |

---

## Decisions Made

1. **CI platform:** Local Jenkins + Docker. A dedicated machine with Vivado 2024.2 installed will serve as the `ipcraft-vendor` Jenkins agent. Docker orchestrates the open-source tool agent.

2. **Starting phase:** Phase 1 (unit test gaps) -- VerilogParser, yamledit expansion, corner-case fixtures.

3. **Vivado availability:** Dedicated machine with Vivado installed and a valid license. Can serve as a CI agent directly.

4. **Fixture location:** New corner-case fixtures go in `src/test/fixtures/` (private to this repo, not in the public ipcraft-spec submodule).

5. **Playwright test count target:** 30-40 tests covering all keyboard shortcuts, mouse interactions, and cross-cutting scenarios.

---

## Success Criteria

The testing infrastructure is "done" when:

- [ ] Every bus interface type synthesizes in both Vivado and Quartus (automated, on every PR).
- [ ] Every parser has a round-trip test that verifies structural equivalence after import-generate-import cycle.
- [ ] Generated cocotb testbenches run and pass against the generated RTL.
- [ ] Playwright tests cover all keyboard shortcuts, mouse interactions, and cross-cutting UI scenarios.
- [ ] CI runs the full matrix (unit + HDL + vendor + browser) with results visible on every PR.
- [ ] Snapshot regressions are caught and reviewed before merge.
- [ ] Coverage thresholds are raised and enforced.
