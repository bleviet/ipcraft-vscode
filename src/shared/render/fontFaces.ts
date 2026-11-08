/** The `@font-face` rules that embed the bundled IBM Plex faces in an SVG. Pure: callers pass the font bytes. */

export const SANS_FAMILY = "'IBM Plex Sans', sans-serif";
export const MONO_FAMILY = "'IBM Plex Mono', monospace";

/** File names of the latin woff2 subsets under `dist/resources/fonts/`. */
export const FONT_FILES = {
  sans400: 'ibm-plex-sans-latin-400-normal.woff2',
  sans600: 'ibm-plex-sans-latin-600-normal.woff2',
  mono400: 'ibm-plex-mono-latin-400-normal.woff2',
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
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${toBase64(bytes)}) format('woff2');}`;
}

/** CSS with one `@font-face` rule per bundled face, the font data inlined as base64. */
export function fontFaceCss(fonts: FontBytes): string {
  return [
    fontFace('IBM Plex Sans', 400, fonts.sans400),
    fontFace('IBM Plex Sans', 600, fonts.sans600),
    fontFace('IBM Plex Mono', 400, fonts.mono400),
  ].join('\n');
}
