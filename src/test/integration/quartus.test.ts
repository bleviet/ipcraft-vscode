/**
 * Quartus integration tests.
 *
 * For each template IP core that produces a *_hw.tcl, runs the Platform
 * Designer stub validator inside the cvsoc/quartus:23.1 Docker image, calling
 * tclsh on scripts/integration/quartus/validate.tcl.
 *
 * Requires Docker with the cvsoc/quartus:23.1 image pulled. Set
 * SKIP_QUARTUS=1 to skip all tests without failing.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import { generateFixtures, alteraFixtures, hwTclFiles, Fixture, FIXTURE_BASE } from './generator';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCKER_IMAGE = process.env.QUARTUS_DOCKER_IMAGE ?? 'cvsoc/quartus:23.1';
const TCLSH = '/opt/intelFPGA/quartus/bin/tclsh';
const VALIDATE_TCL = '/work/scripts/integration/quartus/validate.tcl';

const SKIP = process.env.SKIP_QUARTUS === '1';

let alteras: Fixture[] = [];

beforeAll(async () => {
  const all = await generateFixtures();
  alteras = alteraFixtures(all);
}, 300_000);

it('generates at least one Altera fixture with _hw.tcl', () => {
  expect(alteras.length).toBeGreaterThan(0);
});

it('all Altera _hw.tcl files pass Platform Designer stub validation', () => {
  if (SKIP) {
    console.log('Skipping Quartus validation (SKIP_QUARTUS=1)');
    return;
  }

  if (alteras.length === 0) {
    throw new Error('No Altera fixtures were generated — check generator output');
  }

  // Collect all hw.tcl paths, mapped to their fixture name for reporting
  const hwTclEntries: Array<{ fixture: string; tcl: string }> = [];
  for (const fixture of alteras) {
    for (const tcl of hwTclFiles(fixture)) {
      // Path inside the container — replace host prefix with /work mount
      const tclInContainer = tcl.replace(REPO_ROOT, '/work');
      hwTclEntries.push({ fixture: fixture.name, tcl: tclInContainer });
    }
  }

  if (hwTclEntries.length === 0) {
    throw new Error('Altera fixtures exist but hwTclFiles() returned nothing');
  }

  const tclPaths = hwTclEntries.map((e) => e.tcl);

  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      `${process.getuid!()}:${process.getgid!()}`,
      '-v',
      `${REPO_ROOT}:/work`,
      // Mount the tmp fixture output dir as well (same path inside container)
      '-v',
      `${FIXTURE_BASE}:${FIXTURE_BASE}`,
      DOCKER_IMAGE,
      TCLSH,
      VALIDATE_TCL,
      ...tclPaths,
    ],
    { encoding: 'utf8', timeout: 120_000 }
  );

  if (result.error) {
    throw new Error(`Failed to spawn Docker — ${result.error.message}`);
  }

  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const passed = result.status === 0 && output.includes('OVERALL PASS');

  if (!passed) {
    throw new Error(
      [
        `Quartus hw.tcl validation FAILED (exit ${result.status})`,
        `stdout:\n${result.stdout}`,
        `stderr:\n${result.stderr}`,
      ].join('\n')
    );
  }

  console.log(`  PASS: ${hwTclEntries.length} hw.tcl file(s) validated`);
});
