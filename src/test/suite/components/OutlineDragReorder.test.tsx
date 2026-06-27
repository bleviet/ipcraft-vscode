import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import {
  useOutlineDragReorder,
  type OutlineDragProps,
} from '../../../webview/components/outline/useOutlineDragReorder';
import type { OutlineReorder } from '../../../webview/components/outline/types';

// A minimal row that wires the hook's drag props the way the real outline nodes do.
function Row({ id, getDragProps }: { id: string; getDragProps: (id: string) => OutlineDragProps }) {
  const drag = getDragProps(id);
  return (
    <div
      data-testid={`row-${id}`}
      data-outline-id={id}
      style={{ height: 40 }}
      onPointerMove={drag.onRowPointerMove}
      onPointerEnter={drag.onRowPointerEnter}
    >
      {drag.dragHandle}
    </div>
  );
}

function Harness({ onReorder }: { onReorder: (p: OutlineReorder) => void }) {
  const { getDragProps } = useOutlineDragReorder(onReorder);
  return (
    <div>
      <Row id="block-0" getDragProps={getDragProps} />
      <Row id="block-1" getDragProps={getDragProps} />
      <Row id="block-0-reg-0" getDragProps={getDragProps} />
      <Row id="block-0-reg-1" getDragProps={getDragProps} />
    </div>
  );
}

// Register-array child registers: two children in element 0 plus the same
// child in element 1 (to exercise the same-element restriction).
function ArrayHarness({ onReorder }: { onReorder: (p: OutlineReorder) => void }) {
  const { getDragProps } = useOutlineDragReorder(onReorder);
  return (
    <div>
      <Row id="block-0-arrreg-0-el-0-reg-0" getDragProps={getDragProps} />
      <Row id="block-0-arrreg-0-el-0-reg-1" getDragProps={getDragProps} />
      <Row id="block-0-arrreg-0-el-1-reg-0" getDragProps={getDragProps} />
    </div>
  );
}

// jsdom returns all-zero rects; give the row a real height so the top/bottom
// half split in onDragMove is meaningful.
function mockRect(el: HTMLElement, top: number, height: number) {
  el.getBoundingClientRect = (() => ({
    top,
    left: 0,
    bottom: top + height,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })) as unknown as typeof el.getBoundingClientRect;
}

describe('useOutlineDragReorder', () => {
  it('renders a drag handle when onReorder is provided', () => {
    const { container } = render(<Harness onReorder={jest.fn()} />);
    expect(container.querySelectorAll('[aria-label="Drag to reorder"]')).toHaveLength(4);
  });

  it('does not render handles without onReorder', () => {
    const { container } = render(<Harness onReorder={undefined as never} />);
    expect(container.querySelector('[aria-label="Drag to reorder"]')).toBeNull();
  });

  it('reorders blocks: drag block-0 above block-1', () => {
    const onReorder = jest.fn();
    const { container } = render(<Harness onReorder={onReorder} />);

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
    const row1 = container.querySelector('[data-testid="row-block-1"]') as HTMLElement;
    mockRect(row1, 0, 40);

    act(() => {
      fireEvent.pointerDown(handle, { button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(row1, { clientY: 5 }); // top half -> 'before'
    });
    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorder).toHaveBeenCalledWith({
      kind: 'block',
      fromIdx: 0,
      toIdx: 1,
      position: 'before',
    });
  });

  it('reorders registers within the same block', () => {
    const onReorder = jest.fn();
    const { container } = render(<Harness onReorder={onReorder} />);

    const handles = container.querySelectorAll('[aria-label="Drag to reorder"]');
    const reg0Handle = handles[2] as HTMLElement; // block-0-reg-0
    const row1 = container.querySelector('[data-testid="row-block-0-reg-1"]') as HTMLElement;
    mockRect(row1, 0, 40);

    act(() => {
      fireEvent.pointerDown(reg0Handle, { button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(row1, { clientY: 35 }); // bottom half -> 'after'
    });
    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorder).toHaveBeenCalledWith({
      kind: 'register',
      blockIndex: 0,
      fromIdx: 0,
      toIdx: 1,
      position: 'after',
    });
  });

  it('reorders registers within a register array (same element)', () => {
    const onReorder = jest.fn();
    const { container } = render(<ArrayHarness onReorder={onReorder} />);

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement; // el-0-reg-0
    const target = container.querySelector(
      '[data-testid="row-block-0-arrreg-0-el-0-reg-1"]'
    ) as HTMLElement;
    mockRect(target, 0, 40);

    act(() => {
      fireEvent.pointerDown(handle, { button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(target, { clientY: 35 }); // bottom half -> 'after'
    });
    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorder).toHaveBeenCalledWith({
      kind: 'arrayRegister',
      blockIndex: 0,
      arrayIndex: 0,
      fromIdx: 0,
      toIdx: 1,
      position: 'after',
    });
  });

  it('does not reorder array registers across different elements', () => {
    const onReorder = jest.fn();
    const { container } = render(<ArrayHarness onReorder={onReorder} />);

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement; // el-0-reg-0
    const target = container.querySelector(
      '[data-testid="row-block-0-arrreg-0-el-1-reg-0"]'
    ) as HTMLElement;
    mockRect(target, 0, 40);

    act(() => {
      fireEvent.pointerDown(handle, { button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(target, { clientY: 5 });
    });
    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('does not emit a reorder across different kinds (block -> register)', () => {
    const onReorder = jest.fn();
    const { container } = render(<Harness onReorder={onReorder} />);

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement; // block-0
    const regRow = container.querySelector('[data-testid="row-block-0-reg-0"]') as HTMLElement;
    mockRect(regRow, 0, 40);

    act(() => {
      fireEvent.pointerDown(handle, { button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(regRow, { clientY: 5 });
    });
    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorder).not.toHaveBeenCalled();
  });
});
