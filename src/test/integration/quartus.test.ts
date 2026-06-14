/**
 * Quartus integration tests.
 *
 * For each template IP core that produces a *_hw.tcl, runs the Platform
 * Designer stub validator inside the cvsoc/quartus:23.1 Docker image, calling
 * tclsh on scripts/integration/quartus/validate.tcl.
 *
 * Requires Docker with the cvsoc/quartus:23.1 image pulled.
 *
 * The Quartus-dependent tests self-skip when Docker or the image is not
 * available, so `npm run test:integration` works on machines without vendor
 * tools. Set REQUIRE_QUARTUS=1 to fail instead of skipping (for hosts that
 * must have the image), or SKIP_QUARTUS=1 to skip even when it is available.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { generateFixtures, alteraFixtures, hwTclFiles, Fixture, FIXTURE_BASE } from './generator';
import { guardTier1 } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCKER_IMAGE = process.env.QUARTUS_DOCKER_IMAGE ?? 'cvsoc/quartus:23.1';
const TCLSH = '/opt/intelFPGA/quartus/bin/tclsh';
const VALIDATE_TCL = '/work/scripts/integration/quartus/validate.tcl';

function dockerImageAvailable(image: string): boolean {
  const result = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

let alteras: Fixture[] = [];

beforeAll(async () => {
  const all = await generateFixtures();
  alteras = alteraFixtures(all);
}, 300_000);

it('generates at least one Altera fixture with _hw.tcl', () => {
  expect(alteras.length).toBeGreaterThan(0);
});

it('all Altera _hw.tcl files pass Platform Designer stub validation', () => {
  if (guardTier1('docker', () => dockerImageAvailable(DOCKER_IMAGE))) {
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

  // eslint-disable-next-line no-console
  console.log(`  PASS: ${hwTclEntries.length} hw.tcl file(s) validated`);
});

it('all Altera Quartus project creation scripts run successfully', () => {
  if (guardTier1('docker', () => dockerImageAvailable(DOCKER_IMAGE))) {
    return;
  }

  if (alteras.length === 0) {
    throw new Error('No Altera fixtures were generated — check generator output');
  }

  for (const fixture of alteras) {
    const alteraDir = path.join(fixture.outputDir, 'altera');
    if (!fs.existsSync(alteraDir)) {
      continue;
    }
    const files = fs.readdirSync(alteraDir);
    const projectTclFile = files.find((f) => f.endsWith('_project.tcl'));
    if (!projectTclFile) {
      continue;
    }
    const projectTcl = path.join(alteraDir, projectTclFile);

    const tclInContainer = projectTcl.replace(REPO_ROOT, '/work');
    // quartus_sh needs a writable home directory for its cache/init; run as
    // root (no --user) so the image's default HOME works. The container is
    // --rm so nothing persists after the run.
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${REPO_ROOT}:/work`,
        '-v',
        `${FIXTURE_BASE}:${FIXTURE_BASE}`,
        DOCKER_IMAGE,
        '/opt/intelFPGA/quartus/bin/quartus_sh',
        '-t',
        tclInContainer,
      ],
      { encoding: 'utf8', timeout: 30_000, cwd: alteraDir }
    );

    if (result.error) {
      throw new Error(`Failed to spawn Docker for ${fixture.name} — ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(
        [
          `Quartus project creation FAILED for ${fixture.name} (exit ${result.status})`,
          `stdout:\n${result.stdout}`,
          `stderr:\n${result.stderr}`,
        ].join('\n')
      );
    }
    // eslint-disable-next-line no-console
    console.log(`  PASS: Quartus project for ${fixture.name}`);
  }
});
