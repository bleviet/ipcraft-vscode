#!/usr/bin/env node
/**
 * Generates src/shared/render/fontMetrics.generated.ts: the advance widths of the IBM Plex
 * faces the diagram renderer measures and draws text with. Reads the latin woff2 files of the
 * @fontsource devDependencies with fontkit, so fontkit is never needed at runtime.
 *
 * Usage: npm run generate:font-metrics
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');

const root = path.resolve(__dirname, '..');
const FACES = [
  ['sans400', '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2'],
  ['sans600', '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2'],
  ['mono400', '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'],
];
/** Printable ASCII plus the few other characters the diagram draws. */
const EXTRA = [0xb7, 0xbb, 0x2026, 0x2212];
const CODE_POINTS = [...Array.from({ length: 95 }, (_, i) => 32 + i), ...EXTRA];

function faceMetrics(file) {
  const font = fontkit.openSync(path.join(root, 'node_modules', file));
  const advances = {};
  for (const cp of CODE_POINTS) {
    if (font.hasGlyphForCodePoint(cp)) {
      advances[cp] = font.glyphForCodePoint(cp).advanceWidth;
    }
  }
  return { unitsPerEm: font.unitsPerEm, ascent: font.ascent, descent: -font.descent, advances };
}

const faces = Object.fromEntries(FACES.map(([name, file]) => [name, faceMetrics(file)]));

const lines = [
  '// GENERATED FILE - DO NOT EDIT.',
  '// Regenerate with `npm run generate:font-metrics` (scripts/generate-font-metrics.js), which reads',
  '// the latin woff2 files of @fontsource/ibm-plex-sans and @fontsource/ibm-plex-mono.',
  '// Advance widths are in font units for the code points the diagram renderer draws.',
  '',
  'export interface FaceMetrics {',
  '  readonly unitsPerEm: number;',
  '  /** Distance from the baseline to the top of the line box, in font units. */',
  '  readonly ascent: number;',
  '  /** Distance from the baseline to the bottom of the line box, in font units (positive). */',
  '  readonly descent: number;',
  '  /** Advance width in font units by code point. */',
  '  readonly advances: Readonly<Record<number, number>>;',
  '}',
  '',
  "export type FaceName = 'sans400' | 'sans600' | 'mono400';",
  '',
  'export const FONT_METRICS: Readonly<Record<FaceName, FaceMetrics>> = {',
];
for (const [name, m] of Object.entries(faces)) {
  lines.push(`  ${name}: {`);
  lines.push(`    unitsPerEm: ${m.unitsPerEm},`);
  lines.push(`    ascent: ${m.ascent},`);
  lines.push(`    descent: ${m.descent},`);
  lines.push('    advances: {');
  const entries = Object.entries(m.advances);
  for (let i = 0; i < entries.length; i += 8) {
    lines.push(
      '      ' +
        entries
          .slice(i, i + 8)
          .map(([cp, w]) => `${cp}: ${w},`)
          .join(' ')
    );
  }
  lines.push('    },');
  lines.push('  },');
}
lines.push('};', '');

const out = path.join(root, 'src', 'shared', 'render', 'fontMetrics.generated.ts');
fs.writeFileSync(out, lines.join('\n'));
console.log(`Wrote ${path.relative(root, out)}`);
