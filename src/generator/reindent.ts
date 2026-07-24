import * as path from 'path';

export type IndentStyle = 'spaces' | 'tab';

export const DEFAULT_INDENT_STYLE: IndentStyle = 'spaces';
export const DEFAULT_INDENT_SIZE = 2;

/**
 * Number of spaces per indentation level literally baked into every `.j2` template's source
 * today. Distinct from DEFAULT_INDENT_SIZE (the `indentSize` setting's default value) even
 * though both happen to be 2 — this one is a fact about the template files, not about user
 * configuration, and must not change just because the setting's default does.
 */
const TEMPLATE_INDENT_UNIT_SIZE = 2;

const REINDENTED_EXTENSIONS = new Set([
  '.vhd',
  '.vhdl',
  '.v',
  '.vh',
  '.sv',
  '.svh',
  '.tcl',
  '.xdc',
  '.sdc',
]);

export function createIndentUnit(style: IndentStyle, size: number): string {
  if (style === 'tab') {
    return '\t';
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Indent size must be a positive integer, received ${size}`);
  }
  return ' '.repeat(size);
}

/**
 * Replace each canonical two-space indentation unit while retaining a trailing
 * alignment space on lines whose leading whitespace is not an exact multiple
 * of two.
 */
export function reindentSource(text: string, unit: string): string {
  if (unit === ' '.repeat(TEMPLATE_INDENT_UNIT_SIZE)) {
    return text;
  }
  return text.replace(/^ +/gm, (leadingSpaces) => {
    const level = Math.floor(leadingSpaces.length / TEMPLATE_INDENT_UNIT_SIZE);
    const remainder = leadingSpaces.length % TEMPLATE_INDENT_UNIT_SIZE;
    return unit.repeat(level) + ' '.repeat(remainder);
  });
}

export function shouldReindentSource(filePath: string): boolean {
  return REINDENTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function reindentGeneratedSources(
  files: Readonly<Record<string, string>>,
  style: IndentStyle,
  size: number
): Record<string, string> {
  const unit = createIndentUnit(style, size);
  return Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      shouldReindentSource(filePath) ? reindentSource(content, unit) : content,
    ])
  );
}
