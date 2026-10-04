/**
 * Vivado integration tests.
 *
 * For each template IP core that produces an xilinx/component.xml, runs Vivado
 * in batch mode with scripts/integration/vivado/validate.tcl and asserts that
 * ipx::check_integrity reports no ERRORs or CRITICAL WARNINGs.
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
import { guardTier2 } from './tier';

const VIVADO_BIN =
  process.env.VIVADO_BIN ?? '/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado';

const VALIDATE_TCL = path.resolve(__dirname, '../../../scripts/integration/vivado/validate.tcl');

const VALIDATE_BD_TCL = path.resolve(
  __dirname,
  '../../../scripts/integration/vivado/validate_bd.tcl'
);

let xilinxes: Fixture[] = [];

/**
 * Fixtures that validate.tcl is known to reject, keyed by fixture name, with
 * the exact set of Vivado message IDs the rejection carries. Any other ERROR or
 * CRITICAL WARNING ID fails the test, so a new defect in the same fixture
 * cannot hide behind the entry; a fixture that starts passing fails the test so
 * its entry gets removed.
 */
const KNOWN_INTEGRITY_FAILURES: Record<string, string[]> = {
  // The IP has no ports at all, which Vivado refuses to package. Ipptcl
  // 7-1485 is check_integrity's own "Integrity check failed" summary.
  minimal_vhdl: ['IP_Flow 19-748', 'Ipptcl 7-1485'],
  minimal_sv: ['IP_Flow 19-748', 'Ipptcl 7-1485'],
  'examples/minimal_vhdl': ['IP_Flow 19-748', 'Ipptcl 7-1485'],
  'examples/minimal_sv': ['IP_Flow 19-748', 'Ipptcl 7-1485'],
};

/** Fixtures validate_bd.tcl is known to reject, matched the same way. */
const KNOWN_BD_FAILURES: Record<string, string[]> = {
  // The ipcraft-spec example ties RST_SYS to CLK_SYS (100 MHz) and CLK_USB
  // (60 MHz); the fix belongs in the example, not the generator.
  'examples/system_controller_vhdl': ['BD 41-1761'],
  'examples/system_controller_sv': ['BD 41-1761'],
};

/**
 * Runs a validator script in Vivado batch mode. Vivado prints ERRORs to stderr
 * and everything else to stdout, so both go to one file to keep their order
 * relative to the section markers.
 */
function runValidator(
  script: string,
  xilinxDir: string
): { status: number | null; output: string } {
  const logPath = path.join(xilinxDir, `${path.basename(script, '.tcl')}.out`);
  const fd = fs.openSync(logPath, 'w');
  try {
    const result = spawnSync(
      VIVADO_BIN,
      ['-mode', 'batch', '-nojournal', '-nolog', '-source', script, '-tclargs', xilinxDir],
      { stdio: ['ignore', fd, fd], timeout: 120_000 }
    );
    if (result.error) {
      // e.g. ETIMEDOUT: keep what Vivado logged before it was stopped.
      const log = fs.readFileSync(logPath, 'utf8');
      return { status: null, output: `Vivado run failed — ${result.error.message}\n${log}` };
    }
    return { status: result.status, output: fs.readFileSync(logPath, 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Checks one validator run against the known-failure table: a listed fixture
 * must fail with exactly its listed message IDs, any other must pass.
 * Returns a failure description, or undefined when the run is as expected.
 */
function checkRun(
  fixtureName: string,
  run: { status: number | null; output: string },
  section: string,
  known: Record<string, string[]>,
  tableName: string
): string | undefined {
  const passed = run.status === 0;
  const expected = [...(known[fixtureName] ?? [])].sort();
  if (expected.length === 0) {
    return passed ? undefined : `${fixtureName}: FAIL (exit ${run.status})\n${run.output}`;
  }
  if (passed) {
    return `${fixtureName}: now passes — remove it from ${tableName}`;
  }
  const ids = messageIds(run.output, section);
  if (ids.join(',') !== expected.join(',')) {
    return (
      `${fixtureName}: FAIL with [${ids.join(', ')}], expected exactly ` +
      `[${expected.join(', ')}] (exit ${run.status})\n${run.output}`
    );
  }
  return undefined;
}

/**
 * IDs of the ERROR and CRITICAL WARNING messages Vivado printed between a
 * validator's "=== <section> begin/end ===" markers. Batch mode also echoes
 * each Tcl command with a "# " prefix, so only exact marker lines count.
 */
function messageIds(stdout: string, section: string): string[] {
  const lines = stdout.split('\n');
  const begin = lines.indexOf(`=== ${section} begin ===`);
  const end = lines.indexOf(`=== ${section} end ===`);
  if (begin < 0 || end < begin) {
    return [];
  }
  const ids = lines
    .slice(begin + 1, end)
    .map((line) => /^(?:ERROR|CRITICAL WARNING): \[([^\]]+)\]/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
  return [...new Set(ids)].sort();
}

beforeAll(async () => {
  const all = await generateFixtures();
  xilinxes = xilinxFixtures(all);
}, 300_000);

it('generates at least one Xilinx fixture with component.xml', () => {
  expect(xilinxes.length).toBeGreaterThan(0);
});

it('exports authored Avalon-ST symbol semantics and bundled custom definitions', () => {
  const fixture = xilinxes.find(
    (candidate) => candidate.name === 'examples/comprehensive_avalon_vhdl'
  );
  expect(fixture).toBeDefined();
  const xilinxDir = path.join(fixture!.outputDir, 'xilinx');
  const xml = fs.readFileSync(path.join(xilinxDir, 'component.xml'), 'utf8');

  expect(fs.existsSync(path.join(xilinxDir, 'busdef', 'avalon_st.xml'))).toBe(true);
  expect(fs.existsSync(path.join(xilinxDir, 'busdef', 'avalon_st_rtl.xml'))).toBe(true);

  const snkStart = xml.indexOf('<spirit:name>SNK_ST</spirit:name>');
  const snkEnd = xml.indexOf('</spirit:busInterface>', snkStart);
  const snkInterface = xml.slice(snkStart, snkEnd);
  expect(snkInterface).toMatch(
    /<spirit:name>dataBitsPerSymbol<\/spirit:name>[\s\S]*?<spirit:value[^>]*>1<\/spirit:value>/
  );
  expect(snkInterface).toMatch(
    /<spirit:name>symbolsPerBeat<\/spirit:name>[\s\S]*?<spirit:value[^>]*>16<\/spirit:value>/
  );
  const mirrorStart = snkInterface.indexOf('<ipcraft:interfaceContract version="1">');
  const mirrorEnd = snkInterface.indexOf('</ipcraft:interfaceContract>', mirrorStart);
  const mirror = snkInterface.slice(mirrorStart, mirrorEnd);
  expect(mirror).toContain('<ipcraft:property name="dataBitsPerSymbol" value="1" />');
  expect(mirror.match(/<ipcraft:property /g)).toHaveLength(1);
  expect(mirror).not.toContain('name="symbolsPerBeat"');
  expect(mirror).not.toContain('name="maxChannel"');
  expect(mirror).not.toContain('name="readyLatency"');
  expect(mirror).not.toContain('name="endianness"');
  expect(snkInterface).toContain('<spirit:name>asi_rx_bits</spirit:name>');

  const snkDataPortStart = xml.indexOf('<spirit:name>asi_rx_bits</spirit:name>', snkEnd);
  const snkDataPortEnd = xml.indexOf('</spirit:port>', snkDataPortStart);
  expect(xml.slice(snkDataPortStart, snkDataPortEnd)).toContain(
    '<spirit:left spirit:format="long">15</spirit:left>'
  );

  const srcStart = xml.indexOf('<spirit:name>SRC_ST</spirit:name>');
  const srcEnd = xml.indexOf('</spirit:busInterface>', srcStart);
  const srcInterface = xml.slice(srcStart, srcEnd);
  expect(srcInterface).toContain('<spirit:name>aso_startofpacket</spirit:name>');
  expect(srcInterface).toContain('<spirit:name>aso_endofpacket</spirit:name>');
  expect(srcInterface).toContain('<spirit:name>aso_empty</spirit:name>');
  const srcEmptyPortStart = xml.indexOf('<spirit:name>aso_empty</spirit:name>', srcEnd);
  const srcEmptyPortEnd = xml.indexOf('</spirit:port>', srcEmptyPortStart);
  expect(xml.slice(srcEmptyPortStart, srcEmptyPortEnd)).toContain(
    '<spirit:left spirit:format="long">2</spirit:left>'
  );
});

it('all Xilinx fixtures pass Vivado ipx::check_integrity', () => {
  if (
    guardTier2(
      'vivado',
      () => fs.existsSync(VIVADO_BIN),
      `not found at ${VIVADO_BIN} (set VIVADO_BIN or REQUIRE_VIVADO=1)`
    )
  ) {
    return;
  }

  if (xilinxes.length === 0) {
    throw new Error('No Xilinx fixtures were generated — check generator output');
  }

  const failures: string[] = [];

  for (const fixture of xilinxes) {
    const xilinxDir = path.join(fixture.outputDir, 'xilinx');

    const failure = checkRun(
      fixture.name,
      runValidator(VALIDATE_TCL, xilinxDir),
      'component validation',
      KNOWN_INTEGRITY_FAILURES,
      'KNOWN_INTEGRITY_FAILURES'
    );
    if (failure) {
      failures.push(failure);
    } else {
      // eslint-disable-next-line no-console
      console.log(`  OK: ${fixture.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Vivado validation failed for ${failures.length} of ${xilinxes.length} fixture(s):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});

it('all Xilinx fixtures pass Vivado block-design instantiation + export (validate_bd_design)', () => {
  if (
    guardTier2(
      'vivado',
      () => fs.existsSync(VIVADO_BIN),
      `not found at ${VIVADO_BIN} (set VIVADO_BIN or REQUIRE_VIVADO=1)`
    )
  ) {
    return;
  }

  if (xilinxes.length === 0) {
    throw new Error('No Xilinx fixtures were generated — check generator output');
  }

  const failures: string[] = [];

  for (const fixture of xilinxes) {
    const xilinxDir = path.join(fixture.outputDir, 'xilinx');

    const failure = checkRun(
      fixture.name,
      runValidator(VALIDATE_BD_TCL, xilinxDir),
      'block design',
      KNOWN_BD_FAILURES,
      'KNOWN_BD_FAILURES'
    );
    if (failure) {
      failures.push(failure);
    } else {
      // eslint-disable-next-line no-console
      console.log(`  OK: ${fixture.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Vivado block-design validation failed for ${failures.length} of ${xilinxes.length} fixture(s):\n\n` +
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
    expect(files.includes('tb/verification_manifest.json')).toBe(hasRegs);
    expect(files.includes('tb/register_model.py')).toBe(hasRegs);
    expect(files.some((f) => f.startsWith('tb/') && f.endsWith('_test.py'))).toBe(true);
    expect(files.includes('tb/conftest.py')).toBe(true);
    expect(files.some((f) => f.startsWith('tb/test_') && f.endsWith('_sim.py'))).toBe(true);
    expect(files.includes('tb/Makefile')).toBe(true);
  }
});

it('all Xilinx Vivado project creation scripts run successfully', () => {
  if (
    guardTier2(
      'vivado',
      () => fs.existsSync(VIVADO_BIN),
      `not found at ${VIVADO_BIN} (set VIVADO_BIN or REQUIRE_VIVADO=1)`
    )
  ) {
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
  if (
    guardTier2(
      'vivado',
      () => fs.existsSync(VIVADO_BIN),
      `not found at ${VIVADO_BIN} (set VIVADO_BIN or REQUIRE_VIVADO=1)`
    )
  ) {
    return;
  }

  const synthesisTargetNames = new Set([
    'minimal_vhdl',
    'minimal_sv',
    'axi_slave_vhdl',
    'axi_slave_sv',
    'avalon_peripheral_vhdl',
    'avalon_peripheral_sv',
    'basic_vhdl',
    'basic_sv',
    'examples/basic_peripheral_vhdl',
    'examples/basic_peripheral_sv',
    'examples/comprehensive_axi_vhdl',
    'examples/comprehensive_axi_sv',
    'examples/comprehensive_avalon_vhdl',
    'examples/comprehensive_avalon_sv',
    'examples/multi_interface_accelerator_vhdl',
    'examples/multi_interface_accelerator_sv',
  ]);
  const targets = xilinxes.filter((f) => synthesisTargetNames.has(f.name));
  if (targets.length === 0) {
    throw new Error(
      'No synthesis targets found. Expected at least one of: ' +
        [...synthesisTargetNames].join(', ')
    );
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
