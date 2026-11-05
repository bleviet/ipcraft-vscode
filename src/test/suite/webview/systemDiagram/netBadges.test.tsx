import type { ElkPort } from 'elkjs/lib/elk-api';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import {
  badgeOfPort,
  hiddenNetsByEndpoint,
} from '../../../../webview/systemDiagram/layout/netBadges';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { NetBadgeView } from '../../../../webview/systemDiagram/NetBadgeView';
import { loadQsysFixtureGraph, fakeMeasure } from './fixtureGraph';

const graph = loadQsysFixtureGraph();

function reservedPort(instance: string, pin: string): ElkPort {
  const input = buildElkInput(graph, '/', { showClockReset: false, measure: fakeMeasure });
  const port = input.children
    ?.find((node) => node.id === instance)
    ?.ports?.find((candidate) => candidate.id === `${instance}::${pin}`);
  return { ...port!, x: 0, y: 0, labels: port!.labels?.map((label) => ({ ...label, x: 0, y: 0 })) };
}

describe('net badges of pins on several hidden nets', () => {
  it('shows one badge with the first net and +N for the others', () => {
    const port = reservedPort('/jtag_uart_0', 'reset');
    expect(port.labels).toHaveLength(1);
    expect(port.labels?.[0].text).toBe('clk_0.clk_reset +1');
    const single = reservedPort('/nios2_gen2_0', 'clk');
    expect(single.labels?.[0].text).toBe('clk_0.clk');
  });

  it('lists every hidden net in the tooltip and selects the first on click', () => {
    const badge = badgeOfPort(
      reservedPort('/jtag_uart_0', 'reset'),
      hiddenNetsByEndpoint(graph, '/', false).get('/jtag_uart_0::reset')
    )!;
    expect(badge.netId).toBe('/::clk_0.clk_reset');
    expect(badge.nets.map((net) => net.name)).toEqual([
      'clk_0.clk_reset',
      'nios2_gen2_0.debug_reset_request',
    ]);
    const onSelectNet = jest.fn();
    render(<NetBadgeView badge={badge} onSelectNet={onSelectNet} />);
    const button = screen.getByTitle(/clk_0\.clk_reset, nios2_gen2_0\.debug_reset_request/);
    expect(button).toHaveTextContent('clk_0.clk_reset +1');
    fireEvent.click(button);
    expect(onSelectNet).toHaveBeenCalledWith('/::clk_0.clk_reset');
  });

  it('still renders a badge when a net id contains a newline', async () => {
    const odd = JSON.parse(JSON.stringify(graph)) as typeof graph;
    const net = odd.nets.find((candidate) => candidate.id === '/::clk_0.clk_reset')!;
    net.id = '/::clk_0.clk_reset\nline2';
    net.name = 'clk_0.clk_reset\nline2';
    const result = await runElkLayout(
      buildElkInput(odd, '/', { showClockReset: false, measure: fakeMeasure })
    );
    const { nodes } = toFlowElements(result, odd, '/', fakeMeasure);
    const jtag = nodes.find((node) => node.id === '/jtag_uart_0');
    const row =
      jtag?.type === 'instance' ? jtag.data.west.find((r) => r.name === 'reset') : undefined;
    expect(row?.badge?.netId).toBe('/::clk_0.clk_reset\nline2');
    expect(row?.badge?.nets.map((n) => n.id)).toContain('/::clk_0.clk_reset\nline2');
  }, 20000);
});
