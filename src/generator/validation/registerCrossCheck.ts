/**
 * Memory-map/register arm of the Consistency Check (issue #96's second scoped-out area):
 * diffs the .ip.yml's resolved .mm.yml memory map(s) against the register/field data a Vivado
 * component.xml declares, emitting missing/extra registers and fields plus address and bit-range
 * drift. Deliberately Vivado-only — Platform Designer's _hw.tcl carries no register/memory-map
 * data (bus interfaces only), so there is nothing to diff there.
 *
 * Address blocks are matched by name between the two sides; a block present on only one side is
 * skipped rather than flagged — block-level (as opposed to register/field-level) drift is out of
 * scope for this pass. Register arrays (`__kind: 'array'`) are expanded via the same
 * flattenRegisters formula VivadoComponentXmlGenerator uses to emit component.xml, so the SSOT's
 * array-expanded names (`NAME_0`, `NAME_1`, ...) line up with the vendor's already-flat imported
 * registers.
 */

import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { resolveMemoryMapImports } from '../../services/imports/resolveMemoryMapImports';
import { normalizeMemoryMap } from '../../domain/parse';
import type {
  NormalizedMemoryMap,
  NormalizedField,
  NormalizedRegister,
} from '../../domain/internal.types';
import { flattenRegisters, type FlatRegister } from '../VivadoComponentXmlGenerator';
import type { IpCoreData } from '../types';
import { SEVERITY_BY_KIND, type HdlCrossCheckKind, type HdlCrossCheckFinding } from './types';

/**
 * Resolves the .ip.yml's memoryMaps (legacy `{ import }` shortcut or per-entry imports) into
 * normalized maps, using an injectable readFile so this stays testable the same way the port/
 * parameter diffs are — mirrors registerProcessor.ts's resolveMemoryMaps, but that helper hardcodes
 * fs.readFile internally rather than accepting an override.
 */
async function resolveSsotMemoryMaps(
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  readFile: (absPath: string) => Promise<string>
): Promise<NormalizedMemoryMap[]> {
  const { resolved } = await resolveMemoryMapImports({
    memoryMaps: ipCoreData.memoryMaps,
    baseDir: ipCoreDir,
    reader: { readText: readFile },
  });
  return resolved.map((raw) => normalizeMemoryMap(raw));
}

/**
 * A vendor .mm.yml (ComponentXmlParser's mmYamlText) is a top-level array of memory maps —
 * parseMemoryMap (domain/parse.ts) only ever returns the first, so this normalizes every entry
 * directly instead.
 */
function normalizeVendorMemoryMaps(mmYamlText: string): NormalizedMemoryMap[] {
  const parsed: unknown = yaml.load(mmYamlText);
  const rawMaps: Record<string, unknown>[] = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : parsed && typeof parsed === 'object'
      ? [parsed as Record<string, unknown>]
      : [];
  return rawMaps.map((raw) => normalizeMemoryMap(raw));
}

function keyByName<T extends { name: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.name.toLowerCase(), item);
  }
  return map;
}

/**
 * Pairs SSOT and vendor memory maps by name; if neither side has a name match but each side
 * resolves to exactly one map, pairs that lone pair anyway — a renamed single map is still worth
 * comparing rather than silently skipping (mirrors selectTopLevelFiles's "check anyway when
 * ambiguous rather than go silent" philosophy in hdlCrossCheck.ts).
 */
function pairMemoryMaps(
  ssotMaps: NormalizedMemoryMap[],
  vendorMaps: NormalizedMemoryMap[]
): Array<{ ssot: NormalizedMemoryMap; vendor: NormalizedMemoryMap }> {
  const vendorByName = keyByName(vendorMaps);
  const pairs: Array<{ ssot: NormalizedMemoryMap; vendor: NormalizedMemoryMap }> = [];

  for (const ssot of ssotMaps) {
    const vendor = vendorByName.get(ssot.name.toLowerCase());
    if (vendor) {
      pairs.push({ ssot, vendor });
    }
  }

  if (pairs.length === 0 && ssotMaps.length === 1 && vendorMaps.length === 1) {
    pairs.push({ ssot: ssotMaps[0], vendor: vendorMaps[0] });
  }

  return pairs;
}

function flattenBlockRegisters(block: {
  defaultRegWidth: number;
  registers: NormalizedRegister[];
}): FlatRegister[] {
  const regWidth = block.defaultRegWidth > 0 ? block.defaultRegWidth : 32;
  const defaultRegBytes = Math.max(1, Math.floor(regWidth / 8));
  const flat: FlatRegister[] = [];
  flattenRegisters(block.registers ?? [], 0, '', defaultRegBytes, flat);
  return flat;
}

function diffFields(
  expectedFields: NormalizedField[],
  vendorFields: NormalizedField[],
  ipYmlPath: (string | number)[],
  sourceFile: string,
  mapName: string,
  source: HdlCrossCheckFinding['source']
): HdlCrossCheckFinding[] {
  const findings: HdlCrossCheckFinding[] = [];
  const vendorByName = keyByName(vendorFields);
  const matched = new Set<string>();

  const push = (kind: HdlCrossCheckKind, message: string, path: (string | number)[]): void => {
    findings.push({
      kind,
      message,
      ipYmlPath: path,
      hdlFile: sourceFile,
      hdlEntity: mapName,
      severity: SEVERITY_BY_KIND[kind],
      source,
    });
  };

  for (const field of expectedFields) {
    const key = field.name.toLowerCase();
    const vendorField = vendorByName.get(key);
    const fieldPath = [...ipYmlPath, 'fields', field.name];
    if (!vendorField) {
      push(
        'missing-field',
        `Field '${field.name}' (bits ${field.bits}) is declared in the .mm.yml but has no ` +
          `matching field in ${sourceFile}.`,
        fieldPath
      );
      continue;
    }
    matched.add(key);

    if (field.offset !== vendorField.offset || field.width !== vendorField.width) {
      push(
        'field-range-mismatch',
        `Field '${field.name}' is declared bits ${field.bits} in the .mm.yml but bits ` +
          `${vendorField.bits} in ${sourceFile}.`,
        fieldPath
      );
    }
  }

  for (const field of vendorFields) {
    const key = field.name.toLowerCase();
    if (matched.has(key)) {
      continue;
    }
    push(
      'extra-field',
      `Field '${field.name}' (bits ${field.bits}) exists in ${sourceFile} but is not declared ` +
        `in the .mm.yml.`,
      [...ipYmlPath, 'fields', field.name]
    );
  }

  return findings;
}

function diffRegisters(
  expectedRegs: FlatRegister[],
  vendorRegs: FlatRegister[],
  ipYmlPath: (string | number)[],
  sourceFile: string,
  mapName: string,
  source: HdlCrossCheckFinding['source']
): HdlCrossCheckFinding[] {
  const findings: HdlCrossCheckFinding[] = [];
  const vendorByName = keyByName(vendorRegs);
  const matched = new Set<string>();

  const push = (kind: HdlCrossCheckKind, message: string, path: (string | number)[]): void => {
    findings.push({
      kind,
      message,
      ipYmlPath: path,
      hdlFile: sourceFile,
      hdlEntity: mapName,
      severity: SEVERITY_BY_KIND[kind],
      source,
    });
  };

  for (const reg of expectedRegs) {
    const key = reg.name.toLowerCase();
    const vendorReg = vendorByName.get(key);
    const regPath = [...ipYmlPath, 'registers', reg.name];
    if (!vendorReg) {
      push(
        'missing-register',
        `Register '${reg.name}' is declared in the .mm.yml but has no matching register in ` +
          `${sourceFile}.`,
        regPath
      );
      continue;
    }
    matched.add(key);

    if (reg.offset !== vendorReg.offset) {
      push(
        'register-address-mismatch',
        `Register '${reg.name}' is declared at offset 0x${reg.offset.toString(16)} in the ` +
          `.mm.yml but 0x${vendorReg.offset.toString(16)} in ${sourceFile}.`,
        regPath
      );
    }

    findings.push(
      ...diffFields(reg.fields, vendorReg.fields, regPath, sourceFile, mapName, source)
    );
  }

  for (const reg of vendorRegs) {
    const key = reg.name.toLowerCase();
    if (matched.has(key)) {
      continue;
    }
    push(
      'extra-register',
      `Register '${reg.name}' exists in ${sourceFile} but is not declared in the .mm.yml.`,
      [...ipYmlPath, 'registers', reg.name]
    );
  }

  return findings;
}

/** Pure comparator: diffs two already-normalized memory-map lists. Exported for direct unit testing. */
export function diffMemoryMaps(
  ssotMaps: NormalizedMemoryMap[],
  vendorMaps: NormalizedMemoryMap[],
  sourceFile: string,
  source: HdlCrossCheckFinding['source']
): HdlCrossCheckFinding[] {
  const findings: HdlCrossCheckFinding[] = [];

  for (const { ssot, vendor } of pairMemoryMaps(ssotMaps, vendorMaps)) {
    const vendorBlocksByName = keyByName(vendor.addressBlocks);
    for (const block of ssot.addressBlocks) {
      const vendorBlock = vendorBlocksByName.get(block.name.toLowerCase());
      if (!vendorBlock) {
        continue;
      }
      const expectedFlat = flattenBlockRegisters(block);
      const vendorFlat = flattenBlockRegisters(vendorBlock);
      findings.push(
        ...diffRegisters(
          expectedFlat,
          vendorFlat,
          ['memoryMaps', ssot.name, 'addressBlocks', block.name],
          sourceFile,
          ssot.name,
          source
        )
      );
    }
  }

  return findings;
}

/**
 * Resolves the .ip.yml's memory maps and diffs them against a Vivado component.xml's parsed
 * register/field data. Returns no findings when the .ip.yml declares no memoryMaps at all (an
 * un-mapped core isn't "drifted") or when nothing resolves.
 */
export async function crossCheckMemoryMapsAgainstVendor(
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  vendorMmYamlText: string,
  sourceFile: string,
  source: HdlCrossCheckFinding['source'],
  readFile: (absPath: string) => Promise<string> = (p) => fs.readFile(p, 'utf8')
): Promise<HdlCrossCheckFinding[]> {
  if (!ipCoreData.memoryMaps) {
    return [];
  }
  const ssotMaps = await resolveSsotMemoryMaps(ipCoreData, ipCoreDir, readFile);
  if (ssotMaps.length === 0) {
    return [];
  }
  const vendorMaps = normalizeVendorMemoryMaps(vendorMmYamlText);
  return diffMemoryMaps(ssotMaps, vendorMaps, sourceFile, source);
}
