/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import { inflateSync } from 'zlib';
import { woffToSfnt } from '../../../../shared/render/woffToSfnt';
// fontkit ships no type declarations; the test uses a small slice of its API.
interface ParsedFont {
  familyName: string;
  unitsPerEm: number;
  glyphForCodePoint(codePoint: number): { advanceWidth: number };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('fontkit') as { create(buffer: Buffer): ParsedFont };
import { FONT_METRICS } from '../../../../shared/render/fontMetrics.generated';

const fontsRoot = path.resolve(__dirname, '../../../../../node_modules/@fontsource');
const read = (pkg: string, file: string) =>
  new Uint8Array(fs.readFileSync(path.join(fontsRoot, pkg, 'files', file)));

const FACES = [
  ['sans400', 'ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff', 'IBM Plex Sans'],
  ['sans600', 'ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff', 'IBM Plex Sans SemiBold'],
  ['mono400', 'ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff', 'IBM Plex Mono'],
] as const;

describe('woffToSfnt', () => {
  it.each(FACES)(
    'converts %s to a font that parses with the same metrics',
    (face, pkg, file, family) => {
      const sfnt = woffToSfnt(read(pkg, file), inflateSync);
      const font = fontkit.create(Buffer.from(sfnt));
      expect(font.familyName).toBe(family);
      expect(font.unitsPerEm).toBe(FONT_METRICS[face].unitsPerEm);
      // fontMetrics.generated.ts is generated from the woff2 files (fontkit cannot read these woff
      // files directly); every advance must agree with the woff-derived font.
      for (const [codePoint, advance] of Object.entries(FONT_METRICS[face].advances)) {
        expect(font.glyphForCodePoint(Number(codePoint)).advanceWidth).toBe(advance);
      }
      expect(sfnt.length % 4).toBe(0);
    }
  );

  it('writes a valid sfnt table directory with aligned offsets', () => {
    const sfnt = woffToSfnt(read(...([FACES[0][1], FACES[0][2]] as const)), inflateSync);
    const view = new DataView(sfnt.buffer);
    expect(view.getUint32(0)).toBe(0x00010000);
    const numTables = view.getUint16(4);
    const searchRange = view.getUint16(6);
    expect(searchRange).toBe(16 * 2 ** view.getUint16(8));
    expect(view.getUint16(10)).toBe(numTables * 16 - searchRange);
    for (let i = 0; i < numTables; i++) {
      expect(view.getUint32(12 + i * 16 + 8) % 4).toBe(0);
    }
  });

  it('writes a head.checkSumAdjustment that makes the whole-file checksum 0xB1B0AFBA', () => {
    for (const [, pkg, file] of FACES) {
      const sfnt = woffToSfnt(read(pkg, file), inflateSync);
      const view = new DataView(sfnt.buffer);
      let sum = 0;
      for (let i = 0; i < sfnt.length; i += 4) {
        sum = (sum + view.getUint32(i)) >>> 0;
      }
      expect(sum).toBe(0xb1b0afba);
    }
  });

  it('rejects a table whose inflated length differs from the directory', () => {
    const woff = Uint8Array.from(read('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff'));
    // origLength of the first table (GDEF: 49 stored, 52 inflated): the inflate branch's check.
    new DataView(woff.buffer).setUint32(44 + 12, 53);
    expect(() => woffToSfnt(woff, inflateSync)).toThrow('Corrupt WOFF table length');
  });

  it('rejects data that is not WOFF', () => {
    expect(() => woffToSfnt(new Uint8Array(64), inflateSync)).toThrow('Not a WOFF 1.0 font file');
  });
});
