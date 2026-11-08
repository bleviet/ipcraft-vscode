/** Tiny helpers for writing SVG text: escaping and deterministic number formatting. */

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Escapes `text` for element content. */
export function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (char) => ATTRIBUTE_ESCAPES[char]);
}

/** Escapes `text` for a double-quoted attribute value. */
export function escapeAttribute(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ATTRIBUTE_ESCAPES[char]);
}

/** A number with at most two decimals and no trailing zeros, so the same input gives the same bytes. */
export function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export type SvgAttributes = Readonly<Record<string, string | number | undefined>>;

/** `name="value" ...` for the defined attributes, in the given order; numbers go through {@link num}. */
export function attributes(attrs: SvgAttributes): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(
      ([name, value]) =>
        `${name}="${escapeAttribute(typeof value === 'number' ? num(value) : String(value))}"`
    )
    .join(' ');
}

/** A self-closing element. */
export function element(tag: string, attrs: SvgAttributes): string {
  return `<${tag} ${attributes(attrs)}/>`;
}

/** An element holding escaped text. */
export function textElement(attrs: SvgAttributes, text: string): string {
  return `<text ${attributes(attrs)}>${escapeText(text)}</text>`;
}
