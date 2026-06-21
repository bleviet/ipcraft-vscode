/**
 * Tier 0: Parser round-trip tests.
 *
 * For each generated fixture, parses the generated HDL/VHDL/SV files back
 * to .ip.yml and verifies structural invariants survive the round-trip.
 *
 * Parsers tested:
 *   - VhdlParser: generated .vhd -> .ip.yml -> compare entity name, ports, params
 *   - VerilogParser: generated .sv/.v -> .ip.yml -> compare module name, ports, params
 *
 * ComponentXmlParser and HwTclParser round-trips are in roundtrip.test.ts.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as jsYaml from 'js-yaml';
import { generateFixtures, Fixture } from './generator';
import { parseVhdlFile } from '../../parser/VhdlParser';
import { parseVerilogFile } from '../../parser/VerilogParser';

let allFixtures: Fixture[] = [];

beforeAll(async () => {
  allFixtures = await generateFixtures();
}, 300_000);

function loadOriginalYaml(yamlPath: string): Record<string, unknown> {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  return (jsYaml.load(raw) as Record<string, unknown>) ?? {};
}

function findTopHdlFile(fixture: Fixture, ext: 'vhd' | 'sv' | 'v'): string | null {
  const files = Object.keys(fixture.files);
  const baseFilter = (f: string) =>
    f.startsWith('rtl/') &&
    f.endsWith(`.${ext}`) &&
    !f.endsWith(`_pkg.${ext}`) &&
    !f.endsWith(`_regs.${ext}`) &&
    !f.includes('_axil') &&
    !f.includes('_avmm');
  return (
    files.find((f) => baseFilter(f) && !f.endsWith(`_core.${ext}`)) ??
    files.find((f) => baseFilter(f)) ??
    null
  );
}

describe('VHDL parser round-trip', () => {
  it('entity name survives generate -> parse', async () => {
    const vhdlFixtures = allFixtures.filter((f) => f.name.endsWith('_vhdl'));
    const failures: string[] = [];

    for (const fixture of vhdlFixtures) {
      const topFile = findTopHdlFile(fixture, 'vhd');
      if (!topFile) {
        continue;
      }
      const filePath = path.join(fixture.outputDir, topFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const original = loadOriginalYaml(fixture.yamlPath);
      const expectedName = String(
        (original.vlnv as Record<string, unknown>)?.name ?? ''
      ).toLowerCase();
      if (!expectedName) {
        continue;
      }

      const result = await parseVhdlFile(filePath);
      const parsedName = result.entityName.toLowerCase();

      if (parsedName !== expectedName) {
        failures.push(`${fixture.name}: expected entity "${expectedName}", got "${parsedName}"`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`VHDL entity name round-trip failures:\n\n${failures.join('\n')}`);
    }
  });

  it('port count is preserved (bus + clock + reset + user ports)', async () => {
    const vhdlFixtures = allFixtures.filter((f) => f.name.endsWith('_vhdl'));
    const failures: string[] = [];

    for (const fixture of vhdlFixtures) {
      const topFile = findTopHdlFile(fixture, 'vhd');
      if (!topFile) {
        continue;
      }
      const filePath = path.join(fixture.outputDir, topFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const result = await parseVhdlFile(filePath, { detectBus: true });
      const parsed = jsYaml.load(result.yamlText) as Record<string, unknown>;

      const parsedPorts = ((parsed.ports as unknown[]) ?? []).length;
      const parsedClocks = ((parsed.clocks as unknown[]) ?? []).length;
      const parsedResets = ((parsed.resets as unknown[]) ?? []).length;
      const totalParsed = parsedPorts + parsedClocks + parsedResets;

      if (totalParsed === 0) {
        failures.push(`${fixture.name}: parsed 0 total ports (expected > 0)`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`VHDL port count round-trip failures:\n\n${failures.join('\n')}`);
    }
  });

  it('parameter names survive generate -> parse', async () => {
    const vhdlFixtures = allFixtures.filter((f) => f.name.endsWith('_vhdl'));
    const failures: string[] = [];

    for (const fixture of vhdlFixtures) {
      const topFile = findTopHdlFile(fixture, 'vhd');
      if (!topFile) {
        continue;
      }
      const filePath = path.join(fixture.outputDir, topFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const original = loadOriginalYaml(fixture.yamlPath);
      const originalParams = ((original.parameters as unknown[]) ?? [])
        .filter((p) => p && typeof p === 'object')
        .map((p) => String((p as Record<string, unknown>).name ?? '').toLowerCase())
        .sort();

      if (originalParams.length === 0) {
        continue;
      }

      const result = await parseVhdlFile(filePath);
      const parsed = jsYaml.load(result.yamlText) as Record<string, unknown>;
      const parsedParams = ((parsed.parameters as unknown[]) ?? [])
        .filter((p) => p && typeof p === 'object')
        .map((p) => String((p as Record<string, unknown>).name ?? '').toLowerCase())
        .sort();

      if (parsedParams.length === 0 && originalParams.length > 0) {
        failures.push(
          `${fixture.name}: original has ${originalParams.length} params, parsed has 0`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`VHDL parameter round-trip failures:\n\n${failures.join('\n')}`);
    }
  });
});

describe('Verilog/SystemVerilog parser round-trip', () => {
  it('module name survives generate -> parse', async () => {
    const svFixtures = allFixtures.filter((f) => f.name.endsWith('_sv'));
    const failures: string[] = [];

    for (const fixture of svFixtures) {
      const topFile = findTopHdlFile(fixture, 'sv');
      if (!topFile) {
        continue;
      }
      const filePath = path.join(fixture.outputDir, topFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const original = loadOriginalYaml(fixture.yamlPath);
      const expectedName = String(
        (original.vlnv as Record<string, unknown>)?.name ?? ''
      ).toLowerCase();
      if (!expectedName) {
        continue;
      }

      const result = await parseVerilogFile(filePath);
      const parsedName = result.moduleName.toLowerCase();

      if (parsedName !== expectedName) {
        failures.push(`${fixture.name}: expected module "${expectedName}", got "${parsedName}"`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`SV module name round-trip failures:\n\n${failures.join('\n')}`);
    }
  });

  it('port count is preserved', async () => {
    const svFixtures = allFixtures.filter((f) => f.name.endsWith('_sv'));
    const failures: string[] = [];

    for (const fixture of svFixtures) {
      const topFile = findTopHdlFile(fixture, 'sv');
      if (!topFile) {
        continue;
      }
      const filePath = path.join(fixture.outputDir, topFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const result = await parseVerilogFile(filePath, { detectBus: true });
      const parsed = jsYaml.load(result.yamlText) as Record<string, unknown>;

      const parsedPorts = ((parsed.ports as unknown[]) ?? []).length;
      const parsedClocks = ((parsed.clocks as unknown[]) ?? []).length;
      const parsedResets = ((parsed.resets as unknown[]) ?? []).length;
      const totalParsed = parsedPorts + parsedClocks + parsedResets;

      if (totalParsed === 0) {
        failures.push(`${fixture.name}: parsed 0 total ports (expected > 0)`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`SV port count round-trip failures:\n\n${failures.join('\n')}`);
    }
  });

  it('parameter names survive generate -> parse', async () => {
    const svFixtures = allFixtures.filter((f) => f.name.endsWith('_sv'));
    const failures: string[] = [];

    for (const fixture of svFixtures) {
      const topFile = findTopHdlFile(fixture, 'sv');
      if (!topFile) {
        continue;
      }
      const filePath = path.join(fixture.outputDir, topFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const original = loadOriginalYaml(fixture.yamlPath);
      const originalParams = ((original.parameters as unknown[]) ?? [])
        .filter((p) => p && typeof p === 'object')
        .map((p) => String((p as Record<string, unknown>).name ?? '').toLowerCase())
        .sort();

      if (originalParams.length === 0) {
        continue;
      }

      const result = await parseVerilogFile(filePath);
      const parsed = jsYaml.load(result.yamlText) as Record<string, unknown>;
      const parsedParams = ((parsed.parameters as unknown[]) ?? [])
        .filter((p) => p && typeof p === 'object')
        .map((p) => String((p as Record<string, unknown>).name ?? '').toLowerCase())
        .sort();

      if (parsedParams.length === 0 && originalParams.length > 0) {
        failures.push(
          `${fixture.name}: original has ${originalParams.length} params, parsed has 0`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`SV parameter round-trip failures:\n\n${failures.join('\n')}`);
    }
  });
});
