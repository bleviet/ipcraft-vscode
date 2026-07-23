import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';

const ipCore = {
  vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
  clocks: [{ name: 'clk', direction: 'in', frequency: 100000000 }],
  resets: [{ name: 'rst_n', direction: 'in', polarity: 'activeLow' }],
  interrupts: [{ name: 'irq', direction: 'out', sensitivity: 'LEVEL_HIGH' }],
  subcores: [{ vlnv: 'vendor:lib:child:1.0', path: 'child.ip.yml' }],
} as unknown as IpCore;

function renderSelection(kind: CanvasElement['kind'], index = 0) {
  const onUpdate = jest.fn();
  const result = render(
    <CanvasInspector
      selected={{ kind, index, id: `${kind}:${index}` }}
      ipCore={ipCore}
      onUpdate={onUpdate}
      onClose={jest.fn()}
    />
  );
  return { ...result, onUpdate };
}

describe('CanvasInspector shell and feature routing', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('routes clock edits to the clocks path', () => {
    const { onUpdate } = renderSelection('clock');
    const frequency = screen.getByDisplayValue('100000000');
    fireEvent.change(frequency, { target: { value: '125000000' } });
    fireEvent.blur(frequency);
    expect(onUpdate).toHaveBeenCalledWith(['clocks', 0, 'frequency'], '125000000');
  });

  it('routes reset and interrupt select edits to their own collections', () => {
    const reset = renderSelection('reset');
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'activeHigh' },
    });
    expect(reset.onUpdate).toHaveBeenCalledWith(['resets', 0, 'polarity'], 'activeHigh');
    reset.unmount();

    const interrupt = renderSelection('interrupt');
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'EDGE_RISING' },
    });
    expect(interrupt.onUpdate).toHaveBeenCalledWith(
      ['interrupts', 0, 'sensitivity'],
      'EDGE_RISING'
    );
  });

  it('routes dependency edits and missing selections without hidden state', () => {
    const { onUpdate, unmount } = renderSelection('subcore');
    const vlnv = screen.getByDisplayValue('vendor:lib:child:1.0');
    fireEvent.change(vlnv, { target: { value: 'vendor:lib:renamed:1.0' } });
    fireEvent.blur(vlnv);
    expect(onUpdate).toHaveBeenCalledWith(
      ['subcores'],
      [{ vlnv: 'vendor:lib:renamed:1.0', path: 'child.ip.yml' }]
    );
    unmount();

    renderSelection('clock', 99);
    expect(screen.getByText('Clock not found')).toBeInTheDocument();
  });

  it('restores and persists shell width while resizing', () => {
    sessionStorage.setItem('ipcraft.inspectorWidth', '420');
    const { container } = renderSelection('body');
    const panel = container.querySelector('.canvas-inspector') as HTMLElement;
    const handle = container.querySelector('.ci-resize-handle') as HTMLElement;
    expect(panel).toHaveStyle({ width: '420px' });

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 450 });
    fireEvent.mouseUp(document);

    expect(panel).toHaveStyle({ width: '470px' });
    expect(sessionStorage.getItem('ipcraft.inspectorWidth')).toBe('470');
  });
});
