import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { TwoPanelEditorLayout } from '../../../webview/shared/components/TwoPanelEditorLayout';

function mockWidth(el: HTMLElement, width: number) {
  el.getBoundingClientRect = (() => ({
    top: 0,
    left: 0,
    bottom: 400,
    right: width,
    width,
    height: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })) as unknown as typeof el.getBoundingClientRect;
}

describe('TwoPanelEditorLayout — resizable side-by-side', () => {
  it('renders a drag handle between the panes', () => {
    const { container } = render(
      <TwoPanelEditorLayout
        header={null}
        visualizer={<div data-testid="viz" />}
        table={<div data-testid="tbl" />}
        layout="side-by-side"
      />
    );
    expect(container.querySelector('.panel-resize-handle')).not.toBeNull();
    expect(container.querySelector('.register-visualizer-pane')).not.toBeNull();
  });

  it('does not render a handle in stacked layout', () => {
    const { container } = render(
      <TwoPanelEditorLayout header={null} visualizer={<div />} table={<div />} layout="stacked" />
    );
    expect(container.querySelector('.panel-resize-handle')).toBeNull();
  });

  it('widens the visualizer pane when dragging the handle', () => {
    const { container } = render(
      <TwoPanelEditorLayout
        header={null}
        visualizer={<div data-testid="viz" />}
        table={<div data-testid="tbl" />}
        layout="side-by-side"
      />
    );
    const handle = container.querySelector('.panel-resize-handle') as HTMLElement;
    // The handle's parent is the flex container measured during the drag.
    mockWidth(handle.parentElement as HTMLElement, 1000);

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    const pane = container.querySelector('.register-visualizer-pane') as HTMLElement;
    // 600px is within [240, 760] (1000 - 240) so it is applied directly.
    expect(pane.style.width).toBe('600px');
    expect(pane.style.maxWidth).toBe('none');
  });

  it('clamps the pane width to the minimum on a very small drag', () => {
    const { container } = render(
      <TwoPanelEditorLayout
        header={null}
        visualizer={<div />}
        table={<div />}
        layout="side-by-side"
      />
    );
    const handle = container.querySelector('.panel-resize-handle') as HTMLElement;
    mockWidth(handle.parentElement as HTMLElement, 1000);

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    const pane = container.querySelector('.register-visualizer-pane') as HTMLElement;
    expect(pane.style.width).toBe('240px');
  });
});
