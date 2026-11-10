import { paletteFor } from '../../../../shared/render/palette';
import { renderSystemLevelSvg } from '../../../../shared/render/systemLevelSvg';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
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
