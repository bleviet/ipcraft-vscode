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
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';

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

it('derives Avalon-ST symbol ordering from endianness in Quartus hw.tcl', () => {
  const fixture = alteraFixtures(allFixtures).find(
    (candidate) => candidate.name === 'examples/comprehensive_avalon_vhdl'
  );
  expect(fixture).toBeDefined();

  const tclPath = hwTclFiles(fixture!)[0];
  const tcl = fs.readFileSync(tclPath, 'utf8');
  expect(tcl).toContain('set_interface_property SRC_ST firstSymbolInHighOrderBits true');
  expect(tcl).toContain('set_interface_property SNK_ST firstSymbolInHighOrderBits false');
});

// ---------------------------------------------------------------------------
// VHDL package files
// ---------------------------------------------------------------------------

it('VHDL pkg file content matches snapshot', () => {
  const successful = allFixtures.filter((f) => f.success && f.name.endsWith('_vhdl'));
  const pkgMap: Record<string, string> = {};

  for (const f of successful) {
    for (const [relPath, absPath] of Object.entries(f.files)) {
      if (relPath.endsWith('_pkg.vhd')) {
        // f.files maps a relative path to the absolute written path; snapshot
        // the file content (machine-independent), not the tmpdir path.
        pkgMap[`${stableKey(f)}/${relPath}`] = fs.readFileSync(absPath, 'utf8');
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
    for (const [relPath, absPath] of Object.entries(f.files)) {
      if (relPath.endsWith('_pkg.sv')) {
        // f.files maps a relative path to the absolute written path; snapshot
        // the file content (machine-independent), not the tmpdir path.
        pkgMap[`${stableKey(f)}/${relPath}`] = fs.readFileSync(absPath, 'utf8');
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
      // f.files maps a relative path to the absolute written path; snapshot
      // the file content (machine-independent), not the tmpdir path.
      makeMap[stableKey(f)] = fs.readFileSync(f.files['tb/Makefile'], 'utf8');
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

// ---------------------------------------------------------------------------
// Quartus SDC timing constraints
// ---------------------------------------------------------------------------

it('Quartus SDC content matches snapshot for every Altera fixture', () => {
  // Snapshots the generated .sdc for every fixture that produced a Quartus
  // project. Guards against regressions in quartus_sdc.j2 — including
  // issue #77's gate on `derive_pll_clocks -create_base_clocks` (no fixture
  // in ipcraft-spec instantiates a PLL, so every snapshot must NOT contain
  // the command).
  const altera = alteraFixtures(allFixtures);
  const sdcMap: Record<string, string> = {};

  for (const f of altera) {
    const alteraDir = path.join(f.outputDir, 'altera');
    if (!fs.existsSync(alteraDir)) {
      continue;
    }
    for (const file of fs.readdirSync(alteraDir)) {
      if (file.endsWith('.sdc')) {
        sdcMap[`${stableKey(f)}/${file}`] = fs.readFileSync(path.join(alteraDir, file), 'utf8');
      }
    }
  }

  if (Object.keys(sdcMap).length > 0) {
    expect(sdcMap).toMatchSnapshot();
  }
});

it('Quartus SDC with has_pll renders derive_pll_clocks (synthetic PLL-present case)', () => {
  // Every ipcraft-spec fixture is PLL-less, so the snapshot above only covers
  // the has_pll: false path. This synthetic case renders quartus_sdc.j2
  // directly with has_pll: true so the derive_pll_clocks branch gets
  // exact-match regression coverage (not just substring assertions).
  const repoRoot = path.resolve(__dirname, '../../..');
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const loader = new TemplateLoader(logger, path.join(repoRoot, 'src/generator/templates'));

  const sdc = loader.render('quartus_sdc.j2', {
    entity_name: 'pll_design',
    has_pll: true,
    clocks_with_period: [
      { name: 'clk', frequency: '50MHz', period_ns: '20.000' },
      { name: 'pll_clk', frequency: '200MHz', period_ns: '5.000' },
    ],
  });
  expect(sdc).toMatchSnapshot();
});
