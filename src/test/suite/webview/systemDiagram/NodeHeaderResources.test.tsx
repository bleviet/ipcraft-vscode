import { render } from '@testing-library/react';
import React from 'react';
import { NodeHeader } from '../../../../webview/systemDiagram/NodeHeader';
import { HEADER_HEIGHT } from '../../../../webview/systemDiagram/layout/elkLayout';
import { nodeResources } from '../../../../webview/systemDiagram/resources/resourceView';
import { oocReport, quartusReport, vivadoGraph, vivadoReport } from './resources/resourceReports';

const subtitle = (container: HTMLElement) => container.querySelector('.sd-node-subtitle')!;
const strip = (container: HTMLElement) => container.querySelector('.sd-node-usage');
const lines = (container: HTMLElement) =>
  Array.from(strip(container)?.children ?? [], (line) => line.textContent);

describe('NodeHeader with resources', () => {
  const instance = vivadoGraph.instances['/axi_bram_ctrl_0'];
  const header = (resources?: ReturnType<typeof nodeResources>) =>
    render(<NodeHeader instance={instance} cellCount={0} resources={resources} expanded={false} />)
      .container;

  it('keeps the subtitle and draws the four metrics in a strip, with the tooltip and the share bar', () => {
    const plain = header();
    const container = header(nodeResources(vivadoReport, instance.path));
    expect(subtitle(container).textContent).toBe(subtitle(plain).textContent);
    expect(lines(container)).toEqual([
      '154 LUT · 168 FF · 0 BRAM · 0 DSP',
      '18.3 % design · 0.2 % device',
    ]);
    expect(strip(container)).not.toHaveAttribute('data-muted');
    expect(subtitle(container).getAttribute('title')).toMatch(/^Post-route: LUTs 154 \(18\.3 %/);
    const bar = container.querySelector<HTMLElement>('.sd-node-share')!;
    expect(parseFloat(bar.style.width)).toBeCloseTo((154 / 841) * 100);
    expect(bar.style.top).toBe(`${HEADER_HEIGHT - 3}px`);
    expect(bar.style.height).toBe('3px');
    expect(container.querySelector('.sd-node-head')).toHaveStyle({ height: `${HEADER_HEIGHT}px` });
  });

  it('prefixes a summed hierarchy with a sigma', () => {
    const container = header(nodeResources(oocReport, '/hier_0'));
    expect(lines(container)).toEqual(['Σ 5 LUT · 6 FF · 2 BRAM · 0 DSP', '0.6 % design']);
  });

  it('shows not in report, muted, and no bar', () => {
    const container = header(nodeResources(quartusReport, '/clk_0'));
    expect(lines(container)).toEqual(['not in report']);
    expect(strip(container)).toHaveAttribute('data-muted', 'true');
    expect(container.querySelector('.sd-node-share')).toBeNull();
  });

  it('shows no block report in the per-block stage', () => {
    const container = header(nodeResources(oocReport, '/hier_0/axi_gpio_1'));
    expect(lines(container)).toEqual(['no block report']);
  });

  it('has no strip, tooltip or bar without resources', () => {
    const container = header();
    expect(strip(container)).toBeNull();
    expect(subtitle(container)).not.toHaveAttribute('title');
    expect(container.querySelector('.sd-node-share')).toBeNull();
  });
});
