import { createTextMeasurer } from '../../../../webview/systemDiagram/layout/textMeasure';

describe('createTextMeasurer', () => {
  it('estimates by length when no canvas context exists', () => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const measure = createTextMeasurer('sans-serif');
    expect(measure('abcd', 'normal')).toBe(4 * 6.5);
    expect(measure('abcd', 'semibold')).toBe(4 * 7.6);
    expect(measure('abcd', 'subtitle')).toBe(4 * 6.4);
  });

  it('measures with the node font and caches per text and weight', () => {
    const fonts: string[] = [];
    const measureText = jest.fn((text: string) => ({ width: text.length * 5 }));
    const context = {
      measureText,
      set font(value: string) {
        fonts.push(value);
      },
    };
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const measure = createTextMeasurer('Segoe UI', 'Consolas');
    expect(measure('abc', 'normal')).toBe(15);
    expect(measure('abc', 'normal')).toBe(15);
    expect(measure('abc', 'semibold')).toBe(15);
    expect(measure('abc', 'subtitle')).toBe(15);
    expect(measureText).toHaveBeenCalledTimes(3);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(fonts).toEqual(['11px Segoe UI', '600 12px Segoe UI', '10.5px Consolas']);
  });
});
