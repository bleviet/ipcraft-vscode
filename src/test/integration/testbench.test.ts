/**
 * Tier 1: cocotb testbench execution tests.
 *
 * For each generated fixture that has a tb/Makefile, runs the cocotb
 * testbench against the generated RTL using GHDL (VHDL) or Icarus Verilog (SV).
 *
 * Requires:
 *   - GHDL on PATH (for VHDL fixtures, SIM=ghdl)
 *   - iverilog on PATH (for SV fixtures, SIM=icarus)
 *   - Python 3 with cocotb and pytest installed
 *
 * Self-skips when tools are absent. Set REQUIRE_COCOTB=1 to fail instead.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { spawnSync } from 'child_process';
import { generateFixtures, Fixture } from './generator';
import { guardTier1, toolOnPath } from './tier';
import {
  hasMemoryMappedSlaveInterface,
  resolveMemoryMaps,
} from '../../generator/registerProcessor';
import type { IpCoreData } from '../../generator/types';

let allFixtures: Fixture[] = [];

beforeAll(async () => {
  allFixtures = await generateFixtures();
}, 300_000);

function hasMakefile(fixture: Fixture): boolean {
  return 'tb/Makefile' in fixture.files;
}

/**
 * Some examples declare a `managed: false` fileSets entry — RTL the tool never
 * generates because it's meant to be hand-authored. If that file was never actually
 * added to the source .ip.yml's directory, the example is incomplete data, not a
 * generator bug: skip it here instead of failing on a Makefile with an unresolvable
 * source path.
 */
function missingHandAuthoredRtl(fixture: Fixture): string | undefined {
  type FileSetEntry = { files?: Array<{ path?: string; type?: string; managed?: boolean }> };
  let doc: { fileSets?: FileSetEntry[] };
  try {
    doc = yaml.load(fs.readFileSync(fixture.yamlPath, 'utf8')) as typeof doc;
  } catch {
    return undefined;
  }
  const ipCoreDir = path.dirname(fixture.yamlPath);
  for (const fset of doc.fileSets ?? []) {
    for (const f of fset.files ?? []) {
      if (
        f.managed === false &&
        f.path &&
        (f.type === 'vhdl' || f.type === 'systemverilog') &&
        !fs.existsSync(path.resolve(ipCoreDir, f.path))
      ) {
        return f.path;
      }
    }
  }
  return undefined;
}

/**
 * The cocotb test template always emits regmap-loading code (mm_loader.py + a
 * `../{name}.mm.yml` path guess) whenever the .ip.yml declares a memory-mapped slave
 * bus interface, regardless of whether any memoryMaps data actually backs it. An
 * example that declares such an interface but never adds a memoryMaps section (or
 * import) is incomplete data, not a generator bug: skip it rather than fail on a
 * FileNotFoundError for a .mm.yml that was never meant to exist.
 */
async function missingMemoryMap(fixture: Fixture): Promise<string | undefined> {
  let doc: IpCoreData;
  try {
    doc = yaml.load(fs.readFileSync(fixture.yamlPath, 'utf8')) as IpCoreData;
  } catch {
    return undefined;
  }
  if (!hasMemoryMappedSlaveInterface(doc)) {
    return undefined;
  }
  const maps = await resolveMemoryMaps(doc, fixture.yamlPath);
  return maps.length === 0
    ? 'declares a memory-mapped slave interface but no memoryMaps data resolved'
    : undefined;
}

function cocotbAvailable(): boolean {
  const result = spawnSync('python3', ['-c', 'import cocotb'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

it('generates at least one fixture with tb/Makefile', () => {
  const withTb = allFixtures.filter(hasMakefile);
  expect(withTb.length).toBeGreaterThan(0);
});

it('VHDL testbenches pass with GHDL simulator', async () => {
  const ghdlAvailable = toolOnPath('ghdl');
  if (guardTier1('ghdl', () => ghdlAvailable)) {
    return;
  }
  if (guardTier1('cocotb', cocotbAvailable)) {
    return;
  }

  const vhdlFixtures = allFixtures.filter((f) => f.name.endsWith('_vhdl') && hasMakefile(f));
  if (vhdlFixtures.length === 0) {
    throw new Error('No VHDL fixtures with tb/Makefile found');
  }

  const failures: string[] = [];

  for (const fixture of vhdlFixtures) {
    const tbDir = path.join(fixture.outputDir, 'tb');
    if (!fs.existsSync(path.join(tbDir, 'Makefile'))) {
      continue;
    }
    const missingRtl = missingHandAuthoredRtl(fixture);
    if (missingRtl) {
      console.warn(`  SKIP: ${fixture.name} — hand-authored RTL not on disk: ${missingRtl}`);
      continue;
    }
    const missingMm = await missingMemoryMap(fixture);
    if (missingMm) {
      console.warn(`  SKIP: ${fixture.name} — ${missingMm}`);
      continue;
    }

    const result = spawnSync('make', ['-C', tbDir, 'SIM=ghdl', 'WAVES=0'], {
      encoding: 'utf8',
      timeout: 120_000,
    });

    if (result.error) {
      failures.push(`${fixture.name}: failed to spawn make — ${result.error.message}`);
      continue;
    }

    if (result.status !== 0) {
      failures.push(
        [
          `${fixture.name}: cocotb GHDL FAIL (exit ${result.status})`,
          `stdout:\n${result.stdout?.slice(-2000) ?? ''}`,
          `stderr:\n${result.stderr?.slice(-2000) ?? ''}`,
        ].join('\n')
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`  PASS: cocotb GHDL for ${fixture.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `cocotb GHDL testbench failures (${failures.length}/${vhdlFixtures.length}):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});

it('SystemVerilog testbenches pass with Icarus Verilog simulator', async () => {
  const iverilogAvailable = toolOnPath('iverilog');
  if (guardTier1('iverilog', () => iverilogAvailable)) {
    return;
  }
  if (guardTier1('cocotb', cocotbAvailable)) {
    return;
  }

  const svFixtures = allFixtures.filter((f) => f.name.endsWith('_sv') && hasMakefile(f));
  if (svFixtures.length === 0) {
    throw new Error('No SV fixtures with tb/Makefile found');
  }

  const failures: string[] = [];

  for (const fixture of svFixtures) {
    const tbDir = path.join(fixture.outputDir, 'tb');
    if (!fs.existsSync(path.join(tbDir, 'Makefile'))) {
      continue;
    }
    const missingRtl = missingHandAuthoredRtl(fixture);
    if (missingRtl) {
      console.warn(`  SKIP: ${fixture.name} — hand-authored RTL not on disk: ${missingRtl}`);
      continue;
    }
    const missingMm = await missingMemoryMap(fixture);
    if (missingMm) {
      console.warn(`  SKIP: ${fixture.name} — ${missingMm}`);
      continue;
    }

    const result = spawnSync('make', ['-C', tbDir, 'SIM=icarus', 'WAVES=0'], {
      encoding: 'utf8',
      timeout: 120_000,
    });

    if (result.error) {
      failures.push(`${fixture.name}: failed to spawn make — ${result.error.message}`);
      continue;
    }

    if (result.status !== 0) {
      failures.push(
        [
          `${fixture.name}: cocotb Icarus FAIL (exit ${result.status})`,
          `stdout:\n${result.stdout?.slice(-2000) ?? ''}`,
          `stderr:\n${result.stderr?.slice(-2000) ?? ''}`,
        ].join('\n')
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`  PASS: cocotb Icarus for ${fixture.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `cocotb Icarus testbench failures (${failures.length}/${svFixtures.length}):\n\n` +
        failures.join('\n\n---\n\n')
    );
  }
});
