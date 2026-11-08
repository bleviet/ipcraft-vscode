import type { ElkNode } from 'elkjs/lib/elk-api';
import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { computePathTrace, traceSubset } from '../../../../webview/systemDiagram/pathTrace';
import { fakeMeasure, loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const LAYER = 'elk.layered.layering.layerConstraint';
const PARTITION = 'elk.partitioning.partition';

// A tier-3 path against the signal direction, starting at a sink port.
const FROM = boundaryId('/', 'leds_4bits');
const TO = '/processing_system7_0';
const trace = computePathTrace(graph, '/', FROM, TO)!;
const subset = traceSubset(graph, '/', trace);
const child = (input: ElkNode, id: string) => input.children!.find((node) => node.id === id)!;

describe('buildElkInput of a traced path', () => {
  it('partitions the nodes by hop index and gives boundary nodes no layer constraint', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, isolate: subset });
    expect(input.layoutOptions).toMatchObject({ 'elk.partitioning.activate': 'true' });
    trace.order.forEach((id, index) => {
      expect(child(input, id).layoutOptions?.[PARTITION]).toBe(String(index));
    });
    expect(child(input, FROM).layoutOptions).not.toHaveProperty(LAYER);
  });

  it('is unchanged without an order', () => {
    const plain = isolationSubset(graph, '/', [FROM, TO]);
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, isolate: plain });
    expect(input.layoutOptions).not.toHaveProperty('elk.partitioning.activate');
    for (const node of input.children!) {
      expect(node.layoutOptions).not.toHaveProperty(PARTITION);
    }
    expect(child(input, FROM).layoutOptions).not.toHaveProperty(LAYER);
  });

  it('lays the path out left to right with the hop badges on the nodes', async () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, isolate: subset });
    const laidOut = await runElkLayout(input);
    const { nodes } = toFlowElements(
      laidOut,
      graph,
      '/',
      fakeMeasure,
      undefined,
      undefined,
      subset
    );
    const xs = trace.order.map((id) => nodes.find((node) => node.id === id)!.position.x);
    xs.slice(1).forEach((x, index) => expect(x).toBeGreaterThan(xs[index]));
    const hops = trace.order.map(
      (id) => (nodes.find((node) => node.id === id)!.data as { hopIndex?: number }).hopIndex
    );
    expect(hops).toEqual([1, 2, 3, 4]);
  }, 20000);

  it('draws no hop badge without an order', async () => {
    const plain = isolationSubset(graph, '/', [TO]);
    const laidOut = await runElkLayout(
      buildElkInput(graph, '/', { measure: fakeMeasure, isolate: plain })
    );
    const { nodes } = toFlowElements(laidOut, graph, '/', fakeMeasure, undefined, undefined, plain);
    expect(nodes.every((node) => !('hopIndex' in node.data))).toBe(true);
  }, 20000);

  it('lays the path out left to right with bundling, folding and an expanded block on it', async () => {
    const found = computePathTrace(graph, '/', '/axi_dma_0', '/dsp_pipeline')!;
    const path = traceSubset(graph, '/', found);
    const options = {
      measure: fakeMeasure,
      isolate: path,
      busBundling: { unbundled: new Set<string>() },
      pinFolding: { open: new Set<string>() },
      expanded: new Set(['/dsp_pipeline']),
    };
    const laidOut = await runElkLayout(buildElkInput(graph, '/', options));
    const { nodes } = toFlowElements(
      laidOut,
      graph,
      '/',
      fakeMeasure,
      options.pinFolding,
      options.busBundling,
      path
    );
    const xs = found.order.map((id) => nodes.find((node) => node.id === id)!.position.x);
    xs.slice(1).forEach((x, index) => expect(x).toBeGreaterThan(xs[index]));
    expect(
      found.order.map(
        (id) => (nodes.find((node) => node.id === id)!.data as { hopIndex?: number }).hopIndex
      )
    ).toEqual([1, 2]);
  }, 20000);
});
