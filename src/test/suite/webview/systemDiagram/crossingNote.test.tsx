import React from 'react';
import { render, screen } from '@testing-library/react';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import { CrossingNote } from '../../../../webview/systemDiagram/CrossingNote';
import { loadPortClocksGraph, loadVersalClockGraph } from './fixtureGraph';

const first = (graphLoader: typeof loadVersalClockGraph, status: string): PinCrossing =>
  analyzeClocks(graphLoader()).crossings.find(
    (crossing): crossing is PinCrossing => crossing.kind !== 'block' && crossing.status === status
  )!;

describe('CrossingNote', () => {
  it('says related clocks, with the reason and a single period', () => {
    const { container } = render(
      <CrossingNote crossing={first(loadVersalClockGraph, 'related')} />
    );
    expect(screen.getByText('Related clocks.')).toBeVisible();
    expect(container.textContent).toBe(
      'Related clocks. Both clocks come from clk_wizard_0; Vivado times paths between its outputs.'
    );
  });

  it('ends a not-checked reason with one period', () => {
    const { container } = render(
      <CrossingNote crossing={first(loadPortClocksGraph, 'unchecked')} />
    );
    expect(container.textContent).toBe(
      'Clock domains not checked: Both clocks enter through ports (s_axi_aclk, m_axis_clk); the top level decides whether they are the same clock.'
    );
  });
});
