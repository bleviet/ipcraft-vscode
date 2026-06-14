/**
 * Tier 1: IP-XACT / SPIRIT 1685-2009 structural validation.
 *
 * For every generated component.xml:
 *   1. Validates XML well-formedness (xmllint --noout).
 *   2. Confirms the SPIRIT/1685-2009 namespace is declared on the root element.
 *   3. Confirms required VLNV child elements are present.
 *
 * Uses xmllint from libxml2-utils (freely available, no Vivado required).
 * Runs the same shell script (scripts/integration/ipxact/validate.sh) that CI
 * invokes, so local and remote results are identical.
 *
 * Skip: SKIP_XMLLINT=1 (explicit opt-out).
 * Fail loudly: by default — xmllint is Tier 1 (required in CI).
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { generateFixtures, xilinxFixtures, Fixture } from './generator';
import { guardTier1, toolOnPath } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const VALIDATE_SH = path.join(REPO_ROOT, 'scripts', 'integration', 'ipxact', 'validate.sh');

const SPIRIT_NS = 'http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009';
const REQUIRED_ELEMENTS = ['spirit:vendor', 'spirit:library', 'spirit:name', 'spirit:version'];

let allFixtures: Fixture[] = [];

beforeAll(async () => {
  allFixtures = await generateFixtures();
}, 300_000);

describe('IP-XACT / SPIRIT 1685-2009 component.xml validation', () => {
  it('generates at least one Xilinx fixture with component.xml', () => {
    expect(xilinxFixtures(allFixtures).length).toBeGreaterThan(0);
  });

  it('all component.xml files are well-formed XML', () => {
    if (guardTier1('xmllint', () => toolOnPath('xmllint'))) {
      return;
    }

    const xilinx = xilinxFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of xilinx) {
      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      if (!fs.existsSync(xmlPath)) {
        failures.push(`${fixture.name}: component.xml not found at ${xmlPath}`);
        continue;
      }

      const result = spawnSync('xmllint', ['--noout', xmlPath], { encoding: 'utf8' });
      if (result.error || result.status !== 0) {
        failures.push(
          `${fixture.name}: malformed XML\n  ${result.stderr?.trim() ?? result.error?.message}`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`component.xml well-formedness failures:\n\n${failures.join('\n\n')}`);
    }
  });

  it('all component.xml files declare SPIRIT/1685-2009 namespace', () => {
    if (guardTier1('xmllint', () => toolOnPath('xmllint'))) {
      return;
    }

    const xilinx = xilinxFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of xilinx) {
      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      if (!fs.existsSync(xmlPath)) {
        continue;
      }

      const content = fs.readFileSync(xmlPath, 'utf8');
      if (!content.includes(SPIRIT_NS)) {
        failures.push(`${fixture.name}: missing SPIRIT/1685-2009 namespace in ${xmlPath}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`component.xml namespace failures:\n\n${failures.join('\n\n')}`);
    }
  });

  it('all component.xml files contain required VLNV elements', () => {
    if (guardTier1('xmllint', () => toolOnPath('xmllint'))) {
      return;
    }

    const xilinx = xilinxFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of xilinx) {
      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      if (!fs.existsSync(xmlPath)) {
        continue;
      }

      const content = fs.readFileSync(xmlPath, 'utf8');
      for (const element of REQUIRED_ELEMENTS) {
        if (!content.includes(`<${element}>`)) {
          failures.push(`${fixture.name}: missing required element <${element}> in ${xmlPath}`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`component.xml VLNV element failures:\n\n${failures.join('\n\n')}`);
    }
  });

  it('validate.sh passes on all component.xml files', () => {
    if (guardTier1('xmllint', () => toolOnPath('xmllint'))) {
      return;
    }

    const xilinx = xilinxFixtures(allFixtures);
    const xmlPaths = xilinx
      .map((f: Fixture) => path.join(f.outputDir, 'xilinx', 'component.xml'))
      .filter((p: string) => fs.existsSync(p));

    if (xmlPaths.length === 0) {
      throw new Error('No component.xml files found for validation');
    }

    const result = spawnSync('bash', [VALIDATE_SH, ...xmlPaths], { encoding: 'utf8' });

    if (result.error) {
      throw new Error(`validate.sh failed to run: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`validate.sh reported failures:\n${result.stdout}\n${result.stderr}`);
    }
  });
});
