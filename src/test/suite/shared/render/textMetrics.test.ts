import {
  baselineY,
  measureText,
  plexTextMeasure,
  truncateEnd,
} from '../../../../shared/render/textMetrics';
import { FONT_METRICS } from '../../../../shared/render/fontMetrics.generated';

describe('measureText', () => {
  it('scales the advance widths in font units to the size', () => {
    const { advances, unitsPerEm } = FONT_METRICS.sans400;
    expect(measureText('M', 'sans400', 10)).toBeCloseTo((advances[77] / unitsPerEm) * 10, 6);
    expect(measureText('MM', 'sans400', 10)).toBeCloseTo(2 * measureText('M', 'sans400', 10), 6);
    expect(measureText('', 'sans400', 10)).toBe(0);
  });

  it('is monospaced for the mono face and wider for semibold', () => {
    expect(measureText('iiii', 'mono400', 10)).toBeCloseTo(measureText('WWWW', 'mono400', 10), 6);
    expect(measureText('Hello', 'sans600', 12)).toBeGreaterThan(
      measureText('Hello', 'sans400', 12)
    );
  });

  it('measures a character outside the table as M', () => {
    expect(measureText('中', 'sans400', 11)).toBe(measureText('M', 'sans400', 11));
  });

  it('counts a surrogate pair once', () => {
    expect(measureText('\u{1F600}', 'sans400', 11)).toBe(measureText('M', 'sans400', 11));
  });
});

describe('plexTextMeasure', () => {
  it('uses the webview weights: Sans 400 11 px, Sans 600 12 px, Mono 400 10.5 px', () => {
    expect(plexTextMeasure('clk', 'normal')).toBeCloseTo(measureText('clk', 'sans400', 11), 6);
    expect(plexTextMeasure('clk', 'semibold')).toBeCloseTo(measureText('clk', 'sans600', 12), 6);
    expect(plexTextMeasure('clk', 'subtitle')).toBeCloseTo(measureText('clk', 'mono400', 10.5), 6);
  });
});

describe('truncateEnd and baselineY', () => {
  const face = { face: 'sans400', sizePx: 11 } as const;

  it('keeps text that fits and cuts the rest with an ellipsis', () => {
    expect(truncateEnd('abc', 100, face)).toBe('abc');
    const cut = truncateEnd('a_rather_long_instance_name', 60, face);
    expect(cut.endsWith('…')).toBe(true);
    expect(measureText(cut, 'sans400', 11)).toBeLessThanOrEqual(60);
  });

  it('puts the baseline below the centre by half the ascent-to-descent box', () => {
    expect(baselineY(10, 'sans400', 11)).toBeGreaterThan(10);
    expect(baselineY(10, 'sans400', 11)).toBeLessThan(10 + 11);
  });
});
