import { createHash } from 'crypto';
import { paletteFor } from '../../../../shared/render/palette';
import {
  renderSystemLevelSvg,
  type SystemLevelLayout,
  type SystemLevelOptions,
} from '../../../../shared/render/systemLevelSvg';
import { changeDecor, type ChangeDecor } from '../../../../webview/systemDiagram/changeDecor';
import { buildChangeMarks, type NodeChange } from '../../../../webview/systemDiagram/changeMarks';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { zynqDiff, zynqGraph, zynqUnion } from '../../webview/systemDiagram/compareFixtures';
import { withoutGhosts, withUnion } from '../../../../webview/systemDiagram/layout/unionGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { applyClockDecor, clockDecor } from '../../../../webview/systemDiagram/clockDecor';
import { plexTextMeasure } from '../../../../shared/render/textMetrics';
import { fakeMeasure } from '../../webview/systemDiagram/fixtureGraph';

const wire = (data: Partial<DiagramFlowEdge['data']>): DiagramFlowEdge => ({
  id: 'e',
  type: 'elk',
  source: 'a',
  target: 'b',
  sourceHandle: 'p',
  targetHandle: 'q',
  data: {
    points: [
      { x: 5, y: 7 },
      { x: 50, y: 7 },
    ],
    netId: 'n',
    category: 'clock',
    isInterface: false,
    ...data,
  },
});

const draw = (edge: DiagramFlowEdge) =>
  renderSystemLevelSvg(
    { nodes: [], edges: [edge] },
    {
      palette: paletteFor('dark'),
      grid: false,
      legend: false,
      background: 'transparent',
      fontFaceCss: '',
    }
  );

describe('renderSystemLevelSvg junction dot', () => {
  it('draws a dot at the first point only for a wire with a junction', () => {
    expect(draw(wire({}))).not.toContain('<circle');
    const svg = draw(wire({ junction: true, dimmed: true }));
    const circle = svg.match(/<circle[^>]*>/)![0];
    expect(circle).toContain('cx="5"');
    expect(circle).toContain('cy="7"');
    expect(circle).toContain('r="2.5"');
    expect(circle).toContain('opacity="0.2"');
    const stroke = svg.match(/<path[^>]* stroke="([^"]*)"/)![1];
    expect(circle).toContain(`fill="${stroke}"`);
  });
});

describe('renderSystemLevelSvg black box', () => {
  it('outlines a black box with a dashed border and an ip block with a solid one', async () => {
    const graph = readBdTcl(
      [
        'create_bd_cell -type ip -vlnv a:b:c:1 known',
        'connect_bd_net -net n [get_bd_pins known/x] [get_bd_pins ghost/y]',
      ].join('\n'),
      '/p/top.tcl'
    );
    const layout = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
    const { nodes, edges } = toFlowElements(layout, graph, '/', fakeMeasure);
    const svg = renderSystemLevelSvg(
      { nodes, edges },
      {
        palette: paletteFor('light'),
        grid: false,
        legend: false,
        background: 'transparent',
        fontFaceCss: '',
      }
    );
    expect(svg).toContain('Black box');
    expect(svg.match(/<rect[^>]*stroke-dasharray="4 3"/g)).toHaveLength(1);
  }, 20000);
});

describe('renderSystemLevelSvg marks of a comparison', () => {
  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const STATUS_NODES = {
    '/sys_ps7': 'added',
    '/axi_periph': 'changed',
    '/axis_data_fifo_0': 'renamed',
    '/sync_0': 'version',
  } as const;
  const NO_LEGEND = { kinds: [], newWire: false, removed: 0 } as const;
  let layout: SystemLevelLayout;
  let frameLayout: SystemLevelLayout;

  beforeAll(async () => {
    const graph = zynqGraph('current');
    const build = async (expanded: string[]) =>
      toFlowElements(
        await runElkLayout(
          buildElkInput(graph, '/', { measure: fakeMeasure, expanded: new Set(expanded) })
        ),
        graph,
        '/',
        fakeMeasure
      );
    layout = await build([]);
    frameLayout = await build(['/gpio_block']);
  }, 30000);

  const options = (theme: 'light' | 'dark', extra: Partial<SystemLevelOptions> = {}) => ({
    palette: paletteFor(theme),
    grid: false,
    legend: false,
    background: 'transparent' as const,
    fontFaceCss: '',
    ...extra,
  });
  const decorOf = (
    nodes: [string, NodeChange][],
    extra: Partial<ChangeDecor> = {}
  ): ChangeDecor => ({
    nodes: new Map(nodes),
    newEdgeIds: new Set(),
    legend: NO_LEGEND,
    ...extra,
  });
  const group = (svg: string, id: string) =>
    new RegExp(`<g [^>]*data-node="${escapeRegExp(id)}"[^>]*>(.*?)</g>`).exec(svg)![1];
  const textFill = (svg: string, content: string) =>
    new RegExp(`<text[^>]* fill="([^"]*)"[^>]*>${escapeRegExp(content)}</text>`).exec(svg)?.[1];
  const firstRect = (svg: string) => /<rect[^>]*>/.exec(svg)![0];

  it('draws an unmarked level byte for byte as before marks existed (golden hashes)', async () => {
    // Taken from the renderer before the marks of a comparison were added. A deliberate change of
    // the unmarked output updates them: print the SVG, review it, then hash it with sha256.
    const GOLDEN = {
      light: 'f396620155b6813594bb27165d09956dc5b665a599d4a7378462ed9a989a0717',
      dark: 'cc484d45f4a69ca6039e07876b65663ca5bf013220c30dfbc5af846901e8dc5a',
    } as const;
    const graph = zynqGraph('current');
    const laidOut = await runElkLayout(
      buildElkInput(graph, '/', { measure: plexTextMeasure, expanded: new Set(['/gpio_block']) })
    );
    const flow = toFlowElements(laidOut, graph, '/', plexTextMeasure);
    const decor = clockDecor(
      flow,
      { graph, analysis: analyzeClocks(graph), levelPath: '/', domainMode: true },
      null
    );
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderSystemLevelSvg(applyClockDecor(flow, decor), {
        ...options(theme),
        grid: true,
        legend: true,
        background: 'editor',
        selectedNodeIds: new Set(['/sys_ps7']),
        domainLegend: decor.legend,
      });
      expect(svg).toContain('data-kind="frame"');
      expect(svg).toContain('data-legend="true"');
      expect(createHash('sha256').update(svg).digest('hex')).toBe(GOLDEN[theme]);
    }
  }, 30000);

  it('draws the same bytes without marks, with an empty set of marks and with the legend on', () => {
    for (const legend of [false, true]) {
      const plain = renderSystemLevelSvg(layout, options('light', { legend }));
      const empty = renderSystemLevelSvg(
        layout,
        options('light', { legend, changes: decorOf([]) })
      );
      expect(empty).toBe(plain);
      expect(plain).not.toContain(paletteFor('light').change.added);
    }
  });

  it.each(['light', 'dark'] as const)(
    'outlines a block in the color of its kind and writes its sign (%s)',
    (theme) => {
      const { change } = paletteFor(theme);
      const svg = renderSystemLevelSvg(
        layout,
        options(theme, {
          changes: decorOf(
            Object.entries(STATUS_NODES).map(([id, status]) => [id, { status, title: status }])
          ),
        })
      );
      const signs = { added: '+', changed: '~', renamed: '→', version: 'v' } as const;
      for (const [id, status] of Object.entries(STATUS_NODES)) {
        const body = group(svg, id);
        const border = /<rect[^>]* stroke="[^"]*" [^>]*>/.exec(body)!;
        expect(border[0]).toContain(`stroke="${change[status]}"`);
        expect(textFill(body, signs[status])).toBe(change[status]);
        const ring = body.includes('x="-0.5"');
        expect(ring).toBe(status !== 'version');
        expect(body.includes('stroke-dasharray="1 2"')).toBe(status === 'version');
      }
    }
  );

  it.each(['light', 'dark'] as const)(
    'draws a moved block with the renamed color and its own sign in the %s theme',
    (theme) => {
      const { change } = paletteFor(theme);
      expect(change.moved).toBe(change.renamed);
      const svg = renderSystemLevelSvg(
        layout,
        options(theme, {
          changes: decorOf([['/sys_ps7', { status: 'moved', title: 'Moved from /' }]]),
        })
      );
      const body = group(svg, '/sys_ps7');
      expect(/<rect[^>]* stroke="[^"]*" [^>]*>/.exec(body)![0]).toContain(
        `stroke="${change.moved}"`
      );
      expect(textFill(body, '»')).toBe(change.moved);
      expect(body.includes('x="-0.5"')).toBe(true);
    }
  );

  it('keeps the selection outline of a marked block, and still writes its sign', () => {
    const svg = renderSystemLevelSvg(
      layout,
      options('light', {
        selectedNodeIds: new Set(['/sys_ps7']),
        changes: decorOf([['/sys_ps7', { status: 'added' }]]),
      })
    );
    const body = group(svg, '/sys_ps7');
    expect(firstRect(body)).toContain(`stroke="${paletteFor('light').focusBorder}"`);
    expect(body).not.toContain(paletteFor('light').change.added + '" stroke-width="1"');
    expect(textFill(body, '+')).toBe(paletteFor('light').change.added);
  });

  it('draws nothing for a node without a mark', () => {
    const svg = renderSystemLevelSvg(
      layout,
      options('light', { changes: decorOf([['/sys_ps7', { status: 'changed' }]]) })
    );
    const colors = Object.values(paletteFor('light').change);
    const plain = group(svg, '/sync_0');
    expect(plain).toBe(group(renderSystemLevelSvg(layout, options('light')), '/sync_0'));
    for (const color of colors) {
      expect(plain).not.toContain(color);
    }
  });

  it('writes the count of changes inside a hierarchy block', () => {
    const svg = renderSystemLevelSvg(
      layout,
      options('dark', { changes: decorOf([['/gpio_block', { inside: 3 }]]) })
    );
    const body = group(svg, '/gpio_block');
    expect(textFill(body, '~ 3 inside')).toBe(paletteFor('dark').change.changed);
    expect(firstRect(body)).not.toContain(paletteFor('dark').change.changed);
  });

  it('puts the sign and the count side by side, ending at the right edge of the header', () => {
    const svg = renderSystemLevelSvg(
      layout,
      options('light', {
        changes: decorOf([['/gpio_block', { status: 'changed', inside: 2 }]]),
      })
    );
    const body = group(svg, '/gpio_block');
    const x = (content: string) =>
      Number(new RegExp(`<text x="([^"]*)"[^>]*>${escapeRegExp(content)}</text>`).exec(body)![1]);
    expect(x('~')).toBeLessThan(x('~ 2 inside'));
  });

  it('outlines a frame, with a dotted outline for a version-only change', () => {
    const [added, version] = ['added', 'version'] as const;
    const draw = (status: typeof added | typeof version) =>
      group(
        renderSystemLevelSvg(
          frameLayout,
          options('light', { changes: decorOf([['/gpio_block', { status }]]) })
        ),
        '/gpio_block'
      );
    const solid = draw(added);
    expect(firstRect(solid)).toContain(`stroke="${paletteFor('light').change.added}"`);
    expect(solid).toContain('x="-0.5"');
    const dotted = draw(version);
    expect(firstRect(dotted)).toContain('stroke-dasharray="2 3"');
    expect(dotted).not.toContain('x="-0.5"');
  });

  it('outlines a marked external port and writes its sign', () => {
    const port = layout.nodes.find((node) => node.type === 'boundary')!;
    const svg = renderSystemLevelSvg(
      layout,
      options('light', { changes: decorOf([[port.id, { status: 'changed' }]]) })
    );
    const body = group(svg, port.id);
    const { changed } = paletteFor('light').change;
    expect(/<path[^>]*>/.exec(body)![0]).toContain(`stroke="${changed}"`);
    expect(/<path[^>]*>/.exec(body)![0]).toContain('stroke-width="1.5"');
    expect(textFill(body, '~')).toBe(changed);
  });

  it('colors the label of a marked pin, outside and inside, and no other', () => {
    const { change, foreground } = paletteFor('light');
    const svg = renderSystemLevelSvg(
      layout,
      options('light', {
        changes: decorOf([
          [
            '/sys_ps7',
            {
              status: 'changed',
              pins: { FCLK_CLK0: { kind: 'changed' }, DDR: { kind: 'added', inside: true } },
            },
          ],
        ]),
      })
    );
    const body = group(svg, '/sys_ps7');
    expect(textFill(body, 'FCLK_CLK0')).toBe(change.changed);
    expect(textFill(body, 'DDR')).toBe(change.added);
    expect(textFill(body, 'M_AXI_GP0')).toBe(foreground);
  });

  describe('new wires', () => {
    const palette = paletteFor('light');
    const draw = (data: Partial<DiagramFlowEdge['data']>, isNew = true) =>
      renderSystemLevelSvg(
        { nodes: [], edges: [wire(data)] },
        options('light', { changes: decorOf([], { newEdgeIds: new Set(isNew ? ['e'] : []) }) })
      );
    const stroke = (svg: string) => /<path[^>]* stroke="([^"]*)"/.exec(svg)![1];
    const width = (svg: string) => /<path[^>]* stroke-width="([^"]*)"/.exec(svg)![1];

    it('strokes a new wire in the added color, 0.75 wider', () => {
      expect(stroke(draw({}))).toBe(palette.change.newWire);
      expect(width(draw({}))).toBe('1.75');
      expect(width(draw({ isInterface: true }))).toBe('2.5');
      expect(stroke(draw({}, false))).toBe(palette.wire.clock);
      expect(width(draw({}, false))).toBe('1');
    });

    it('keeps the color of a clock domain or a crossing, but still widens the wire', () => {
      const domain = draw({ domainColor: 'var(--vscode-charts-blue)' });
      expect(stroke(domain)).toBe(palette.wire.clock);
      expect(width(domain)).toBe('1.75');
      const crossing = draw({ crossing: true });
      expect(stroke(crossing)).toBe(palette.warning);
      expect(width(crossing)).toBe('1.75');
    });

    it('fills the junction dot with the color of the wire and keeps the dimming', () => {
      const svg = draw({ junction: true, dimmed: true });
      expect(/<circle[^>]*>/.exec(svg)![0]).toContain(`fill="${palette.change.newWire}"`);
      expect(svg).toContain('opacity="0.2"');
    });
  });

  describe('legend', () => {
    const legendOf = (legend: ChangeDecor['legend']) =>
      /<g data-legend[^>]*>.*?<\/g>/.exec(
        renderSystemLevelSvg(
          layout,
          options('light', { legend: true, changes: decorOf([], { legend }) })
        )
      )![0];

    it('lists the kinds present with their sign, the new wire and the count of removed blocks', () => {
      const { change } = paletteFor('light');
      const legend = legendOf({
        kinds: ['added', 'renamed', 'moved', 'version'],
        newWire: true,
        removed: 2,
      });
      expect(textFill(legend, '+')).toBe(change.added);
      expect(textFill(legend, 'Added')).toBeDefined();
      expect(textFill(legend, '→')).toBe(change.renamed);
      expect(textFill(legend, 'Renamed')).toBeDefined();
      expect(textFill(legend, '»')).toBe(change.moved);
      expect(textFill(legend, 'Moved')).toBeDefined();
      expect(textFill(legend, 'v')).toBe(change.version);
      expect(textFill(legend, 'Version only')).toBeDefined();
      expect(textFill(legend, 'Changed')).toBeUndefined();
      expect(legend).toContain('>New wire<');
      expect(legend).toContain('>− 2 removed<');
      expect(legend).not.toContain('see Changes');
      expect(legend).toContain(`stroke="${change.version}"`);
      expect(legend).toContain('stroke-dasharray="1.5 2.5"');
      expect(legend).toContain(`fill="${change.newWire}"`);
    });

    it('adds nothing when the comparison marks nothing on the level', () => {
      const legend = legendOf(NO_LEGEND);
      for (const text of ['Added', 'Changed', 'New wire', 'removed']) {
        expect(legend).not.toContain(text);
      }
    });
  });
});

describe('renderSystemLevelSvg ghosts of a comparison', () => {
  const current = zynqGraph('current');
  const diff = zynqDiff();
  const GHOST = '/axi_gpio_0';
  let union: ReturnType<typeof withUnion>;
  let unionLayout: SystemLevelLayout;
  let plainLayout: SystemLevelLayout;

  const layoutOf = async (graph: typeof current, ghosts?: typeof union.ghosts) =>
    toFlowElements(
      await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure })),
      graph,
      '/',
      fakeMeasure,
      undefined,
      ghosts
    );
  const drawWith = (
    theme: 'light' | 'dark',
    layout: SystemLevelLayout,
    ghosts: typeof union.ghosts | undefined,
    legend = false
  ) =>
    renderSystemLevelSvg(layout, {
      palette: paletteFor(theme),
      grid: false,
      legend,
      background: 'transparent',
      fontFaceCss: '',
      changes: changeDecor(layout, {
        marks: buildChangeMarks(diff, current, ghosts),
        graph: current,
        levelPath: '/',
      }),
    });
  const nodeBody = (svg: string, id: string) => {
    const start = svg.indexOf(`data-node="${id}"`);
    return svg.slice(start, svg.indexOf('data-node=', start + 1));
  };

  beforeAll(async () => {
    union = withUnion(current, zynqUnion());
    unionLayout = await layoutOf(union.graph, union.ghosts);
    plainLayout = await layoutOf(current);
  }, 30000);

  it.each(['light', 'dark'] as const)(
    'draws a removed block dashed in the removed color, struck through, dimmed, with its sign (%s)',
    (theme) => {
      const { removed } = paletteFor(theme).change;
      const svg = drawWith(theme, unionLayout, union.ghosts);
      const body = nodeBody(svg, GHOST);
      const border = /<rect[^>]* stroke="[^"]*" [^>]*>/.exec(body)![0];
      expect(border).toContain(`stroke="${removed}"`);
      expect(border).toContain('stroke-dasharray="4 3"');
      // No ring, as for a version-only change.
      expect(body).not.toContain('x="-0.5"');
      expect(body).toMatch(/<text[^>]* text-decoration="line-through"[^>]*>axi_gpio_0<\/text>/);
      expect(body).toMatch(new RegExp(`<text[^>]* fill="${removed}"[^>]*>−</text>`));
      expect(body).toContain('<g opacity="0.65">');
      // The header is not dimmed: the opacity group follows the name.
      expect(body.indexOf('axi_gpio_0')).toBeLessThan(body.indexOf('<g opacity="0.65">'));
    }
  );

  it.each(['light', 'dark'] as const)(
    'draws a removed external port dashed and struck through, with its sign (%s)',
    (theme) => {
      const { removed } = paletteFor(theme).change;
      const portId = unionLayout.nodes.find(
        (node) => node.type === 'boundary' && node.id.endsWith('led_o')
      )!.id;
      const port = nodeBody(drawWith(theme, unionLayout, union.ghosts), portId);
      const shape = /<path[^>]*>/.exec(port)![0];
      expect(shape).toContain(`stroke="${removed}"`);
      expect(shape).toContain('stroke-dasharray="4 3"');
      expect(port).toMatch(/<text[^>]* text-decoration="line-through"[^>]*>led_o<\/text>/);
      expect(port).toMatch(new RegExp(`<text[^>]* fill="${removed}"[^>]*>−</text>`));
    }
  );

  it.each(['light', 'dark'] as const)(
    'strikes through the pin a block lost, in the removed color, and no other (%s)',
    (theme) => {
      const { removed } = paletteFor(theme).change;
      const periph = nodeBody(drawWith(theme, unionLayout, union.ghosts), '/axi_periph');
      expect(periph).toMatch(
        new RegExp(
          `<text[^>]* fill="${removed}"[^>]*text-decoration="line-through"[^>]*>M00_AXI</text>`
        )
      );
      expect(periph.match(/line-through/g)).toHaveLength(1);
    }
  );

  it.each(['light', 'dark'] as const)(
    'draws a removed wire dashed in the removed color (%s)',
    (theme) => {
      const { removed } = paletteFor(theme).change;
      const svg = drawWith(theme, unionLayout, union.ghosts);
      const dashed =
        svg.match(/<path[^>]* stroke="[^"]*"[^>]* stroke-dasharray="6 4"[^>]*>/g) ?? [];
      expect(dashed.length).toBeGreaterThan(0);
      expect(dashed.every((path) => path.includes(`stroke="${removed}"`))).toBe(true);
    }
  );

  it.each(['light', 'dark'] as const)(
    'names the removed kind and wire in the legend instead of counting them (%s)',
    (theme) => {
      const { removed } = paletteFor(theme).change;
      const legend = /<g data-legend[^>]*>.*?<\/g>/.exec(
        drawWith(theme, unionLayout, union.ghosts, true)
      )![0];
      expect(legend).toMatch(new RegExp(`<text[^>]* fill="${removed}"[^>]*>−</text>`));
      expect(legend).toContain('>Removed<');
      expect(legend).toContain('>Removed wire<');
      expect(legend).not.toMatch(/\d+ removed</);
      expect(legend).toContain('stroke-dasharray="3 2"');
      expect(legend).toContain('stroke-dasharray="6 4"');
    }
  );

  it('keeps the row of a pin whose ghost is not drawn empty, so no label moves', () => {
    const drawn = nodeBody(drawWith('light', unionLayout, union.ghosts), '/axi_periph');
    const hiddenLayout = withoutGhosts(
      { nodes: [...unionLayout.nodes], edges: [...unionLayout.edges] },
      union.ghosts
    );
    const hidden = nodeBody(drawWith('light', hiddenLayout, undefined), '/axi_periph');
    expect(drawn).toContain('>M00_AXI</text>');
    expect(hidden).not.toContain('>M00_AXI</text>');
    expect(hidden).not.toContain('line-through');
    // The pins that stay are where they were drawn with the ghost, and the block is as tall.
    const y = (body: string, label: string) =>
      new RegExp(`<text[^>]* y="([^"]*)"[^>]*>${label}</text>`).exec(body)![1];
    for (const label of ['ACLK', 'S00_AXI', 'M01_AXI']) {
      expect(y(hidden, label)).toBe(y(drawn, label));
    }
    expect(hiddenLayout.nodes.some((node) => node.id === '/axi_gpio_0')).toBe(false);
  });

  it('draws the ghost of a removed hierarchy as one block: no expand toggle, no cell count', () => {
    const hier = plainLayout.nodes.find((node) => node.id === '/gpio_block')!;
    expect(hier.type).toBe('instance');
    const draw = (status?: 'removed') =>
      nodeBody(
        renderSystemLevelSvg(plainLayout, {
          palette: paletteFor('light'),
          grid: false,
          legend: false,
          background: 'transparent',
          fontFaceCss: '',
          changes: {
            nodes: new Map(status ? [['/gpio_block', { status, title: 'Removed' }]] : []),
            newEdgeIds: new Set(),
            legend: { kinds: [], newWire: false, removed: 0 },
          },
        }),
        '/gpio_block'
      );
    const plain = draw();
    expect(plain).toContain('>Hierarchy · 1 cells</text>');
    // The expand toggle is the boxed [+] of `toggleSvg`.
    expect(plain).toContain('rx="2.5"');
    const ghost = draw('removed');
    expect(ghost).toContain('>Hierarchy</text>');
    expect(ghost).not.toContain('cells');
    expect(ghost).not.toContain('rx="2.5"');
    expect(ghost).toMatch(/<text[^>]* text-decoration="line-through"[^>]*>gpio_block<\/text>/);
    // The name starts where it would in a block without a toggle.
    const x = (body: string) => Number(/<text x="([^"]*)"[^>]*>gpio_block<\/text>/.exec(body)![1]);
    expect(x(ghost)).toBeLessThan(x(plain));
  });

  it('draws no ghost without the union: the removed things are only counted, as before', () => {
    const svg = drawWith('light', plainLayout, undefined, true);
    expect(svg).not.toContain('line-through');
    expect(svg).not.toContain(paletteFor('light').change.removed);
    expect(svg).toContain('>− 2 removed<');
    expect(svg).not.toContain('Removed wire');
  });
});
