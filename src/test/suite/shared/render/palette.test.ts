import { mixSrgb, paletteFor, type RenderTheme } from '../../../../shared/render/palette';

describe('mixSrgb', () => {
  it('returns the first color at 100% and the second at 0%', () => {
    expect(mixSrgb('#ff0000', '#0000ff', 100)).toBe('#ff0000');
    expect(mixSrgb('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });

  it('mixes channel by channel, as color-mix in srgb does', () => {
    expect(mixSrgb('#000000', '#ffffff', 50)).toBe('#808080');
    // 10% of #3b3b3b over white: 59 * 0.1 + 255 * 0.9 = 235.4
    expect(mixSrgb('#3b3b3b', '#ffffff', 10)).toBe('#ebebeb');
  });
});

describe('paletteFor', () => {
  it.each<RenderTheme>(['light', 'dark'])('%s palette holds fixed colors only', (theme) => {
    expect(JSON.stringify(paletteFor(theme))).not.toContain('var(');
  });

  it('derives the block roles from the foreground and background', () => {
    const light = paletteFor('light');
    expect(light.background).toBe('#ffffff');
    expect(light.nodeFill).toBe(mixSrgb(light.foreground, light.background, 3));
    expect(light.nodeHeadFill).toBe(mixSrgb(light.foreground, light.background, 10));
    expect(light.wire.aximm).toBe(mixSrgb(light.category.aximm, light.background, 65));
  });

  it('differs between themes and covers every net category', () => {
    const light = paletteFor('light');
    const dark = paletteFor('dark');
    expect(dark.background).not.toBe(light.background);
    expect(Object.keys(light.category).sort()).toEqual(Object.keys(light.wire).sort());
    expect(Object.keys(light.category)).toEqual(
      expect.arrayContaining([
        'aximm',
        'axis',
        'avalonmm',
        'avalonst',
        'interface',
        'clock',
        'reset',
        'interrupt',
        'signal',
      ])
    );
  });
});
