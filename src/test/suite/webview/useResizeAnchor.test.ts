import { renderHook } from '@testing-library/react';
import { useResizeAnchor } from '../../../webview/ipcore/hooks/useResizeAnchor';
import {
  layoutPointAt,
  type Point,
} from '../../../webview/ipcore/components/canvas/canvasGeometry';

type Size = { width: number; height: number };

describe('useResizeAnchor', () => {
  const vb = { width: 400, height: 300 };
  let fire: () => void;
  let size: Size;
  let container: HTMLDivElement;
  const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      disconnect() {}
    };
    size = { width: 800, height: 600 };
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: size.width, height: size.height }) as DOMRect;
  });
  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
  });

  function setup(engaged: boolean, zoom = 1) {
    const panRef = { current: { x: 0, y: 0 } };
    const setPan = jest.fn((p: Point) => (panRef.current = p));
    const containerRef = { current: container };
    const hook = renderHook(
      (props: { engaged: boolean }) =>
        useResizeAnchor({
          containerRef,
          viewBox: vb,
          zoom,
          currentPanRef: panRef,
          setPan,
          engaged: props.engaged,
        }),
      { initialProps: { engaged } }
    );
    fire(); // initial observation records the size
    return { panRef, setPan, hook };
  }

  it('keeps the hovered point under the pointer when the details row shrinks the canvas', () => {
    const { panRef, hook } = setup(false);
    const pointer = { x: 610, y: 420 };
    container.dispatchEvent(
      new MouseEvent('mousemove', { clientX: pointer.x, clientY: pointer.y })
    );
    const before = layoutPointAt(vb, size, panRef.current, 1, pointer);
    hook.rerender({ engaged: true });
    size = { width: 800, height: 380 };
    fire();
    const after = layoutPointAt(vb, size, panRef.current, 1, pointer);
    expect(after.x).toBeCloseTo(before.x);
    // the symbol fills the height of the shrunk canvas: anchoring y would push it behind the row
    expect(panRef.current.y).toBeCloseTo(0);
    const topLeft = layoutPointAt(vb, size, panRef.current, 1, { x: 0, y: 0 });
    const bottomRight = layoutPointAt(vb, size, panRef.current, 1, {
      x: size.width,
      y: size.height,
    });
    expect(topLeft.x).toBeLessThanOrEqual(0);
    expect(topLeft.y).toBeLessThanOrEqual(1e-9);
    expect(bottomRight.x).toBeGreaterThanOrEqual(vb.width);
    expect(bottomRight.y).toBeGreaterThanOrEqual(vb.height - 1e-9);
  });

  it('keeps the point fully when the shrunk canvas has room around the (zoomed-out) symbol', () => {
    const { panRef, hook } = setup(false, 0.5);
    const pointer = { x: 450, y: 330 };
    container.dispatchEvent(
      new MouseEvent('mousemove', { clientX: pointer.x, clientY: pointer.y })
    );
    const before = layoutPointAt(vb, size, panRef.current, 0.5, pointer);
    hook.rerender({ engaged: true });
    size = { width: 800, height: 500 };
    fire();
    const after = layoutPointAt(vb, size, panRef.current, 0.5, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('undoes the shift once the row closed with the pointer outside', () => {
    const { panRef, hook } = setup(true);
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 610, clientY: 420 }));
    size = { width: 800, height: 380 };
    fire();
    expect(panRef.current).not.toEqual({ x: 0, y: 0 });
    container.dispatchEvent(new MouseEvent('mouseleave'));
    hook.rerender({ engaged: false });
    size = { width: 800, height: 600 };
    fire();
    expect(panRef.current.x).toBeCloseTo(0);
    expect(panRef.current.y).toBeCloseTo(0);
  });

  it('ignores resizes while no details row is involved', () => {
    const { setPan } = setup(false);
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 610, clientY: 420 }));
    size = { width: 700, height: 500 };
    fire();
    expect(setPan).not.toHaveBeenCalled();
  });
});
