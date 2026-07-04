import * as fs from 'fs';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import { Logger } from '../utils/Logger';

export class TemplateLoader {
  private readonly logger: Logger;
  private readonly env: nunjucks.Environment;
  private readonly templatesPath: string;
  private readonly searchPaths: string[];

  /**
   * @param templatesPath  Single path or ordered list of search paths.
   *   When a list is given, each path is searched in order — first match wins.
   *   This allows a scaffold pack directory to shadow built-in templates.
   */
  constructor(logger: Logger, templatesPath: string | string[]) {
    this.logger = logger;

    const paths: string[] = Array.isArray(templatesPath) ? templatesPath : [templatesPath];
    this.searchPaths = paths;

    // Canonical path used for logging; multi-root shows all paths joined.
    this.templatesPath = paths.join(path.delimiter);

    this.env = new nunjucks.Environment(new nunjucks.FileSystemLoader(paths, { noCache: true }), {
      autoescape: false,
      trimBlocks: true,
      lstripBlocks: true,
    });

    this.env.addFilter('format', (format: string, value: unknown) => {
      if (typeof format !== 'string') {
        return String(value ?? '');
      }
      const match = format.match(/%(-)?(0)?(\d+)?([sXx])/);
      if (!match) {
        return String(value ?? '');
      }
      const leftAlign = Boolean(match[1]);
      const zeroPad = Boolean(match[2]);
      const width = match[3] ? Number.parseInt(match[3], 10) : 0;
      const type = match[4];

      let rendered = '';
      if (type === 's') {
        rendered = String(value ?? '');
      } else if (type === 'X' || type === 'x') {
        const num = Number(value ?? 0);
        rendered = Number.isFinite(num) ? Math.trunc(num).toString(16) : '0';
        if (type === 'X') {
          rendered = rendered.toUpperCase();
        }
      }

      if (width > 0 && rendered.length < width) {
        const padChar = zeroPad && !leftAlign ? '0' : ' ';
        const padding = padChar.repeat(width - rendered.length);
        rendered = leftAlign ? `${rendered}${padding}` : `${padding}${rendered}`;
      }

      return rendered;
    });

    this.env.addFilter(
      'selectattr',
      (items: unknown, attribute: string, operator: string, compare: unknown) => {
        const list = (Array.isArray(items) ? items : []) as unknown[];
        return list.filter((item) => {
          const value =
            item && typeof item === 'object'
              ? (item as Record<string, unknown>)[attribute]
              : undefined;
          if (operator === 'equalto') {
            return value === compare;
          }
          if (operator === 'in') {
            return Array.isArray(compare) ? compare.includes(value as never) : false;
          }
          return false;
        });
      }
    );

    this.env.addFilter('list', (items: unknown) => {
      return (Array.isArray(items) ? items : []) as unknown[];
    });

    this.logger.info(`Template loader using ${this.templatesPath}`);
  }

  getTemplatesPath(): string {
    return this.templatesPath;
  }

  /**
   * True when `templateName` resolves to a file somewhere in the search paths
   * (pack dir first, built-in dir last — same order `render` uses). Lets
   * callers whose output isn't itself template-driven (e.g. component.xml,
   * built programmatically) still support the "drop a same-named .j2 in the
   * pack directory" override convention: check this first, and if true,
   * render the override instead of running the built-in generator.
   */
  hasTemplate(templateName: string): boolean {
    return this.searchPaths.some((searchPath) =>
      fs.existsSync(path.join(searchPath, templateName))
    );
  }

  render(templateName: string, context: Record<string, unknown>): string {
    return this.env.render(templateName, context);
  }

  /**
   * Render an inline Nunjucks template string against `context`.
   * Used to evaluate scaffold.yml `source` and `target` expressions such as
   * `"rtl/{{ name }}_{{ bus_type }}.vhd"`.
   */
  renderString(template: string, context: Record<string, unknown>): string {
    return this.env.renderString(template, context);
  }

  /**
   * Evaluate a Nunjucks boolean expression string against `context`.
   * Returns true when the expression is absent or renders to `"true"`.
   * Safe: uses the Nunjucks sandbox, not eval().
   *
   * Example: `evaluateCondition("has_memory_mapped_slave and not is_systemverilog", ctx)`
   */
  evaluateCondition(condition: string | undefined, context: Record<string, unknown>): boolean {
    if (!condition) {
      return true;
    }
    try {
      const result = this.env
        .renderString(`{% if ${condition} %}true{% else %}false{% endif %}`, context)
        .trim();
      return result === 'true';
    } catch {
      return false;
    }
  }
}
