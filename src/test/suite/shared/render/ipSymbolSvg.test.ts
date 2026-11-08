import type {
  CanvasLayout,
  LayoutPort,
} from '../../../../webview/ipcore/components/canvas/canvasLayout';
import { portSvg, busBundleSvg, type PortDrawContext } from '../../../../shared/render/ipPortSvg';
import { renderIpSymbolSvg } from '../../../../shared/render/ipSymbolSvg';
import { paletteFor } from '../../../../shared/render/palette';
import { measureText } from '../../../../shared/render/textMetrics';

const palette = paletteFor('light');
const DOMAIN = '#123456';

function layout(overrides: Partial<CanvasLayout> = {}): CanvasLayout {
  return {
    blockRect: { x: 280, y: 40, width: 280, height: 200 },
    ports: [],
    subPorts: [],
    viewBox: { width: 840, height: 280 },
    coreName: 'core v1.0.0',
    coreNameLines: ['core v1.0.0'],
    vendorLabel: 'acme',
    libraryLabel: 'lib',
    authorLabel: '',
    parameters: [],
    paramSeparatorY: 122,
    portSeparatorY: 122,
    descLines: [],
    descSeparatorY: 240,
    subcoreDeps: [],
    depSeparatorY: 122,
    ...overrides,
  };
}

function port(overrides: Partial<LayoutPort>): LayoutPort {
  return {
    id: 'port:0',
    x: 280,
    y: 150,
    side: 'left',
    kind: 'port',
    label: 'p',
    widthLabel: '',
    data: {},
    clockDomainIdx: -1,
    ...overrides,
  };
}

function ctx(extra: Partial<PortDrawContext> = {}): PortDrawContext {
  return { palette, domainColor: () => undefined, expandable: () => false, ...extra };
}

const options = { palette, grid: true, background: 'editor' as const, fontFaceCss: '' };

describe('portSvg', () => {
  it('draws a clock stub and dot in the canvas clock color', () => {
    const svg = portSvg(port({ kind: 'clock', direction: 'in', label: 'clk' }), ctx());
    expect(svg).toContain(`stroke="${palette.ip.clock}"`);
    expect(svg).toContain(`fill="${palette.ip.clock}"`);
  });

  it('draws an active-low reset as an inversion bubble with an L badge', () => {
    const svg = portSvg(
      port({ kind: 'reset', direction: 'in', polarity: 'activeLow', label: 'rst_n' }),
      ctx()
    );
    expect(svg).toContain(`r="4" fill="${palette.ip.bodyFill}" stroke="${palette.ip.reset}"`);
    expect(svg).toContain('>L</text>');
  });

  it('draws an active-high reset as a filled dot and, like the canvas, an H badge', () => {
    const svg = portSvg(
      port({ kind: 'reset', direction: 'in', polarity: 'activeHigh', label: 'rst' }),
      ctx()
    );
    expect(svg).not.toContain('r="4" fill');
    expect(svg).toContain('r="3"');
    expect(svg).toContain('>H</text>');
  });

  it('marks an interrupt with its sensitivity', () => {
    const svg = portSvg(
      port({ kind: 'interrupt', direction: 'out', side: 'right', sensitivity: 'EDGE_FALLING' }),
      ctx()
    );
    expect(svg).toContain('>F</text>');
  });

  it('replaces the kind color with the clock domain color on every element', () => {
    const domain = ctx({ domainColor: () => DOMAIN });
    const clock = portSvg(port({ kind: 'clock', direction: 'in' }), domain);
    expect(clock).not.toContain(palette.ip.clock);
    // stub, dot, direction arrow and both clock hands
    expect(clock.split(`"${DOMAIN}"`).length - 1).toBe(5);
    const irq = portSvg(port({ kind: 'interrupt', direction: 'out', side: 'right' }), domain);
    // stub, dot, direction arrow and bolt (the badge keeps its own yellow)
    expect(irq.split(`"${DOMAIN}"`).length - 1).toBe(4);
    expect(irq).toContain(`points="1,-5 -2,0 1,0 -1,5 2,0 -1,0" fill="${DOMAIN}"`);
    const reset = portSvg(port({ kind: 'reset', direction: 'in', polarity: 'activeLow' }), domain);
    expect(reset).toContain(`stroke="${DOMAIN}"`);
    expect(reset).not.toContain(`"${palette.ip.reset}"`);
  });
});

describe('busBundleSvg', () => {
  const bus = port({ id: 'bus:0', kind: 'bus', protocol: 'AXI4-Lite', mode: 'S', label: 'S_AXI' });

  it('shows the expand toggle only for a bus with known signals', () => {
    expect(busBundleSvg(bus, ctx({ expandable: () => true }))).toContain('expand-toggle');
    expect(busBundleSvg(bus, ctx({ expandable: () => false }))).not.toContain('expand-toggle');
  });

  it('truncates a memory map reference, even a numeric one', () => {
    expect(busBundleSvg({ ...bus, memoryMapRef: 12345678901 as never }, ctx())).toContain(
      '>123456789\u2026<'
    );
  });

  it('writes the memory map reference in weight 600', () => {
    const svg = busBundleSvg({ ...bus, memoryMapRef: 'CSR' }, ctx());
    expect(svg).toMatch(/font-weight="600"[^>]*>CSR</);
  });
});

describe('renderIpSymbolSvg', () => {
  it('crops to a box that contains the widest label', () => {
    const label = 'a_very_long_port_name_that_sticks_out_of_the_block';
    const svg = renderIpSymbolSvg(layout({ ports: [port({ label, direction: 'in' })] }), options);
    const [x, , width] = /viewBox="(-?[\d.]+) (-?[\d.]+) (\d+) (\d+)"/
      .exec(svg)!
      .slice(1)
      .map(Number);
    const labelLeft = 280 - 48 - 6 - measureText(label, 'mono400', 11);
    expect(x).toBeLessThanOrEqual(labelLeft - 24);
    expect(x + width).toBeGreaterThan(560);
  });

  it('keeps an arrayed right-side bundle badge inside the box', () => {
    const arrayed = port({
      id: 'bus:0',
      kind: 'bus',
      side: 'right',
      x: 560,
      arrayCount: 4,
      protocol: 'AXI-Stream',
      mode: 'M',
    });
    const svg = renderIpSymbolSvg(layout({ ports: [arrayed] }), options);
    const [x, , width] = /viewBox="(-?[\d.]+) (-?[\d.]+) (\d+)/.exec(svg)!.slice(1).map(Number);
    expect(x + width).toBeGreaterThanOrEqual(560 + 48 + 24 + 89 + 24);
  });

  it('draws header values that are numbers or missing, as the canvas renders them', () => {
    const svg = renderIpSymbolSvg(
      layout({
        vendorLabel: undefined as never,
        libraryLabel: 2024 as never,
        authorLabel: 42 as never,
        parameters: [{ index: 0, name: 7 as never, value: 5 as never }],
        descLines: [3 as never],
      }),
      options
    );
    expect(svg).toContain('>2024<');
    expect(svg).toContain('>42<');
    expect(svg).toContain('>7<');
    expect(svg).toContain('= 5');
    expect(svg).not.toContain('undefined');
  });

  it('sets unhinted text rendering so drawn text is as wide as it was measured', () => {
    expect(renderIpSymbolSvg(layout(), options)).toContain('text-rendering:geometricPrecision');
  });

  it('is native SVG with no foreignObject or var()', () => {
    const svg = renderIpSymbolSvg(layout({ ports: [port({ direction: 'in' })] }), options);
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('var(');
  });
});
