import { paletteFor } from '../../../../shared/render/palette';
import { renderSystemLevelSvg } from '../../../../shared/render/systemLevelSvg';
import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/elkLayout';

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
