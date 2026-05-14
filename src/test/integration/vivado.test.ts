/**
 * Vivado integration tests.
 *
 * For each template IP core that produces an xilinx/component.xml, runs Vivado
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
import { generateFixtures, xilinxFixtures, Fixture } from './generator';

const VIVADO_BIN =
  process.env.VIVADO_BIN ?? '/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado';

const VALIDATE_TCL = path.resolve(__dirname, '../../../scripts/integration/vivado/validate.tcl');

const SKIP = process.env.SKIP_VIVADO === '1';

let xilinxes: Fixture[] = [];

beforeAll(async () => {
  const all = await generateFixtures();
  xilinxes = xilinxFixtures(all);
}, 300_000);

it('generates at least one Xilinx fixture with component.xml', () => {
  expect(xilinxes.length).toBeGreaterThan(0);
});

it('all Xilinx fixtures pass Vivado ipx::check_integrity', () => {
  if (SKIP) {
    // eslint-disable-next-line no-console
    console.log('Skipping Vivado validation (SKIP_VIVADO=1)');
    return;
  }

  if (xilinxes.length === 0) {
    throw new Error('No Xilinx fixtures were generated — check generator output');
  }

  const failures: string[] = [];

  for (const fixture of xilinxes) {
    const xilinxDir = path.join(fixture.outputDir, 'xilinx');

    const result = spawnSync(
      VIVADO_BIN,
      ['-mode', 'batch', '-source', VALIDATE_TCL, '-tclargs', xilinxDir],
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
      `Vivado validation failed for ${failures.length} of ${xilinxes.length} fixture(s):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});
