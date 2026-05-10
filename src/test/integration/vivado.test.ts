/**
 * Vivado integration tests.
 *
 * For each template IP core that produces an amd/component.xml, runs Vivado
 * in batch mode with scripts/integration/vivado/validate.tcl and asserts that
 * ipx::check_integrity reports 0 errors.
 *
 * Requires Vivado to be installed on the host. Set VIVADO_BIN to override the
 * default path (/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado).
 *
 * Skip all tests by setting SKIP_VIVADO=1.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import { generateFixtures, amdFixtures, Fixture } from './generator';

const VIVADO_BIN =
  process.env.VIVADO_BIN ?? '/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado';

const VALIDATE_TCL = path.resolve(__dirname, '../../../scripts/integration/vivado/validate.tcl');

const SKIP = process.env.SKIP_VIVADO === '1';

let amds: Fixture[] = [];

beforeAll(async () => {
  const all = await generateFixtures();
  amds = amdFixtures(all);
}, 300_000);

it('generates at least one AMD fixture with component.xml', () => {
  expect(amds.length).toBeGreaterThan(0);
});

it('all AMD fixtures pass Vivado ipx::check_integrity', () => {
  if (SKIP) {
    // eslint-disable-next-line no-console
    console.log('Skipping Vivado validation (SKIP_VIVADO=1)');
    return;
  }

  if (amds.length === 0) {
    throw new Error('No AMD fixtures were generated — check generator output');
  }

  const failures: string[] = [];

  for (const fixture of amds) {
    const amdDir = path.join(fixture.outputDir, 'amd');

    const result = spawnSync(
      VIVADO_BIN,
      ['-mode', 'batch', '-source', VALIDATE_TCL, '-tclargs', amdDir],
      { encoding: 'utf8', timeout: 120_000 }
    );

    if (result.error) {
      failures.push(`${fixture.name}: failed to spawn Vivado — ${result.error.message}`);
      continue;
    }

    // validate.tcl exits 0 on success; it also prints "PASS: <vlnv>"
    const passed = result.status === 0;
    if (passed) {
      // eslint-disable-next-line no-console
      console.log(`  PASS: ${fixture.name}`);
    } else {
      failures.push(
        [
          `${fixture.name}: FAIL (exit ${result.status})`,
          `stdout:\n${result.stdout}`,
          `stderr:\n${result.stderr}`,
        ].join('\n')
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Vivado validation failed for ${failures.length} of ${amds.length} fixture(s):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});
