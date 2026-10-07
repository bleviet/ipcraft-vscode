import * as yaml from 'yaml';
import { collectHexSpellings, serializeEdit } from '../../yamledit';

/**
 * Single source of truth for legacy snake_case spellings of `.ip.yml` / `.mm.yml` keys.
 * Runtime code reads camelCase only; `ipcraft migrate` uses this module to convert old files.
 */

type RenameTable = Readonly<Record<string, string>>;

const FIELD_KEYS: RenameTable = {
  bit_offset: 'offset',
  bit_width: 'width',
  bit_range: 'bitRange',
  reset_value: 'resetValue',
  // `enumeratedValues` is an opaque map of enum name -> description; its entries are never renamed.
  enumerated_values: 'enumeratedValues',
  monitor_change_of: 'monitorChangeOf',
};
const REGISTER_KEYS: RenameTable = { address_offset: 'offset', reset_value: 'resetValue' };
const BLOCK_KEYS: RenameTable = {
  base_address: 'baseAddress',
  default_reg_width: 'defaultRegWidth',
};
const MEMORY_MAP_KEYS: RenameTable = { address_blocks: 'addressBlocks' };
const IP_CORE_KEYS: RenameTable = { memory_maps: 'memoryMaps', file_sets: 'fileSets' };
const BUS_KEYS: RenameTable = {
  use_optional_ports: 'useOptionalPorts',
  port_width_overrides: 'portWidthOverrides',
  port_name_overrides: 'portNameOverrides',
  absent_ports: 'absentPorts',
  conduit_ports: 'conduitPorts',
  physical_prefix: 'physicalPrefix',
  associated_clock: 'associatedClock',
  associated_reset: 'associatedReset',
};
const BUS_ARRAY_KEYS: RenameTable = {
  index_start: 'indexStart',
  naming_pattern: 'namingPattern',
  physical_prefix_pattern: 'physicalPrefixPattern',
};
const CLOCK_KEYS: RenameTable = { associated_reset: 'associatedReset' };
const RESET_KEYS: RenameTable = { associated_clock: 'associatedClock' };

function keyName(pair: yaml.Pair): string | undefined {
  return yaml.isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : undefined;
}

/** Rename legacy keys on one map node. A legacy pair is dropped when its canonical key exists. */
function renameInMap(map: yaml.YAMLMap, table: RenameTable): number {
  let count = 0;
  for (const pair of [...map.items]) {
    const name = keyName(pair);
    const canonical = name === undefined ? undefined : table[name];
    if (canonical === undefined) {
      continue;
    }
    count++;
    if (map.has(canonical)) {
      map.items.splice(map.items.indexOf(pair), 1);
    } else {
      (pair.key as yaml.Scalar).value = canonical;
    }
  }
  return count;
}

function forEachMapItem(node: unknown, visit: (item: yaml.YAMLMap) => number): number {
  let count = 0;
  if (yaml.isSeq(node)) {
    for (const item of node.items) {
      if (yaml.isMap(item)) {
        count += visit(item);
      }
    }
  }
  return count;
}

function renameRegister(register: yaml.YAMLMap): number {
  return (
    renameInMap(register, REGISTER_KEYS) +
    forEachMapItem(register.get('fields', true), (f) => renameInMap(f, FIELD_KEYS)) +
    // Register arrays nest template registers under `registers`.
    forEachMapItem(register.get('registers', true), renameRegister)
  );
}

function renameBlock(block: yaml.YAMLMap): number {
  return (
    renameInMap(block, BLOCK_KEYS) + forEachMapItem(block.get('registers', true), renameRegister)
  );
}

function renameMemoryMapNode(map: yaml.YAMLMap): number {
  return (
    renameInMap(map, MEMORY_MAP_KEYS) + forEachMapItem(map.get('addressBlocks', true), renameBlock)
  );
}

/** A memory map file root: a single map, a list of maps, or a wrapper holding `memoryMaps`. */
function renameMemoryMapRoot(root: unknown): number {
  if (yaml.isSeq(root)) {
    return forEachMapItem(root, renameMemoryMapNode);
  }
  if (!yaml.isMap(root)) {
    return 0;
  }
  const isWrapper = root.has('memory_maps') || root.has('memoryMaps');
  if (!isWrapper) {
    return renameMemoryMapNode(root);
  }
  const count = renameInMap(root, { memory_maps: 'memoryMaps' });
  return count + forEachMapItem(root.get('memoryMaps', true), renameMemoryMapNode);
}

function renameBus(bus: yaml.YAMLMap): number {
  const array = bus.get('array', true);
  return renameInMap(bus, BUS_KEYS) + (yaml.isMap(array) ? renameInMap(array, BUS_ARRAY_KEYS) : 0);
}

function renameIpCoreRoot(root: unknown): number {
  if (!yaml.isMap(root)) {
    return 0;
  }
  return (
    renameInMap(root, IP_CORE_KEYS) +
    forEachMapItem(root.get('busInterfaces', true), renameBus) +
    forEachMapItem(root.get('clocks', true), (c) => renameInMap(c, CLOCK_KEYS)) +
    forEachMapItem(root.get('resets', true), (r) => renameInMap(r, RESET_KEYS)) +
    // Only inline maps; `import` entries live in their own file.
    forEachMapItem(root.get('memoryMaps', true), (m) =>
      m.has('import') ? 0 : renameMemoryMapNode(m)
    )
  );
}

/**
 * Rename legacy snake_case keys to canonical camelCase in place, on known node shapes only.
 * Key order, comments and hex spellings survive. Returns the original text when nothing
 * was renamed. If a canonical key already exists on the node, the legacy pair is deleted.
 */
export function renameLegacyKeys(
  text: string,
  kind: 'ipCore' | 'memoryMap'
): { text: string; renamedCount: number } {
  const doc = yaml.parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(`Invalid YAML: ${doc.errors[0].message}`);
  }
  const hexFix = collectHexSpellings(doc);
  const renamedCount =
    kind === 'ipCore' ? renameIpCoreRoot(doc.contents) : renameMemoryMapRoot(doc.contents);
  if (renamedCount === 0) {
    return { text, renamedCount };
  }
  return {
    text: serializeEdit(text, doc, hexFix),
    renamedCount,
  };
}
