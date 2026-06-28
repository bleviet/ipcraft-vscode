# EDA Integration Tests

## The Problem: Generated Files Must Be Vendor-Valid

IPCraft's generator produces files that are consumed directly by EDA (Electronic Design Automation) tools: Intel Quartus Platform Designer reads `_hw.tcl` scripts; AMD Vivado reads `component.xml` IP-XACT descriptors. These files must not only parse without errors — they must satisfy structural rules enforced by the tool's own validation engine.

Unit tests can verify that the generator *produces output* and that the YAML input maps to expected string patterns. They cannot verify that a generated `_hw.tcl` conforms to Platform Designer's expected schema, or that a generated `component.xml` satisfies the IP-XACT standard as Vivado interprets it.

The EDA integration tests close that gap.

---

## The Sixth Test Tier

The EDA integration tests form a sixth tier in the repository's test architecture, sitting above the five tiers described in the [Testing Guide](../testing.md):

| Tier | Runner | What it tests |
|------|--------|---------------|
| 1–3 | Jest | Pure logic, React components, VS Code API calls |
| 4 | @vscode/test-electron | VS Code extension activation and file resolution |
| 5 | Playwright | Compiled React webview UI in a real browser |
| **6** | **Jest + EDA tools** | **Generated EDA files accepted by the real vendor tools** |

Tier 6 tests are deliberately **not** part of `npm run test:all`. They require external tooling (Docker or a Vivado installation) that is not present in the standard developer or CI environment. They run on demand, or in a dedicated CI job that provisions the required tools.

---

## How the Test Suite Works

### Step 1: Fixture generation

Both the Quartus and Vivado test files share a common setup step implemented in `src/test/integration/generator.ts`. Before any assertions run, `generateFixtures()`:

1. Reads every `*.ip.yml` template from `ipcraft-spec/templates/`.
2. Calls `IpCoreScaffolder.generateAll()` with `vendor: 'both'` and `includeRegs: true`.
3. Writes the output files to a stable directory under `os.tmpdir()` (`ipcraft-integration-fixtures/<name>/`).
4. Caches the result in memory so the generation step runs only once per Jest process, even when multiple test files import it.

The output directory for each fixture mirrors what a real user would get:

```
/tmp/ipcraft-integration-fixtures/
  simple_gpio/
    altera/
      simple_gpio_hw.tcl
      test.qsys            # companion system with all interfaces exported
    amd/
      component.xml
      busdef/
        ...
  axi_lite_slave/
    altera/
      axi_lite_slave_hw.tcl
      test.qsys
    amd/
      component.xml
```

The `alteraFixtures()` and `amdFixtures()` helper functions filter the full list to fixtures that actually produced `_hw.tcl` files (Quartus path) or `component.xml` files (Vivado path), respectively.

### Step 2: Quartus validation

The Quartus tests (`src/test/integration/quartus.test.ts`) validate every fixture that produced a `_hw.tcl`.

#### Why Docker?

Quartus Prime is a multi-gigabyte installation that is rarely present on a developer's laptop and is difficult to install in standard CI. However, Quartus ships `tclsh` — a standard Tcl interpreter — inside its installation. The test suite uses a published Docker image (`cvsoc/quartus:23.1`) that provides exactly that: a Quartus installation accessible as a container, without a GUI or a license.

The Jest test mounts the repository root at `/work` inside the container and passes the generated `_hw.tcl` paths (translated to container-internal paths) to the validation script.

#### What the validation does

There are two levels of validation for each `_hw.tcl`, run in sequence.

**Stub validation** uses a lightweight Tcl-based validator at `scripts/integration/quartus/stub_platform_designer.tcl`. The stub:

1. Defines no-op implementations of all Platform Designer commands (`add_interface`, `add_interface_port`, `set_module_property`, `add_fileset`, etc.) so the `_hw.tcl` can be sourced without a live Platform Designer session.
2. Records every `add_interface` and `add_interface_port` call in an in-memory state object.
3. Intercepts `package require qsys` and returns a fake success so the `_hw.tcl` does not abort on startup.

After the `_hw.tcl` is loaded, the outer validator (`scripts/integration/quartus/validate.tcl`) calls its `elaborate` procedure — and `validate`, if defined — then runs these structural checks:

- At least one interface must be registered.
- `set_module_property NAME` must have been called.
- Every non-clock/reset interface must have at least one port.

The stub validator iterates over all `_hw.tcl` files passed as command-line arguments, accumulates errors, and exits 0 only if every file passes, printing `OVERALL PASS`.

**BFM testbench validation** uses Platform Designer's own `qsys-generate --testbench=STANDARD` tool, driven by `scripts/integration/quartus/validate_pd.sh`. This catches interface-level errors — such as AXI-Stream port role mismatches — that the stub validator cannot detect because the stub only records interface declarations without interpreting their semantics.

The approach relies on a companion `test.qsys` file that IPCraft generates alongside each `_hw.tcl` (via the `altera_test_system.qsys.j2` Nunjucks template in the generator). This file instantiates the component with **all interfaces exported to the system boundary**. With every interface promoted to an export, Platform Designer's system-level validator is fully satisfied — there are no "port must be connected" false positives — and `qsys-generate` can automatically connect BFMs (Bus Functional Models) for each exported clock, reset, Avalon, AXI, and conduit interface. If any interface declaration in the `_hw.tcl` is structurally wrong (wrong port roles, mismatched directions, bad type), `qsys-generate` reports a component-level error.

The script deduplicates validation across VHDL and SV fixture variants of the same IP name, since both produce the identical Platform Designer component structure. It exits with code 0 on full pass, 1 on any component error, and 2 when `qsys-generate` is not found in the image (which the Jest test treats as a tier-2 skip rather than a failure, unless `REQUIRE_QSYS_GENERATE=1` is set).

Both validation levels run inside the same `cvsoc/quartus:23.1` Docker container. Stub validation takes roughly milliseconds per file; BFM testbench validation takes roughly 30 seconds per unique IP component.

### Step 3: Vivado validation

The Vivado tests (`src/test/integration/vivado.test.ts`) validate every fixture that produced a `component.xml`.

#### Why host-installed, not Docker?

Vivado's licensing requirements and the complexity of running its binary inside a container make Dockerisation impractical for this use case. The tests instead assume Vivado is installed on the developer's machine or CI runner and locate the binary via the `VIVADO_BIN` environment variable (defaulting to the path of the developer machine where the tests were originally authored).

#### What the validation does

The test runs Vivado in batch mode (`-mode batch`) with `scripts/integration/vivado/validate.tcl`. For each fixture, the script:

1. Creates an in-memory Vivado project (no disk artefacts) targeting a representative Zynq-7000 part.
2. If a `busdef/` subdirectory exists alongside `component.xml`, registers it as an IP repository and rebuilds the IP catalogue so Vivado can resolve any custom bus interface VLNVs.
3. Calls `ipx::open_core` to parse the `component.xml`.
4. Asserts the VLNV property is non-empty — a non-empty VLNV confirms the file was parsed as a valid IP-XACT document.
5. Calls `ipx::check_integrity -quiet` to run Vivado's built-in integrity check.
6. Exits 0 if the error count is 0; exits 1 otherwise.

Each fixture is validated as a separate `spawnSync` invocation. Failures are collected and reported together so a single bad fixture does not abort validation of the others.

---

## Design Decisions

### Why separate from unit tests?

EDA validation is slow (Vivado can take 30–60 seconds per fixture to start) and requires tools that are not universally available. Bundling them with the unit test suite would make `npm run test:unit` fragile and slow for all contributors. The integration tests are deliberately opt-in.

### Why Tcl stubs instead of a real Platform Designer session?

A real Platform Designer session requires a licensed Quartus installation and a GUI environment. The stub approach lets contributors who only have `tclsh` (available inside the Docker image without a license) validate the structural correctness of `_hw.tcl` files. It is not a full functional test — it does not simulate routing or timing — but it catches the class of errors that IPCraft is likely to introduce: malformed interface definitions, missing module names, invalid interface types, or ports with zero width.

### Why add BFM testbench validation on top of the stub?

The Tcl stub validator only replays and records interface declarations. It cannot catch semantic errors that require Platform Designer to interpret the interface specification — for example, when a port is listed under an AXI-Stream interface with the wrong role (`tstrb` assigned as a master port on what should be a slave interface). Such errors are invisible to a Tcl stub but cause `qsys-generate` to abort with a component-level error.

The BFM testbench approach solves this by running the actual Platform Designer tool against a purpose-built `test.qsys` that exports every interface to the system boundary. The export strategy is the key insight: a bare system with unconnected interfaces would trigger "must be connected" errors that are not real bugs — they are just artifacts of the test harness. Exporting everything to the boundary satisfies Platform Designer's connectivity rules so that only genuine interface errors surface. This makes the test highly specific: false positives from the test setup are eliminated, and only real component defects cause a failure.

### Why cache fixtures in memory?

`generateFixtures()` caches its result so both the Quartus and Vivado test files can import it without triggering two separate generation passes. Generation runs `IpCoreScaffolder.generateAll()` for every template IP core, which is I/O-intensive. The cache is process-scoped: when the two integration test files are run together via `npm run test:integration`, Jest reuses the same worker process and the generation runs only once.

### Skipping individual tools

Setting `SKIP_QUARTUS=1` or `SKIP_VIVADO=1` causes all tests for that tool to pass trivially rather than fail. This is useful in environments where only one EDA tool is available.
