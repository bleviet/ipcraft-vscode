import type { ElkPort } from 'elkjs/lib/elk-api';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import {
  badgeOfPort,
  clockResetNetsByEndpoint,
  shortNetName,
  sourceInstance,
} from '../../../../webview/systemDiagram/layout/netBadges';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { NetBadgeView } from '../../../../webview/systemDiagram/NetBadgeView';
import { loadQsysFixtureGraph, fakeMeasure } from './fixtureGraph';

const graph = loadQsysFixtureGraph();

function reservedPort(instance: string, pin: string): ElkPort {
  const input = buildElkInput(graph, '/', { measure: fakeMeasure });
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
      clockResetNetsByEndpoint(graph, '/').get('/jtag_uart_0::reset')
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
    const result = await runElkLayout(buildElkInput(odd, '/', { measure: fakeMeasure }));
    const { nodes } = toFlowElements(result, odd, '/', fakeMeasure);
    const jtag = nodes.find((node) => node.id === '/jtag_uart_0');
    const row =
      jtag?.type === 'instance' ? jtag.data.west.find((r) => r.name === 'reset') : undefined;
    expect(row?.badge?.netId).toBe('/::clk_0.clk_reset\nline2');
    expect(row?.badge?.nets.map((n) => n.id)).toContain('/::clk_0.clk_reset\nline2');
  }, 20000);
});

describe('shortNetName', () => {
  it('drops the driver instance prefix of Vivado net names', () => {
    expect(shortNetName('processing_system7_0_FCLK_CLK0', 'processing_system7_0')).toBe(
      'FCLK_CLK0'
    );
    expect(shortNetName('rst_ps7_0_100M_peripheral_aresetn', 'rst_ps7_0_100M')).toBe(
      'peripheral_aresetn'
    );
  });

  it('keeps names without the prefix, equal to the instance, or without a driver', () => {
    expect(shortNetName('clk_0.clk', 'clk_0')).toBe('clk_0.clk');
    expect(shortNetName('ps7', 'ps7')).toBe('ps7');
    expect(shortNetName('ps7_', 'ps7')).toBe('ps7_');
    expect(shortNetName('ext_clk', undefined)).toBe('ext_clk');
  });
});

describe('sourceInstance', () => {
  it('finds the instance whose pin sources the net', () => {
    const net = graph.nets.find((candidate) => candidate.id === '/::clk_0.clk_reset')!;
    expect(sourceInstance(graph, net)).toBe('/clk_0');
  });

  it('is undefined when no endpoint resolves to a source pin', () => {
    const net = graph.nets.find((candidate) => candidate.id === '/::clk_0.clk_reset')!;
    const sinksOnly = {
      ...net,
      endpoints: net.endpoints.filter((ref) => ref.instance !== '/clk_0'),
    };
    expect(sourceInstance(graph, sinksOnly)).toBeUndefined();
  });

  it('falls back to the first endpoint when its direction is unknown', () => {
    const net = graph.nets.find((candidate) => candidate.id === '/::clk_0.clk_reset')!;
    const unknown = JSON.parse(JSON.stringify(graph)) as typeof graph;
    for (const ref of net.endpoints) {
      for (const pin of unknown.instances[ref.instance ?? '']?.pins ?? []) {
        pin.direction = 'unknown';
      }
    }
    expect(sourceInstance(unknown, net)).toBe(net.endpoints[0].instance);
  });
});
