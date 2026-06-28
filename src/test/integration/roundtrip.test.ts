/**
 * Tier 0: generate / re-import round-trip tests.
 *
 * Exploits the existing inverse pairs in the codebase:
 *   VivadoComponentXmlGenerator <-> ComponentXmlParser
 *   (hw.tcl emitter)            <-> HwTclParser
 *
 * For each generated fixture:
 *   1. Read the original .ip.yml to know the expected structure.
 *   2. Parse the generated artifact (component.xml or _hw.tcl) back to YAML.
 *   3. Assert that the structural invariants survive the round-trip.
 *
 * Requires no vendor tools — everything is pure Node. This is the single
 * highest-leverage Tier 0 check: it exercises the CRC / VLNV / variant code
 * in VivadoComponentXmlGenerator and HwTclParser without Vivado or Docker.
 *
 * Invariants tested (per fixture):
 *   - The component name (vlnv.name) is preserved.
 *   - Every bus protocol (AXI-Lite, Avalon-MM, AXI-Stream, …) present in the
 *     original IP is still identifiable by the same templateType after parsing.
 *   - The count of user-visible bus interfaces matches.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as jsYaml from 'js-yaml';
import { generateFixtures, xilinxFixtures, alteraFixtures, hwTclFiles, Fixture } from './generator';
import { parseComponentXmlText } from '../../parser/ComponentXmlParser';
import { parseHwTclFile } from '../../parser/HwTclParser';
import { normalizeBusType } from '../../generator/registerProcessor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Vivado IP-XACT packages AXI protocols natively; Avalon-MM is Intel/Altera-specific and
// does not survive a Vivado component.xml round-trip.
const VIVADO_MM_TYPES = new Set(['axil', 'axi4']);

// Quartus hw.tcl packages both AXI-family and Avalon-MM natively.
const QUARTUS_MM_TYPES = new Set(['axil', 'axi4', 'avmm']);

/** Classify a bus type VLNV string to the stable template key used by the generator. */
function templateTypeOf(busType: unknown): string {
  if (typeof busType !== 'string' || !busType) {
    return 'custom';
  }
  return normalizeBusType(busType).templateType;
}

/**
 * Extract only the memory-mapped bus protocol types from a busInterfaces array.
 *
 * We intentionally exclude streaming (axis, avst) and conduit (custom) from
 * the round-trip comparison because:
 *
 * - component.xml: the ComponentXmlParser heuristically re-classifies unknown
 *   bus types as AXI-Stream based on port names, so custom interfaces may
 *   round-trip as 'axis'. Known limitation, tracked separately.
 *
 * - hw.tcl: array bus interfaces are expanded into individual add_interface
 *   entries, so one original AXI-Stream array becomes N physical entries.
 *   Conduit (custom) interfaces become individual ports, not bus interfaces,
 *   in the parsed YAML. The hw.tcl format is lossy for non-MM buses.
 *
 * Memory-mapped protocols are the ones that drive vendor packaging and MUST survive
 * the round-trip faithfully — but the set differs per tool format (see constants above).
 */
function filterBusByTypes(busInterfaces: unknown[], allowed: Set<string>): string[] {
  return busInterfaces
    .filter((b) => b && typeof b === 'object')
    .map((b) => templateTypeOf((b as Record<string, unknown>).type))
    .filter((t) => allowed.has(t))
    .sort();
}

function loadOriginalYaml(yamlPath: string): Record<string, unknown> {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  return (jsYaml.load(raw) as Record<string, unknown>) ?? {};
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

let allFixtures: Fixture[] = [];

beforeAll(async () => {
  allFixtures = await generateFixtures();
}, 300_000);

// ---------------------------------------------------------------------------
// component.xml round-trip
// ---------------------------------------------------------------------------

describe('Vivado component.xml round-trip', () => {
  it('generates at least one Xilinx fixture', () => {
    expect(xilinxFixtures(allFixtures).length).toBeGreaterThan(0);
  });

  it('component name (vlnv.name) survives generate -> parse', () => {
    const xilinx = xilinxFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of xilinx) {
      const original = loadOriginalYaml(fixture.yamlPath);
      const expectedName = String(
        (original.vlnv as Record<string, unknown>)?.name ?? ''
      ).toLowerCase();
      if (!expectedName) {
        continue;
      }

      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      const xmlText = fs.readFileSync(xmlPath, 'utf8');
      const parsed = parseComponentXmlText(xmlText);
      const parsedYaml = jsYaml.load(parsed.ipYamlText) as Record<string, unknown>;
      const parsedName = String(
        (parsedYaml.vlnv as Record<string, unknown>)?.name ?? ''
      ).toLowerCase();

      if (parsedName !== expectedName) {
        failures.push(`${fixture.name}: expected name "${expectedName}", got "${parsedName}"`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`component.xml vlnv.name round-trip failures:\n\n${failures.join('\n')}`);
    }
  });

  it('AXI bus protocols survive generate -> parse (Avalon-MM excluded: not Vivado-native)', () => {
    const xilinx = xilinxFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of xilinx) {
      const original = loadOriginalYaml(fixture.yamlPath);
      const originalMm = filterBusByTypes(
        (original.busInterfaces as unknown[]) ?? [],
        VIVADO_MM_TYPES
      );
      if (originalMm.length === 0) {
        continue;
      }

      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      const xmlText = fs.readFileSync(xmlPath, 'utf8');
      const parsed = parseComponentXmlText(xmlText);
      const parsedYaml = jsYaml.load(parsed.ipYamlText) as Record<string, unknown>;
      const parsedMm = filterBusByTypes(
        (parsedYaml.busInterfaces as unknown[]) ?? [],
        VIVADO_MM_TYPES
      );

      if (JSON.stringify(originalMm) !== JSON.stringify(parsedMm)) {
        failures.push(
          `${fixture.name}: AXI bus protocols\n` +
            `  original: [${originalMm.join(', ')}]\n` +
            `  parsed:   [${parsedMm.join(', ')}]`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`component.xml AXI bus round-trip failures:\n\n${failures.join('\n\n')}`);
    }
  });

  it('memory-map registers survive generate -> parse (.mm.yml -> component.xml -> .mm.yml)', () => {
    const xilinx = xilinxFixtures(allFixtures);
    const failures: string[] = [];
    let emittedCount = 0;

    for (const fixture of xilinx) {
      const original = loadOriginalYaml(fixture.yamlPath);
      const memoryMaps = original.memoryMaps as Record<string, unknown> | undefined;
      const importRel =
        memoryMaps && typeof memoryMaps === 'object' ? memoryMaps.import : undefined;
      if (typeof importRel !== 'string') {
        continue;
      }
      const mmPath = path.join(path.dirname(fixture.yamlPath), importRel);
      if (!fs.existsSync(mmPath)) {
        continue;
      }
      const originalMaps = jsYaml.load(fs.readFileSync(mmPath, 'utf8')) as unknown[];
      const expectedLeaves = leafRegisterNames(originalMaps);
      if (expectedLeaves.length === 0) {
        continue;
      }

      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      const xmlText = fs.readFileSync(xmlPath, 'utf8');
      if (xmlText.includes('<spirit:memoryMaps>')) {
        emittedCount += 1;
      }

      const parsed = parseComponentXmlText(xmlText);
      if (!parsed.mmYamlText) {
        failures.push(`${fixture.name}: expected a non-empty memory map, parsed none`);
        continue;
      }
      const parsedNames = parsedRegisterNames(jsYaml.load(parsed.mmYamlText) as unknown[]);
      const missing = expectedLeaves.filter(
        (leaf) => !parsedNames.some((parsedName) => parsedName.includes(leaf))
      );
      if (missing.length > 0) {
        failures.push(
          `${fixture.name}: registers missing after round-trip: [${missing.join(', ')}]\n` +
            `  parsed: [${parsedNames.join(', ')}]`
        );
      }

      // No orphaned maps: every emitted <spirit:memoryMap> must be referenced by
      // a slave interface (Vivado IP_Flow 19-1980).
      const parsedIp = jsYaml.load(parsed.ipYamlText) as Record<string, unknown>;
      const referencedMaps = new Set(
        ((parsedIp.busInterfaces as Array<Record<string, unknown>>) ?? [])
          .map((b) => b.memoryMapRef)
          .filter((ref): ref is string => typeof ref === 'string')
      );
      const emittedMaps = ((jsYaml.load(parsed.mmYamlText) as Array<Record<string, unknown>>) ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string');
      const orphans = emittedMaps.filter((m) => !referencedMaps.has(m));
      if (orphans.length > 0) {
        failures.push(
          `${fixture.name}: memory maps not referenced by any bus interface: [${orphans.join(', ')}]`
        );
      }
    }

    expect(emittedCount).toBeGreaterThan(0);
    if (failures.length > 0) {
      throw new Error(`component.xml memory-map round-trip failures:\n\n${failures.join('\n\n')}`);
    }
  });
});

/**
 * Collect the names of every leaf register (the ones that carry fields, i.e.
 * the innermost register of a register array) across all maps/blocks. The
 * generator expands arrays into instances named like `<ARRAY>_<i>_<LEAF>`, so a
 * leaf name survives as a substring of at least one emitted register name.
 */
function leafRegisterNames(maps: unknown[]): string[] {
  const names: string[] = [];
  const visitReg = (reg: Record<string, unknown>): void => {
    const nested = reg.registers as unknown[] | undefined;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const child of nested) {
        visitReg(child as Record<string, unknown>);
      }
      return;
    }
    if (typeof reg.name === 'string') {
      names.push(reg.name);
    }
  };
  for (const map of maps) {
    const blocks = (map as Record<string, unknown>).addressBlocks as unknown[] | undefined;
    for (const block of blocks ?? []) {
      const regs = (block as Record<string, unknown>).registers as unknown[] | undefined;
      for (const reg of regs ?? []) {
        visitReg(reg as Record<string, unknown>);
      }
    }
  }
  return names;
}

/** Flat list of register names from a parsed .mm.yml (no nesting on this side). */
function parsedRegisterNames(maps: unknown[]): string[] {
  const names: string[] = [];
  for (const map of maps) {
    const blocks = (map as Record<string, unknown>).addressBlocks as unknown[] | undefined;
    for (const block of blocks ?? []) {
      const regs = (block as Record<string, unknown>).registers as unknown[] | undefined;
      for (const reg of regs ?? []) {
        const name = (reg as Record<string, unknown>).name;
        if (typeof name === 'string') {
          names.push(name);
        }
      }
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// hw.tcl round-trip
// ---------------------------------------------------------------------------

describe('Quartus hw.tcl round-trip', () => {
  it('generates at least one Altera fixture', () => {
    expect(alteraFixtures(allFixtures).length).toBeGreaterThan(0);
  });

  it('component name (vlnv.name) survives generate -> parse', async () => {
    const altera = alteraFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of altera) {
      const original = loadOriginalYaml(fixture.yamlPath);
      const expectedName = String(
        (original.vlnv as Record<string, unknown>)?.name ?? ''
      ).toLowerCase();
      if (!expectedName) {
        continue;
      }

      for (const tclPath of hwTclFiles(fixture)) {
        const result = await parseHwTclFile(tclPath);
        const parsedName = result.componentName.toLowerCase();

        if (parsedName !== expectedName) {
          failures.push(
            `${fixture.name} (${path.basename(tclPath)}): ` +
              `expected name "${expectedName}", got "${parsedName}"`
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`hw.tcl vlnv.name round-trip failures:\n\n${failures.join('\n')}`);
    }
  });

  it('memory-mapped bus protocols survive generate -> parse', async () => {
    const altera = alteraFixtures(allFixtures);
    const failures: string[] = [];

    for (const fixture of altera) {
      const original = loadOriginalYaml(fixture.yamlPath);
      const originalMm = filterBusByTypes(
        (original.busInterfaces as unknown[]) ?? [],
        QUARTUS_MM_TYPES
      );
      if (originalMm.length === 0) {
        continue;
      }

      for (const tclPath of hwTclFiles(fixture)) {
        const result = await parseHwTclFile(tclPath);
        const parsedYaml = jsYaml.load(result.yamlText) as Record<string, unknown>;
        const parsedMm = filterBusByTypes(
          (parsedYaml.busInterfaces as unknown[]) ?? [],
          QUARTUS_MM_TYPES
        );

        if (JSON.stringify(originalMm) !== JSON.stringify(parsedMm)) {
          failures.push(
            `${fixture.name} (${path.basename(tclPath)}): memory-mapped bus protocols\n` +
              `  original: [${originalMm.join(', ')}]\n` +
              `  parsed:   [${parsedMm.join(', ')}]`
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`hw.tcl MM bus round-trip failures:\n\n${failures.join('\n\n')}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-vendor structural consistency
// ---------------------------------------------------------------------------

const CROSS_VENDOR_MM_TYPES = new Set(['axil', 'axi4']);

describe('Cross-vendor structural consistency', () => {
  it('Vivado component.xml and Quartus hw.tcl declare the same VLNV name', async () => {
    const failures: string[] = [];

    for (const fixture of allFixtures) {
      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      const alteraDir = path.join(fixture.outputDir, 'altera');
      if (!fs.existsSync(xmlPath) || !fs.existsSync(alteraDir)) {
        continue;
      }
      const tclFiles = hwTclFiles(fixture);
      if (tclFiles.length === 0) {
        continue;
      }

      const xmlText = fs.readFileSync(xmlPath, 'utf8');
      const xmlParsed = parseComponentXmlText(xmlText);
      const xmlYaml = jsYaml.load(xmlParsed.ipYamlText) as Record<string, unknown>;
      const xmlName = String((xmlYaml.vlnv as Record<string, unknown>)?.name ?? '').toLowerCase();

      for (const tclPath of tclFiles) {
        const tclResult = await parseHwTclFile(tclPath);
        const tclName = tclResult.componentName.toLowerCase();

        if (xmlName !== tclName) {
          failures.push(
            `${fixture.name}: VLNV name mismatch\n` +
              `  component.xml: "${xmlName}"\n` +
              `  hw.tcl:        "${tclName}"`
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`Cross-vendor VLNV name mismatches:\n\n${failures.join('\n\n')}`);
    }
  });

  it('Vivado and Quartus declare the same memory-mapped bus protocols', async () => {
    const failures: string[] = [];

    for (const fixture of allFixtures) {
      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      const alteraDir = path.join(fixture.outputDir, 'altera');
      if (!fs.existsSync(xmlPath) || !fs.existsSync(alteraDir)) {
        continue;
      }
      const tclFiles = hwTclFiles(fixture);
      if (tclFiles.length === 0) {
        continue;
      }

      const xmlText = fs.readFileSync(xmlPath, 'utf8');
      const xmlParsed = parseComponentXmlText(xmlText);
      const xmlYaml = jsYaml.load(xmlParsed.ipYamlText) as Record<string, unknown>;
      const xmlMm = filterBusByTypes(
        (xmlYaml.busInterfaces as unknown[]) ?? [],
        CROSS_VENDOR_MM_TYPES
      );

      for (const tclPath of tclFiles) {
        const tclResult = await parseHwTclFile(tclPath);
        const tclYaml = jsYaml.load(tclResult.yamlText) as Record<string, unknown>;
        const tclMm = filterBusByTypes(
          (tclYaml.busInterfaces as unknown[]) ?? [],
          CROSS_VENDOR_MM_TYPES
        );

        if (JSON.stringify(xmlMm) !== JSON.stringify(tclMm)) {
          failures.push(
            `${fixture.name} (${path.basename(tclPath)}): MM bus protocols\n` +
              `  component.xml: [${xmlMm.join(', ')}]\n` +
              `  hw.tcl:        [${tclMm.join(', ')}]`
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`Cross-vendor MM bus mismatches:\n\n${failures.join('\n\n')}`);
    }
  });

  it('Vivado and Quartus declare the same parameter names', async () => {
    const failures: string[] = [];

    for (const fixture of allFixtures) {
      const xmlPath = path.join(fixture.outputDir, 'xilinx', 'component.xml');
      const alteraDir = path.join(fixture.outputDir, 'altera');
      if (!fs.existsSync(xmlPath) || !fs.existsSync(alteraDir)) {
        continue;
      }
      const tclFiles = hwTclFiles(fixture);
      if (tclFiles.length === 0) {
        continue;
      }

      const xmlText = fs.readFileSync(xmlPath, 'utf8');
      const xmlParsed = parseComponentXmlText(xmlText);
      const xmlYaml = jsYaml.load(xmlParsed.ipYamlText) as Record<string, unknown>;
      const xmlParams = ((xmlYaml.parameters as unknown[]) ?? [])
        .filter((p) => p && typeof p === 'object')
        .map((p) => String((p as Record<string, unknown>).name ?? '').toLowerCase())
        .sort();

      for (const tclPath of tclFiles) {
        const tclResult = await parseHwTclFile(tclPath);
        const tclYaml = jsYaml.load(tclResult.yamlText) as Record<string, unknown>;
        const tclParams = ((tclYaml.parameters as unknown[]) ?? [])
          .filter((p) => p && typeof p === 'object')
          .map((p) => String((p as Record<string, unknown>).name ?? '').toLowerCase())
          .sort();

        if (JSON.stringify(xmlParams) !== JSON.stringify(tclParams)) {
          failures.push(
            `${fixture.name} (${path.basename(tclPath)}): parameter names\n` +
              `  component.xml: [${xmlParams.join(', ')}]\n` +
              `  hw.tcl:        [${tclParams.join(', ')}]`
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`Cross-vendor parameter mismatches:\n\n${failures.join('\n\n')}`);
    }
  });
});
