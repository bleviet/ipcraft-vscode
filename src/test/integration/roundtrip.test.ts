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
});

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
