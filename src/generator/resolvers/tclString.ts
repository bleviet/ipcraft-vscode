/**
 * Tcl string-safety helpers shared by the parameter-layout resolvers.
 *
 * Generator input (parameter descriptions, displayName, uiPage/uiGroup names)
 * is author-controlled free text that ends up interpolated into a generated
 * Tcl script. Tcl attaches meaning to several characters depending on the
 * quoting style, so raw interpolation can corrupt the script or, for double
 * quotes, trigger unintended variable/command substitution.
 */

/**
 * Escapes text for embedding inside a Tcl double-quoted string ("..."). Tcl
 * performs backslash, variable (`$name`) and command (`[cmd]`) substitution
 * inside double quotes, so `\`, `"`, `$` and `[` must be escaped or free text
 * containing them can corrupt the surrounding Tcl syntax or run as a command.
 */
export function toTclQuotedString(text: string): string {
  return text.replace(/[\\"$[]/g, (c) => `\\${c}`);
}

/**
 * Escapes one value that will be double-quoted inside an outer brace-delimited
 * Tcl list literal. Braces must be escaped as well: Tcl still counts braces
 * inside quote characters while parsing a braced word.
 */
export function toTclBracedListQuotedString(text: string): string {
  return text.replace(/[\\"{}]/g, (c) => `\\${c}`);
}

/**
 * Sanitizes text for a Tcl brace-quoted string ({...}), used e.g. by Vivado's
 * `set_property tooltip {...}`. Brace-quoting only needs balanced braces;
 * collapse whitespace so multi-line descriptions read as one line.
 */
export function toTclBraceText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}
