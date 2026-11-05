import React, { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePanelResize } from '../../../../webview/systemDiagram/hooks/usePanelResize';
import type { PanelEdge } from '../../../../webview/systemDiagram/layout/panelSizes';
import { ResizeHandle } from '../../../../webview/systemDiagram/ResizeHandle';

function Harness({ edge }: { edge: PanelEdge }) {
  const ref = useRef<HTMLDivElement>(null);
  const panel = usePanelResize(edge, ref);
  return (
    <div ref={ref}>
      <button onClick={panel.toggle}>toggle</button>
      <output data-testid="state">{`${panel.size}:${panel.collapsed}`}</output>
      {!panel.collapsed && <ResizeHandle label="Resize" {...panel.separator} />}
    </div>
  );
}

const separator = () => screen.getByRole('separator', { name: 'Resize' });
const state = () => screen.getByTestId('state').textContent;

/** Renders the harness and opens the panel, which starts collapsed. */
function renderOpen(edge: PanelEdge) {
  const result = render(<Harness edge={edge} />);
  fireEvent.click(screen.getByText('toggle'));
  return result;
}

beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 1000,
    top: 0,
    bottom: 800,
    width: 1000,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => jest.restoreAllMocks());

describe('usePanelResize', () => {
  it('starts collapsed and the first toggle shows the panel at its default size', () => {
    render(<Harness edge="left" />);
    expect(state()).toBe('260:true');
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('toggle'));
    expect(state()).toBe('260:false');
    expect(separator()).toHaveAttribute('aria-valuenow', '260');
  });

  it('exposes an accessible separator', () => {
    renderOpen('left');
    expect(separator()).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator()).toHaveAttribute('aria-valuenow', '260');
    expect(separator()).toHaveAttribute('aria-valuemin', '160');
    expect(separator()).toHaveAttribute('aria-valuemax', '600');
    expect(separator()).toHaveAttribute('tabindex', '0');
  });

  it('resizes by dragging and clamps to the limits', () => {
    renderOpen('left');
    fireEvent.pointerDown(separator(), { pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 350, clientY: 0 });
    expect(state()).toBe('350:false');
    fireEvent.pointerMove(separator(), { clientX: 5000, clientY: 0 });
    expect(state()).toBe('600:false');
    fireEvent.pointerMove(separator(), { clientX: 1, clientY: 0 });
    expect(state()).toBe('160:false');
    fireEvent.pointerUp(separator(), { pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 400, clientY: 0 });
    expect(state()).toBe('160:false');
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)(
    'stops following the pointer after %s',
    (eventName) => {
      renderOpen('left');
      fireEvent.pointerDown(separator(), { pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 350, clientY: 0 });
      expect(state()).toBe('350:false');

      fireEvent[eventName](separator(), { pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 450, clientY: 0 });
      expect(state()).toBe('350:false');
    }
  );

  it('measures the right and bottom panels from their own edges', () => {
    const { unmount } = renderOpen('right');
    fireEvent.pointerDown(separator(), { pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 700, clientY: 0 });
    expect(state()).toBe('300:false');
    unmount();

    renderOpen('bottom');
    expect(separator()).toHaveAttribute('aria-orientation', 'horizontal');
    expect(separator()).toHaveAttribute('aria-valuemax', '560');
    fireEvent.pointerDown(separator(), { pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 0, clientY: 100 });
    expect(state()).toBe('560:false');
  });

  it('changes the size by 16 px with arrow keys and stops at the limits', () => {
    renderOpen('left');
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    expect(state()).toBe('276:false');
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
    expect(state()).toBe('244:false');
    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
    }
    expect(state()).toBe('160:false');
    for (let i = 0; i < 40; i += 1) {
      fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    }
    expect(state()).toBe('600:false');
  });

  it('uses vertical arrows for the bottom panel', () => {
    renderOpen('bottom');
    fireEvent.keyDown(separator(), { key: 'ArrowUp' });
    expect(state()).toBe('216:false');
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
    expect(state()).toBe('216:false');
  });

  it('collapses on double-click and restores the previous size', () => {
    renderOpen('left');
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    fireEvent.doubleClick(separator());
    expect(state()).toBe('276:true');
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('toggle'));
    expect(state()).toBe('276:false');
    expect(separator()).toHaveAttribute('aria-valuenow', '276');
  });

  it('re-clamps the bottom panel when the window shrinks', () => {
    renderOpen('bottom');
    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(separator(), { key: 'ArrowUp' });
    }
    expect(state()).toBe('520:false');
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 400,
      width: 1000,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event('resize'));
    expect(state()).toBe('280:false');
  });
});
