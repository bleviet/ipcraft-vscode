import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BundleDetails } from '../../../../webview/systemDiagram/BundleDetails';
import { bundlingGraph } from './bundlingGraph';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { fakeMeasure } from './fixtureGraph';

const graph = bundlingGraph();

async function bundleEdge() {
  const busBundling = { unbundled: new Set<string>() };
  const input = buildElkInput(graph, '/', { measure: fakeMeasure, busBundling });
  const flow = toFlowElements(
    await runElkLayout(input),
    graph,
    '/',
    fakeMeasure,
    undefined,
    busBundling
  );
  return flow.edges.find((edge) => edge.data.bundle)!;
}

function setup(edge: Awaited<ReturnType<typeof bundleEdge>>, isolatable = true) {
  const handlers = {
    onSelect: jest.fn(),
    onUnbundle: jest.fn(),
    onIsolate: jest.fn(),
  };
  render(<BundleDetails graph={graph} edge={edge} isolatable={() => isolatable} {...handlers} />);
  return handlers;
}

describe('BundleDetails', () => {
  it('names the bundle, its two blocks and its member connections', async () => {
    setup(await bundleEdge());
    expect(screen.getByText('Bus bundle')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '×3 AXI4-Stream' })).toBeInTheDocument();
    expect(screen.getByText('from src to dst')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'm_a → s_a n_a',
      'm_b → s_b n_b',
      'm_c → s_c n_c',
    ]);
  }, 20000);

  it('selects one net from its link', async () => {
    const { onSelect } = setup(await bundleEdge());
    fireEvent.click(screen.getByRole('button', { name: 'm_c → s_c' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'net', id: '/::n_c' });
  }, 20000);

  it('unbundles by key and isolates the pair', async () => {
    const edge = await bundleEdge();
    const { onUnbundle, onIsolate } = setup(edge);
    fireEvent.click(screen.getByRole('button', { name: 'Unbundle' }));
    expect(onUnbundle).toHaveBeenCalledWith('bundle:/src->/dst|axis|i');
    fireEvent.click(screen.getByRole('button', { name: 'Isolate pair' }));
    expect(onIsolate).toHaveBeenCalledWith(['/src', '/dst']);
  }, 20000);

  it('disables Isolate pair when the blocks cannot be isolated', async () => {
    setup(await bundleEdge(), false);
    expect(screen.getByRole('button', { name: 'Isolate pair' })).toBeDisabled();
  }, 20000);
});
