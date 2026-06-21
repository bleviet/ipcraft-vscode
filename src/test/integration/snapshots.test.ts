/**
 * Tier 0: golden-file snapshot tests.
 *
 * Captures the structure and content of generated artifacts for every template
 * and example IP core. Requires no vendor tools — pure Node generation.
 *
 * On first run (or after `npm run test:integration -- -u`), Jest writes the
 * snapshots to __snapshots__/snapshots.test.ts.snap and commits them to git.
 * Subsequent runs compare against those stored snapshots.
 *
 * What is snapshotted:
 *   - The relative file list for every fixture (detects files going missing
 *     or unexpected new files).
 *   - The full text of component.xml (Vivado IP-XACT — most fragile artifact).
 *   - The full text of every *_hw.tcl (Quartus — second most fragile).
 *
 * Paths inside component.xml and hw.tcl are relative to the IP directory and
 * therefore stable across machines. Absolute tmpdir paths are stripped from
 * snapshot keys.
 */

import * as path from 'path';
import * as fs from 'fs';
import { generateFixtures, xilinxFixtures, alteraFixtures, hwTclFiles, Fixture } from './generator';

// Stable fixture key: strip the machine-specific tmpdir prefix
function stableKey(fixture: Fixture): string {
  return fixture.name;
}

let allFixtures: Fixture[] = [];

beforeAll(async () => {
  allFixtures = await generateFixtures();
}, 300_000);

// ---------------------------------------------------------------------------
// File structure: relative paths only
// ---------------------------------------------------------------------------

it('all fixtures generate at least one file', () => {
  const failed = allFixtures.filter((f) => f.success && Object.keys(f.files).length === 0);
  expect(failed.map((f) => f.name)).toEqual([]);
});

it('file list matches snapshot for every fixture', () => {
  const successful = allFixtures.filter((f) => f.success);
  expect(successful.length).toBeGreaterThan(0);

  const fileMap: Record<string, string[]> = {};
  for (const f of successful) {
    fileMap[stableKey(f)] = Object.keys(f.files).sort();
  }
  expect(fileMap).toMatchSnapshot();
});

// ---------------------------------------------------------------------------
// Vivado component.xml content
// ---------------------------------------------------------------------------

it('component.xml content matches snapshot for every Xilinx fixture', () => {
  const xilinx = xilinxFixtures(allFixtures);
  expect(xilinx.length).toBeGreaterThan(0);

  const xmlMap: Record<string, string> = {};
  for (const f of xilinx) {
    const xmlPath = path.join(f.outputDir, 'xilinx', 'component.xml');
    xmlMap[stableKey(f)] = fs.readFileSync(xmlPath, 'utf8');
  }
  expect(xmlMap).toMatchSnapshot();
});

// ---------------------------------------------------------------------------
// Quartus hw.tcl content
// ---------------------------------------------------------------------------

it('hw.tcl content matches snapshot for every Altera fixture', () => {
  const altera = alteraFixtures(allFixtures);
  expect(altera.length).toBeGreaterThan(0);

  const tclMap: Record<string, string> = {};
  for (const f of altera) {
    for (const tclPath of hwTclFiles(f)) {
      const tclName = path.basename(tclPath);
      tclMap[`${stableKey(f)}/${tclName}`] = fs.readFileSync(tclPath, 'utf8');
    }
  }
  expect(tclMap).toMatchSnapshot();
});

// ---------------------------------------------------------------------------
// VHDL package files
// ---------------------------------------------------------------------------

it('VHDL pkg file content matches snapshot', () => {
  const successful = allFixtures.filter((f) => f.success && f.name.endsWith('_vhdl'));
  const pkgMap: Record<string, string> = {};

  for (const f of successful) {
    for (const [relPath, content] of Object.entries(f.files)) {
      if (relPath.endsWith('_pkg.vhd')) {
        pkgMap[`${stableKey(f)}/${relPath}`] = content;
      }
    }
  }

  if (Object.keys(pkgMap).length > 0) {
    expect(pkgMap).toMatchSnapshot();
  }
});

// ---------------------------------------------------------------------------
// SystemVerilog package files
// ---------------------------------------------------------------------------

it('SystemVerilog pkg file content matches snapshot', () => {
  const successful = allFixtures.filter((f) => f.success && f.name.endsWith('_sv'));
  const pkgMap: Record<string, string> = {};

  for (const f of successful) {
    for (const [relPath, content] of Object.entries(f.files)) {
      if (relPath.endsWith('_pkg.sv')) {
        pkgMap[`${stableKey(f)}/${relPath}`] = content;
      }
    }
  }

  if (Object.keys(pkgMap).length > 0) {
    expect(pkgMap).toMatchSnapshot();
  }
});

// ---------------------------------------------------------------------------
// Testbench Makefiles
// ---------------------------------------------------------------------------

it('testbench Makefile content matches snapshot', () => {
  const successful = allFixtures.filter((f) => f.success);
  const makeMap: Record<string, string> = {};

  for (const f of successful) {
    if ('tb/Makefile' in f.files) {
      makeMap[stableKey(f)] = f.files['tb/Makefile'];
    }
  }

  if (Object.keys(makeMap).length > 0) {
    expect(makeMap).toMatchSnapshot();
  }
});

// ---------------------------------------------------------------------------
// Vivado project creation scripts
// ---------------------------------------------------------------------------

it('Vivado project Tcl scripts match snapshot', () => {
  const xilinx = xilinxFixtures(allFixtures);
  const tclMap: Record<string, string> = {};

  for (const f of xilinx) {
    const xilinxDir = path.join(f.outputDir, 'xilinx');
    if (!fs.existsSync(xilinxDir)) {
      continue;
    }
    for (const file of fs.readdirSync(xilinxDir)) {
      if (file.endsWith('_project.tcl')) {
        tclMap[`${stableKey(f)}/${file}`] = fs.readFileSync(path.join(xilinxDir, file), 'utf8');
      }
    }
  }

  if (Object.keys(tclMap).length > 0) {
    expect(tclMap).toMatchSnapshot();
  }
});

// ---------------------------------------------------------------------------
// Quartus project creation scripts
// ---------------------------------------------------------------------------

it('Quartus project Tcl scripts match snapshot', () => {
  const altera = alteraFixtures(allFixtures);
  const tclMap: Record<string, string> = {};

  for (const f of altera) {
    const alteraDir = path.join(f.outputDir, 'altera');
    if (!fs.existsSync(alteraDir)) {
      continue;
    }
    for (const file of fs.readdirSync(alteraDir)) {
      if (file.endsWith('_project.tcl')) {
        tclMap[`${stableKey(f)}/${file}`] = fs.readFileSync(path.join(alteraDir, file), 'utf8');
      }
    }
  }

  if (Object.keys(tclMap).length > 0) {
    expect(tclMap).toMatchSnapshot();
  }
});
