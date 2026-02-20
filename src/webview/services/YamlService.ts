import jsyaml from 'js-yaml';
import { formatBitsLike } from '../utils/BitFieldUtils';

/**
 * Service for YAML serialization and parsing operations
 */
export class YamlService {
  /**
   * Dump a JavaScript object to YAML string.
   * NOTE: This will not preserve comments or formatting from the original YAML.
   */
  static dump(data: unknown): string {
    const cleaned = YamlService.cleanForYaml(data);
    return jsyaml.dump(cleaned, { noRefs: true, sortKeys: false, lineWidth: -1, indent: 2 });
  }

  /**
   * Parse a YAML string to a JavaScript value.
   */
  static parse(text: string): unknown {
    return jsyaml.load(text);
  }

  /**
   * Safely parse YAML text, returning null on error.
   */
  static safeParse(text: string): unknown | null {
    try {
      return jsyaml.load(text);
    } catch (err) {
      console.warn('YAML parse error:', err);
      return null;
    }
  }

  /**
   * Clean object before YAML serialization.
   * Removes computed properties that shouldn't be in the YAML output.
   */
  static cleanForYaml(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => YamlService.cleanForYaml(item));
    }

    const record = obj as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    // Check if we need to convert bit_offset/bit_width to bits
    const hasBitOffset = Object.prototype.hasOwnProperty.call(record, 'bit_offset');
    const hasBitWidth = Object.prototype.hasOwnProperty.call(record, 'bit_width');
    const shouldAddBits = hasBitOffset && hasBitWidth;

    let bitsValue: string | undefined;
    if (shouldAddBits) {
      const bit_offset = Number(record['bit_offset']);
      const bit_width = Number(record['bit_width']);

      if (Number.isFinite(bit_offset) && Number.isFinite(bit_width)) {
        bitsValue = formatBitsLike(bit_offset, bit_width);
      }
    }

    // Iterate through properties in original order, inserting bits after name
    let nameProcessed = false;
    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        continue;
      }

      // Skip internal bit field representation - we'll add 'bits' instead
      if (key === 'bit_offset' || key === 'bit_width' || key === 'bit_range') {
        continue;
      }

      // Add the property
      cleaned[key] = YamlService.cleanForYaml(record[key]);

      // After adding 'name', insert 'bits' if needed
      if (key === 'name' && !nameProcessed && bitsValue) {
        cleaned['bits'] = bitsValue;
        nameProcessed = true;
      }
    }

    // If we didn't encounter 'name' but still need to add bits, add it now
    if (shouldAddBits && bitsValue && !nameProcessed) {
      // Insert bits at the beginning by recreating the object
      const temp = { bits: bitsValue, ...cleaned };
      return temp;
    }

    return cleaned;
  }
}
