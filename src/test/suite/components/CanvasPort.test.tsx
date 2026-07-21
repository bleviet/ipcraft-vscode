import React from 'react';
import { render } from '@testing-library/react';
import { CanvasPort } from '../../../webview/ipcore/components/canvas/CanvasPort';
import type { LayoutPort } from '../../../webview/ipcore/components/canvas/canvasLayout';

function resetPort(polarity: 'activeHigh' | 'activeLow'): LayoutPort {
  return {
    id: 'reset:0',
    x: 100,
    y: 100,
    side: 'left',
    kind: 'reset',
    label: 'user_defined_reset',
    widthLabel: '',
    direction: 'in',
    polarity,
    data: {},
    clockDomainIdx: -1,
  };
}

function interruptPort(sensitivity: NonNullable<LayoutPort['sensitivity']>): LayoutPort {
  return {
    id: 'interrupt:0',
    x: 100,
    y: 100,
    side: 'right',
    kind: 'interrupt',
    label: 'user_defined_irq',
    widthLabel: '',
    direction: 'out',
    sensitivity,
    data: {},
    clockDomainIdx: -1,
  };
}

describe('CanvasPort reset polarity', () => {
  it('shows an L badge and inversion bubble for an active-low reset', () => {
    const { container } = render(
      <svg>
        <CanvasPort port={resetPort('activeLow')} selected={false} onSelect={jest.fn()} />
      </svg>
    );

    const port = container.querySelector('[data-port-id="reset:0"]');
    expect(port).toHaveAttribute('data-reset-polarity', 'activeLow');
    expect(port).toHaveAttribute('aria-label', 'user_defined_reset: active-low reset');
    expect(container.querySelector('.canvas-port__inversion-bubble')).toBeInTheDocument();
    const badge = container.querySelector('.canvas-port__polarity-badge');
    expect(badge).toHaveAttribute('transform', 'translate(13, 0)');
    expect(badge?.textContent).toBe('L');
  });

  it('shows an H badge without an inversion bubble for an active-high reset', () => {
    const { container } = render(
      <svg>
        <CanvasPort port={resetPort('activeHigh')} selected={false} onSelect={jest.fn()} />
      </svg>
    );

    expect(container.querySelector('[data-port-id="reset:0"]')).toHaveAttribute(
      'aria-label',
      'user_defined_reset: active-high reset'
    );
    expect(container.querySelector('.canvas-port__inversion-bubble')).not.toBeInTheDocument();
    expect(container.querySelector('.canvas-port__polarity-badge')?.textContent).toBe('H');
  });
});

describe('CanvasPort interrupt sensitivity', () => {
  it.each([
    ['LEVEL_HIGH', 'level-high'],
    ['LEVEL_LOW', 'level-low'],
    ['EDGE_RISING', 'rising-edge'],
    ['EDGE_FALLING', 'falling-edge'],
  ] as const)('shows the %s sensitivity modifier', (sensitivity, label) => {
    const { container } = render(
      <svg>
        <CanvasPort port={interruptPort(sensitivity)} selected={false} onSelect={jest.fn()} />
      </svg>
    );

    const port = container.querySelector('[data-port-id="interrupt:0"]');
    expect(port).toHaveAttribute('data-interrupt-sensitivity', sensitivity);
    expect(port).toHaveAttribute('aria-label', `user_defined_irq: ${label} interrupt`);

    const modifier = container.querySelector(
      `.canvas-port__interrupt-sensitivity--${sensitivity.toLowerCase().replace('_', '-')}`
    );
    expect(modifier).toHaveAttribute('transform', 'translate(-14, 0)');
    expect(modifier?.querySelector('[data-svg-mock="true"]')).toBeInTheDocument();
  });
});
