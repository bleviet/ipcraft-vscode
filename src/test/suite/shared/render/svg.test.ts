import {
  attributes,
  element,
  escapeAttribute,
  escapeText,
  num,
  textElement,
} from '../../../../shared/render/svg';
import { fontFaceCss, toBase64 } from '../../../../shared/render/fontFaces';

describe('svg helpers', () => {
  it('escapes text and attribute values', () => {
    expect(escapeText('a<b>&c"')).toBe('a&lt;b&gt;&amp;c"');
    expect(escapeAttribute('a<b>&"c')).toBe('a&lt;b&gt;&amp;&quot;c');
  });

  it('formats numbers with at most two decimals and no negative zero', () => {
    expect(num(1)).toBe('1');
    expect(num(1.236)).toBe('1.24');
    expect(num(10.5)).toBe('10.5');
    expect(num(1 / 3)).toBe('0.33');
    expect(num(-0.001)).toBe('0');
  });

  it('writes defined attributes in order and skips undefined ones', () => {
    expect(attributes({ x: 1.234, id: 'a"b', skip: undefined })).toBe('x="1.23" id="a&quot;b"');
    expect(element('rect', { width: 2 })).toBe('<rect width="2"/>');
    expect(textElement({ x: 0 }, 'a<b')).toBe('<text x="0">a&lt;b</text>');
  });
});

describe('fontFaces', () => {
  it('encodes base64 like Buffer, including padding', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('builds one @font-face rule per face with the data inlined', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const css = fontFaceCss({ sans400: bytes, sans600: bytes, mono400: bytes });
    expect(css.match(/@font-face/g)).toHaveLength(3);
    expect(css).toContain("font-family:'IBM Plex Sans';font-style:normal;font-weight:600");
    expect(css).toContain("font-family:'IBM Plex Mono';font-style:normal;font-weight:400");
    expect(css).toContain('base64,AQID');
  });
});
