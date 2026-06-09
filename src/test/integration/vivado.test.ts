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
 * The Vivado-dependent tests self-skip when VIVADO_BIN does not exist, so
 * `npm run test:integration` works on machines without vendor tools. Set
 * REQUIRE_VIVADO=1 to fail instead of skipping (for hosts that must have
 * Vivado), or SKIP_VIVADO=1 to skip even when Vivado is installed.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { generateFixtures, xilinxFixtures, Fixture } from './generator';

const VIVADO_BIN =
  process.env.VIVADO_BIN ?? '/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado';

const VALIDATE_TCL = path.resolve(__dirname, '../../../scripts/integration/vivado/validate.tcl');

const VIVADO_AVAILABLE = fs.existsSync(VIVADO_BIN);

const SKIP =
  process.env.SKIP_VIVADO === '1' || (!VIVADO_AVAILABLE && process.env.REQUIRE_VIVADO !== '1');

const SKIP_REASON =
  process.env.SKIP_VIVADO === '1'
    ? 'SKIP_VIVADO=1'
    : `Vivado not found at ${VIVADO_BIN} (set VIVADO_BIN or REQUIRE_VIVADO=1)`;

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
    console.log(`Skipping Vivado validation (${SKIP_REASON})`);
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

it('all fixtures have correct testbench and HDL files generated', () => {
  if (xilinxes.length === 0) {
    throw new Error('No Xilinx fixtures were generated — check generator output');
  }

  for (const fixture of xilinxes) {
    const isSv = fixture.name.endsWith('_sv');
    const files = Object.keys(fixture.files);

    // Check top HDL file. Two-pass: prefer a file without _core suffix; fall
    // back to accepting _core for IPs whose VLNV name itself ends with _core.
    const ext = isSv ? 'sv' : 'vhd';
    const baseFilter = (f: string) =>
      f.startsWith('rtl/') &&
      f.endsWith(`.${ext}`) &&
      !f.endsWith(`_pkg.${ext}`) &&
      !f.endsWith(`_regs.${ext}`) &&
      !f.includes('_axil') &&
      !f.includes('_avmm');
    const topHdl =
      files.find((f) => baseFilter(f) && !f.endsWith(`_core.${ext}`)) ??
      files.find((f) => baseFilter(f));
    expect(topHdl).toBeDefined();

    // Check testbench files
    const hasRegs = files.some((f) => f.startsWith('rtl/') && f.endsWith('_regs.' + ext));
    expect(files.includes('tb/mm_loader.py')).toBe(hasRegs);
    expect(files.some((f) => f.startsWith('tb/') && f.endsWith('_test.py'))).toBe(true);
    expect(files.includes('tb/conftest.py')).toBe(true);
    expect(files.some((f) => f.startsWith('tb/test_') && f.endsWith('_sim.py'))).toBe(true);
    expect(files.includes('tb/Makefile')).toBe(true);
  }
});

it('all Xilinx Vivado project creation scripts run successfully', () => {
  if (SKIP) {
    // eslint-disable-next-line no-console
    console.log(`Skipping Vivado project creation validation (${SKIP_REASON})`);
    return;
  }

  if (xilinxes.length === 0) {
    throw new Error('No Xilinx fixtures were generated — check generator output');
  }

  const failures: string[] = [];

  for (const fixture of xilinxes) {
    const xilinxDir = path.join(fixture.outputDir, 'xilinx');
    if (!fs.existsSync(xilinxDir)) {
      continue;
    }
    const files = fs.readdirSync(xilinxDir);
    const projectTclFile = files.find((f) => f.endsWith('_project.tcl'));
    if (!projectTclFile) {
      continue;
    }
    const projectTcl = path.join(xilinxDir, projectTclFile);

    const result = spawnSync(VIVADO_BIN, ['-mode', 'batch', '-source', projectTcl], {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: xilinxDir,
    });

    if (result.error) {
      failures.push(`${fixture.name}: failed to spawn Vivado — ${result.error.message}`);
      continue;
    }

    if (result.status !== 0) {
      failures.push(
        [
          `${fixture.name}: project creation FAIL (exit ${result.status})`,
          `stdout:\n${result.stdout}`,
          `stderr:\n${result.stderr}`,
        ].join('\n')
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`  PASS: Vivado project created for ${fixture.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Vivado project creation failed for ${failures.length} of ${xilinxes.length} fixture(s):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});

it('representative Vivado projects compile and synthesize successfully in Out-Of-Context mode', () => {
  if (SKIP) {
    // eslint-disable-next-line no-console
    console.log(`Skipping Vivado OOC synthesis validation (${SKIP_REASON})`);
    return;
  }

  // We choose representative fixtures to compile:
  // e.g. minimal_vhdl (VHDL) and minimal_sv (SystemVerilog)
  const targets = xilinxes.filter((f) => f.name === 'minimal_vhdl' || f.name === 'minimal_sv');
  if (targets.length === 0) {
    throw new Error('Could not find minimal_vhdl or minimal_sv fixtures');
  }

  const failures: string[] = [];

  for (const fixture of targets) {
    const xilinxDir = path.join(fixture.outputDir, 'xilinx');
    if (!fs.existsSync(xilinxDir)) {
      failures.push(`${fixture.name}: xilinx directory not found`);
      continue;
    }
    const files = fs.readdirSync(xilinxDir);
    const runOocTclFile = files.find((f) => f.endsWith('_run_ooc.tcl'));
    if (!runOocTclFile) {
      failures.push(`${fixture.name}: run_ooc.tcl not found`);
      continue;
    }
    const runOocTcl = path.join(xilinxDir, runOocTclFile);

    // Run Vivado in batch mode on run_ooc.tcl
    const result = spawnSync(
      VIVADO_BIN,
      ['-mode', 'batch', '-source', runOocTcl, '-nojournal', '-nolog', '-tclargs', '2'],
      { encoding: 'utf8', timeout: 300_000, cwd: xilinxDir }
    );

    if (result.error) {
      failures.push(`${fixture.name}: failed to spawn Vivado OOC — ${result.error.message}`);
      continue;
    }

    if (result.status !== 0) {
      failures.push(
        [
          `${fixture.name}: Vivado OOC synthesis FAIL (exit ${result.status})`,
          `stdout:\n${result.stdout}`,
          `stderr:\n${result.stderr}`,
        ].join('\n')
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`  PASS: Vivado OOC synthesis for ${fixture.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Vivado OOC synthesis failed for ${failures.length} of ${targets.length} fixture(s):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});
