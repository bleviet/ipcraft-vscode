import jsyaml from 'js-yaml';

import {
  applyPathEdits as sharedApplyPathEdits,
  type PathEdit as SharedPathEdit,
} from '../../yamledit';
import { serializeValue } from '../../domain/serialize';

/** A single path-targeted edit for {@link YamlService.applyPathEdits}. */
export interface PathEdit {
  path: (string | number)[];
  value: unknown;
}

/**
 * Service for YAML serialization and parsing operations
 */
export class YamlService {
  /**
   * Apply path-targeted edits to YAML text while preserving the formatting
   * and comments of everything that is not touched.
   */
  static applyPathEdits(text: string, edits: PathEdit[]): string {
    const cleaned: SharedPathEdit[] = edits.map(({ path, value }) => ({
      path,
      value: YamlService.cleanForYaml(value),
    }));
    return sharedApplyPathEdits(text, cleaned);
  }

  /**
   * Dump a JavaScript object to YAML string.
   * NOTE: This will not preserve comments or formatting from the original YAML.
   */
  static dump(data: unknown): string {
    const cleaned = YamlService.cleanForYaml(data);
    return jsyaml.dump(cleaned, {
      noRefs: true,
      sortKeys: false,
      lineWidth: -1,
      indent: 2,
      noArrayIndent: true,
    });
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
    return serializeValue(obj);
  }
}
