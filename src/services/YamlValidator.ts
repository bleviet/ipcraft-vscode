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
