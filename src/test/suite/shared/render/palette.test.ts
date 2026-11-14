import {
  mixSrgb,
  paletteFor,
  resolveColor,
  type RenderTheme,
} from '../../../../shared/render/palette';
import { DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import { UNRELEASED_RESET_COLOR } from '../../../../webview/systemDiagram/clocks/domainView';

describe('resolveColor', () => {
  it.each(['light', 'dark'] as const)('fixes every clock domain color in %s', (theme) => {
    for (const css of [...DOMAIN_COLORS, UNRELEASED_RESET_COLOR]) {
      expect(resolveColor(paletteFor(theme), css)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('throws on a token it does not know', () => {
    expect(() => resolveColor(paletteFor('light'), 'var(--vscode-nope)')).toThrow('No fixed color');
  });
});

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

describe('change colors', () => {
  it('pins the colors of the comparison marks per theme', () => {
    // The gitDecoration values of the bundled git extension, as scripts/docs-screenshots/theme/*.css have them.
    expect(paletteFor('light').change).toEqual({
      added: '#587c0c',
      changed: '#895503',
      renamed: '#652d90',
      moved: '#652d90',
      version: '#8e8e90',
      newWire: '#587c0c',
    });
    expect(paletteFor('dark').change).toEqual({
      added: '#81b88b',
      changed: '#e2c08d',
      renamed: '#b180d7',
      moved: '#b180d7',
      version: '#8c8c8c',
      newWire: '#81b88b',
    });
  });

  it('takes the renamed and the moved color from charts-purple', () => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = paletteFor(theme);
      expect(palette.change.renamed).toBe(palette.tokens['--vscode-charts-purple']);
      expect(palette.change.moved).toBe(palette.tokens['--vscode-charts-purple']);
    }
  });
});

describe('IP symbol roles', () => {
  it('derives the header and badge fills with the canvas color-mix formulas', () => {
    const light = paletteFor('light');
    expect(light.ip.bodyFill).toBe(light.background);
    expect(light.ip.bodyStroke).toBe('#e5e5e5');
    expect(light.ip.headerFill).toBe(mixSrgb('#005fb8', light.background, 20));
    expect(light.ip.busBadgeFill).toBe(mixSrgb(light.ip.bus, light.background, 20));
    expect(light.ip.gridDot).toEqual({ color: light.foreground, opacity: 0.1 });
  });

  it('keeps the canvas clock and reset colors, not the system diagram ones', () => {
    const dark = paletteFor('dark');
    expect(dark.ip.clock).toBe('#89d185');
    expect(dark.ip.reset).toBe('#d18616');
    expect(dark.ip.clock).not.toBe(dark.category.clock);
    expect(dark.ip.reset).not.toBe(dark.category.reset);
    expect(paletteFor('dark').ip.headerFill).not.toBe(paletteFor('light').ip.headerFill);
  });
});

describe('VS Code registry chart colors', () => {
  it('uses the registry defaults for charts blue, orange and yellow', () => {
    const light = paletteFor('light');
    const dark = paletteFor('dark');
    expect(light.ip.yellow).toBe('#bf8803');
    expect(dark.ip.yellow).toBe('#cca700');
    expect(light.ip.bus).toBe('#0063d3');
    expect(dark.ip.bus).toBe('#59a4f9');
    expect(light.category.clock).toBe('#d18616');
    expect(dark.category.clock).toBe('#d18616');
    expect(light.wire.aximm).toBe(mixSrgb('#0063d3', light.background, 65));
  });
});
