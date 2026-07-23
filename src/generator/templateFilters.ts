/**
 * Pure Nunjucks filter implementations shared by built-in and scaffold-pack
 * templates. Kept free of any nunjucks/Environment dependency so each filter
 * can be unit tested directly; TemplateLoader registers them.
 */

/**
 * Split an identifier into its constituent words, handling camelCase,
 * PascalCase, ACRONYM runs, and `-`/`_`/`.`/space separators.
 *
 * Examples: "genIrqHandler" -> ["gen", "Irq", "Handler"];
 * "IRQ_EN" -> ["IRQ", "EN"]; "IRQHandler" -> ["IRQ", "Handler"].
 */
function splitWords(input: unknown): string[] {
  if (input === null || input === undefined) {
    return [];
  }
  let text = String(input);
  text = text.replace(/[-_.\s]+/g, ' ');
  // Acronym followed by a new capitalized word, e.g. "IRQHandler" -> "IRQ Handler".
  text = text.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // lower/digit followed by uppercase, e.g. "genIrq" -> "gen Irq".
  text = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return text.split(' ').filter((word) => word.length > 0);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** e.g. "genIrqHandler" -> "gen_irq_handler", "IRQ_EN" -> "irq_en". */
export function snakecase(value: unknown): string {
  return splitWords(value)
    .map((word) => word.toLowerCase())
    .join('_');
}

/** e.g. "genIrqHandler" -> "GEN_IRQ_HANDLER", "IRQ_EN" -> "IRQ_EN". */
export function constcase(value: unknown): string {
  return splitWords(value)
    .map((word) => word.toUpperCase())
    .join('_');
}

/** e.g. "gen_irq_handler" -> "genIrqHandler", "IRQ_EN" -> "irqEn". */
export function camelcase(value: unknown): string {
  const words = splitWords(value);
  if (words.length === 0) {
    return '';
  }
  return [words[0].toLowerCase(), ...words.slice(1).map(capitalize)].join('');
}

/** e.g. "gen_irq_handler" -> "GenIrqHandler", "IRQ_EN" -> "IrqEn". */
export function pascalcase(value: unknown): string {
  return splitWords(value).map(capitalize).join('');
}

/** Ceiling log2 of a positive number; 0 for non-positive or non-finite input. */
export function log2(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.ceil(Math.log2(num));
}

/** Left-justify `value` in a field of `width`, padding with `fillChar` (default space). */
export function ljust(value: unknown, width: unknown, fillChar: unknown = ' '): string {
  const str = String(value ?? '');
  const w = Math.max(0, Math.trunc(Number(width ?? 0)));
  const fill = typeof fillChar === 'string' && fillChar.length > 0 ? fillChar : ' ';
  if (str.length >= w) {
    return str;
  }
  const padLength = w - str.length;
  const padding = fill.repeat(Math.ceil(padLength / fill.length)).slice(0, padLength);
  return str + padding;
}

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

/** Escape LaTeX special characters (&, %, $, #, _, {, }, ~, ^, \) in `value`. */
export function latexescape(value: unknown): string {
  const str = String(value ?? '');
  return str.replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPES[ch] ?? ch);
}
