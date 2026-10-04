import * as yaml from 'yaml';
import { collectHexSpellings, detectIndentSeq, restoreHexSpellings } from '../../yamledit';
import { applyYamlMutation, canonicalizeParsedIpCore } from '../busContracts/ipCoreCanonicalize';
import type { NormalizedBusLibrary } from '../busContracts/types';
import {
  IP_CORE_FORMAT_VERSION,
  IP_CORE_FORMAT_VERSIONS,
  readIpCoreFormatVersion,
  type IpCoreFormatVersion,
} from './version';

interface StepResult {
  text: string;
  mutationCount: number;
}

interface MigrationStep {
  from: IpCoreFormatVersion;
  to: IpCoreFormatVersion;
  migrate(text: string, parsed: Record<string, unknown>, library: NormalizedBusLibrary): StepResult;
}

/** Ordered chain; each step upgrades a file from `from` to the next version `to`. */
const MIGRATION_STEPS: readonly MigrationStep[] = [
  {
    // 1.1 introduced bus interface contracts (e.g. Avalon-MM `*_n` ports become polarity overrides).
    from: '1.0',
    to: '1.1',
    migrate(text, parsed, library) {
      const { mutations } = canonicalizeParsedIpCore(parsed, library);
      return {
        text: mutations.reduce(applyYamlMutation, text),
        mutationCount: mutations.length,
      };
    },
  },
];

/**
 * Set `apiVersion`: edited in place when declared, otherwise inserted right after `vlnv`
 * (at the top without one), single-quoted. Other formatting and comments are untouched.
 */
function stampApiVersion(text: string): string {
  const doc: yaml.Document = yaml.parseDocument(text);
  const root = doc.contents;
  const hexFix = collectHexSpellings(doc);
  const serialize = (): string =>
    restoreHexSpellings(doc.toString({ indentSeq: detectIndentSeq(text), lineWidth: 0 }), hexFix);
  if (!yaml.isMap(root)) {
    throw new Error('Invalid YAML: must be an object');
  }
  const existing = root.get('apiVersion', true);
  if (yaml.isScalar(existing)) {
    existing.value = IP_CORE_FORMAT_VERSION;
    return serialize();
  }
  const version = new yaml.Scalar(IP_CORE_FORMAT_VERSION);
  version.type = 'QUOTE_SINGLE';
  const vlnvIndex = root.items.findIndex(
    (pair) => yaml.isScalar(pair.key) && pair.key.value === 'vlnv'
  );
  root.items.splice(vlnvIndex + 1, 0, doc.createPair('apiVersion', version));
  return serialize();
}

export interface IpCoreMigrationResult {
  text: string;
  changed: boolean;
  fromVersion: IpCoreFormatVersion;
  toVersion: IpCoreFormatVersion;
  /** Content changes made by the steps, plus one for stamping `apiVersion`. */
  mutationCount: number;
}

/**
 * Whether a file declared at `version` has migration steps left to run. Pure; lets callers
 * (the editor) decide without parsing twice.
 */
export function isBehindLatestFormat(version: IpCoreFormatVersion): boolean {
  return version !== IP_CORE_FORMAT_VERSION;
}

/**
 * Upgrade the whole document to the latest format version in one format-preserving pass:
 * run the steps from the file's version, then set `apiVersion`. A file already at the latest
 * version is returned unchanged; a newer or unknown version throws.
 */
export function migrateIpCoreYaml(
  text: string,
  library: NormalizedBusLibrary
): IpCoreMigrationResult {
  const parsed = yaml.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid YAML: must be an object');
  }

  const read = readIpCoreFormatVersion(parsed as Record<string, unknown>);
  if (!read.ok) {
    throw new Error(read.message);
  }
  const fromVersion = read.version;
  if (!isBehindLatestFormat(fromVersion)) {
    return {
      text,
      changed: false,
      fromVersion,
      toVersion: fromVersion,
      mutationCount: 0,
    };
  }

  let migrated = text;
  let mutationCount = 0;
  let data = parsed as Record<string, unknown>;
  for (const step of MIGRATION_STEPS.slice(IP_CORE_FORMAT_VERSIONS.indexOf(fromVersion))) {
    const result = step.migrate(migrated, data, library);
    migrated = result.text;
    mutationCount += result.mutationCount;
    data = yaml.parse(migrated) as Record<string, unknown>;
  }
  migrated = stampApiVersion(migrated);
  return {
    text: migrated,
    changed: true,
    fromVersion,
    toVersion: IP_CORE_FORMAT_VERSION,
    mutationCount: mutationCount + 1,
  };
}
