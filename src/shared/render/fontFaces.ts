/** The `@font-face` rules that embed the bundled IBM Plex faces in an SVG. Pure: callers pass the font bytes. */

export const SANS_FAMILY = "'IBM Plex Sans', sans-serif";
/**
 * Semibold text: resvg matches the family name table of the TrueType file, which for the 600
 * face is 'IBM Plex Sans SemiBold'; browsers skip that name and use the embedded 'IBM Plex Sans'
 * at weight 600.
 */
export const SANS_SEMIBOLD_FAMILY = "'IBM Plex Sans SemiBold', 'IBM Plex Sans', sans-serif";
export const MONO_FAMILY = "'IBM Plex Mono', monospace";

/** File names of the latin WOFF (1.0) subsets under `dist/resources/fonts/`. */
export const FONT_FILES = {
  sans400: 'ibm-plex-sans-latin-400-normal.woff',
  sans600: 'ibm-plex-sans-latin-600-normal.woff',
  mono400: 'ibm-plex-mono-latin-400-normal.woff',
} as const;

export type FontBytes = Readonly<Record<keyof typeof FONT_FILES, Uint8Array>>;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of `bytes`; written out so the module needs neither Node's Buffer nor the browser's btoa. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64[(chunk >> 18) & 63] + BASE64[(chunk >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(chunk >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64[chunk & 63] : '=';
  }
  return out;
}

function fontFace(family: string, weight: number, bytes: Uint8Array): string {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff;base64,${toBase64(bytes)}) format('woff');}`;
}

/** CSS with one `@font-face` rule per bundled face, the font data inlined as base64. */
export function fontFaceCss(fonts: FontBytes): string {
  return [
    fontFace('IBM Plex Sans', 400, fonts.sans400),
    fontFace('IBM Plex Sans', 600, fonts.sans600),
    fontFace('IBM Plex Mono', 400, fonts.mono400),
  ].join('\n');
}
