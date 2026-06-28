# Run the EDA Integration Tests

The EDA integration tests validate that IPCraft-generated files are accepted by the real vendor tools — Intel Quartus Platform Designer and AMD Vivado. Run these tests after changing the code generator, modifying Nunjucks templates, or updating the IP-XACT / Platform Designer output format.

For background on why these tests exist and how they work, see [EDA Integration Tests](../concepts/eda-integration-tests.md).

---

## Prerequisites

### For Quartus tests

- **Docker** installed and running on your machine.
- The `cvsoc/quartus:23.1` image pulled locally:
  ```bash
  docker pull cvsoc/quartus:23.1
  ```

### For Vivado tests

- **Vivado** installed on your machine (2024.x recommended).
- The default binary path assumed by the tests is:
  ```
  /home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado
  ```
  If your Vivado is installed elsewhere, set `VIVADO_BIN` before running:
  ```bash
  export VIVADO_BIN=/path/to/Xilinx/Vivado/<version>/bin/vivado
  ```

### Common prerequisites

- Node.js 20+ with all npm dependencies installed:
  ```bash
  npm install
  ```
- A compiled extension build (the generator loads Nunjucks templates from `dist/`):
  ```bash
  npm run compile
  ```

---

## Running the Tests

### Quartus only

```bash
npm run test:integration:quartus
```

### Vivado only

```bash
npm run test:integration:vivado
```

### Both suites together

```bash
npm run test:integration
```

---

## Skipping a Tool You Don't Have

If only one EDA tool is available, skip the other to avoid an unnecessary failure:

```bash
SKIP_VIVADO=1 npm run test:integration       # Run Quartus tests only
SKIP_QUARTUS=1 npm run test:integration      # Run Vivado tests only
```

Setting `SKIP_QUARTUS=1` or `SKIP_VIVADO=1` causes the corresponding tests to pass trivially rather than fail.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `QUARTUS_DOCKER_IMAGE` | `cvsoc/quartus:23.1` | Docker image containing the Quartus Tcl interpreter |
| `VIVADO_BIN` | `/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado` | Full path to the `vivado` binary |
| `SKIP_QUARTUS` | *(unset)* | Set to `1` to skip all Quartus tests without failing |
| `SKIP_VIVADO` | *(unset)* | Set to `1` to skip all Vivado tests without failing |
| `REQUIRE_QSYS_GENERATE` | *(unset)* | Set to `1` to fail (instead of skip) when `qsys-generate` is absent from the Docker image |

---

## Understanding the Output

### Passing run

```
 PASS  src/test/integration/quartus.test.ts (45.2 s)
   ✓ generates at least one Altera fixture with _hw.tcl (8192 ms)
   ✓ all Altera _hw.tcl files pass Platform Designer stub validation (36109 ms)
     PASS: 3 hw.tcl file(s) validated
   ✓ all Altera _hw.tcl files pass Platform Designer BFM testbench validation (120034 ms)
     PASS: 3 hw.tcl file(s) validated via BFM testbench

 PASS  src/test/integration/vivado.test.ts (78.1 s)
   ✓ generates at least one AMD fixture with component.xml (8212 ms)
   ✓ all AMD fixtures pass Vivado ipx::check_integrity (69731 ms)
     PASS: simple_gpio
     PASS: axi_lite_slave
```

### Failing run (Quartus — stub validation)

When a `_hw.tcl` file contains a structural error, the stub validator prints the Tcl output and the specific check that failed:

```
● all Altera _hw.tcl files pass Platform Designer stub validation

  Quartus hw.tcl validation FAILED (exit 1)
  stdout:
  === Validating: simple_gpio_hw.tcl ===
  ...
  PD-ERROR: add_interface 'data_in': unknown type 'avalon_lite'
  ...
  OVERALL FAIL: 1 error(s) across all files
```

### Failing run (Quartus — BFM testbench validation)

When a `_hw.tcl` has an interface-level error that only Platform Designer's full validator can catch (such as an AXI-Stream port role mismatch), the BFM testbench test reports it:

```
● all Altera _hw.tcl files pass Platform Designer BFM testbench validation

  Platform Designer qsys-generate validation FAILED (exit 1)
  stdout:
  ======================================================
  === Validating via Platform Designer BFM testbench: comprehensive_axi_hw.tcl
  ======================================================
  Found IP component name: comprehensive_axi
  2026.06.28.23:29:05 Error: Master axi_stream port role mismatch: tstrb
  FAIL: comprehensive_axi has component-level errors:
  2026.06.28.23:29:05 Error: Master axi_stream port role mismatch: tstrb
  ...
  OVERALL FAIL: 1 error(s) across all files
```

### Skipped BFM testbench validation

When `qsys-generate` is not present in the Docker image, the BFM testbench test is skipped rather than failed (unless `REQUIRE_QSYS_GENERATE=1` is set):

```
[tier 2] SKIPPING qsys_generate: qsys-generate not available in cvsoc/quartus:23.1.
  Set REQUIRE_QSYS_GENERATE=1 to fail instead of skipping.
```

### Failing run (Vivado)

When a `component.xml` fails Vivado's integrity check, the full Vivado log is included:

```
● all AMD fixtures pass Vivado ipx::check_integrity

  Vivado validation failed for 1 of 2 fixture(s):

  axi_lite_slave: FAIL (exit 1)
  stdout:
  === Vivado Component Validation ===
  ...
  Errors   : 2
  FAIL: vendor:lib:axi_lite_slave:1.0 — 2 error(s) detected
```

---

## Troubleshooting

### "Failed to spawn Docker"

The Docker daemon is not running or Docker is not installed. Start the daemon and verify:
```bash
docker info
```

### "No Altera fixtures were generated"

The generator failed before producing any `_hw.tcl` files. Run the generator unit tests first to confirm the pipeline is healthy:
```bash
npm run test:unit -- --testPathPattern=src/test/suite/generator
```

Also confirm the extension is compiled — the generator loads Nunjucks templates from `dist/templates/`:
```bash
npm run compile
```

### "No AMD fixtures were generated"

Same as above but for AMD/Vivado output. The same commands apply.

### "Failed to spawn Vivado"

Check that `VIVADO_BIN` points to a valid binary and that Vivado can start:
```bash
$VIVADO_BIN -version
```

If the variable is not set, the default path is used. Make sure it matches your installation.

### Tests time out

Vivado can take 30–60 seconds to start per fixture; the Quartus Docker container incurs a similar startup cost. The integration Jest config sets a 3-minute timeout per test (covering all fixtures in one assertion). If your machine is particularly slow, increase it:
```bash
npx jest --config config/jest.integration.js --testTimeout 300000
```

### Stale fixture output

Fixtures are regenerated fresh on every Jest run. If you suspect a caching issue (for example, after moving template files), delete the temporary directory manually:
```bash
rm -rf /tmp/ipcraft-integration-fixtures
```
