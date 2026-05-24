import yaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { ExtensionError } from '../utils/ErrorHandler';

/**
 * Result of YAML validation
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Service responsible for validating YAML content
 */
export class YamlValidator {
  private readonly logger = new Logger('YamlValidator');

  /**
   * Finds bus interfaces in an IP core document that share the same physicalPrefix.
   * Duplicate prefixes cause conflicting port names in generated HDL.
   *
   * @param data Parsed YAML object (result of validate/parse)
   * @returns Array of `{ prefix, interfaces }` objects, one per duplicated prefix.
   *          Empty when all prefixes are unique or when the data has no bus interfaces.
   */
  findDuplicatePhysicalPrefixes(data: unknown): Array<{ prefix: string; interfaces: string[] }> {
    if (!data || typeof data !== 'object') {
      return [];
    }
    const raw = data as Record<string, unknown>;
    const busInterfaces = (raw.busInterfaces ?? raw.bus_interfaces) as unknown[] | undefined;
    if (!Array.isArray(busInterfaces) || busInterfaces.length === 0) {
      return [];
    }

    const prefixMap = new Map<string, string[]>();
    for (const bus of busInterfaces) {
      if (!bus || typeof bus !== 'object') {
        continue;
      }
      const b = bus as Record<string, unknown>;
      const name = String(b.name ?? '');
      const prefix = String(b.physicalPrefix ?? b.physical_prefix ?? '');
      if (!prefix) {
        continue;
      }
      if (!prefixMap.has(prefix)) {
        prefixMap.set(prefix, []);
      }
      prefixMap.get(prefix)!.push(name);
    }

    const duplicates: Array<{ prefix: string; interfaces: string[] }> = [];
    for (const [prefix, names] of prefixMap) {
      if (names.length > 1) {
        duplicates.push({ prefix, interfaces: names });
      }
    }
    return duplicates;
  }

  /**
   * Validate YAML text
   * @param text The YAML text to validate
   * @returns Validation result with parsed data if valid
   */
  validate(text: string): ValidationResult {
    try {
      const data = yaml.load(text);
      this.logger.debug('YAML validation successful');
      return {
        valid: true,
        data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('YAML validation failed', message);
      return {
        valid: false,
        error: message,
      };
    }
  }

  /**
   * Parse YAML text, throwing an error if invalid
   * @param text The YAML text to parse
   * @returns Parsed YAML data
   * @throws ExtensionError if YAML is invalid
   */
  parse(text: string): unknown {
    try {
      return yaml.load(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtensionError(`YAML parse error: ${message}`, 'YAML_PARSE_ERROR', 'error');
    }
  }

  /**
   * Serialize data to YAML string
   * @param data The data to serialize
   * @returns YAML string
   */
  dump(data: unknown): string {
    try {
      return yaml.dump(data, { noRefs: true, sortKeys: false, lineWidth: -1, indent: 2 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('YAML serialization failed', error instanceof Error ? error : undefined);
      throw new ExtensionError(`Failed to serialize YAML: ${message}`, 'YAML_DUMP_ERROR', 'error');
    }
  }
}
