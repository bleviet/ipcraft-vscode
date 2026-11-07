import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { InstanceNode } from '../../../../webview/systemDiagram/InstanceNode';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import type { InstanceNodeData } from '../../../../webview/systemDiagram/layout/diagramTypes';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { fakeMeasure } from './fixtureGraph';
import { foldingGraph } from './foldingGraph';

jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Handle: ({ id, type }: { id: string; type: string }) =>
      React.createElement('i', { 'data-handle': `${type}:${id}` }),
    Position: { Left: 'left', Right: 'right' },
  };
});

const GROUP = 'M*_AXI|master|i';
const graph = foldingGraph();
let folded: InstanceNodeData;
let open: InstanceNodeData;

async function hubData(pinFolding: { open: Set<string> }): Promise<InstanceNodeData> {
  const laidOut = await runElkLayout(
    buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding })
  );
  const { nodes } = toFlowElements(laidOut, graph, '/', fakeMeasure, pinFolding);
  return nodes.find((node) => node.id === '/hub')!.data as InstanceNodeData;
}

beforeAll(async () => {
  folded = await hubData({ open: new Set() });
  open = await hubData({ open: new Set([`/hub::${GROUP}`]) });
}, 20000);

function renderNode(data: InstanceNodeData, onClickNode = jest.fn()) {
  const props = { data, selected: false } as unknown as React.ComponentProps<typeof InstanceNode>;
  return {
    onClickNode,
    ...render(
      <div onClick={onClickNode}>
        <InstanceNode {...props} />
      </div>
    ),
  };
}

const handles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-handle]')).map((el) =>
    el.getAttribute('data-handle')
  );
const groupRow = () => screen.getByRole('button', { name: /M00\.\.M27_AXI \[28\]/ });

describe('folded pin array row', () => {
  it('shows the label with a right chevron and the handles of the group', () => {
    const { container } = renderNode(folded);
    expect(groupRow()).toHaveAttribute('aria-expanded', 'false');
    expect(groupRow().querySelector('.codicon-chevron-right')).not.toBeNull();
    expect(handles(container)).toEqual(
      expect.arrayContaining([`source:${GROUP}`, `target:${GROUP}`, 'source:aclk'])
    );
    expect(handles(container).some((id) => id?.includes('M00_AXI'))).toBe(false);
  });

  it('calls onTogglePinGroup without selecting the node', () => {
    const onTogglePinGroup = jest.fn();
    const { onClickNode } = renderNode({ ...folded, onTogglePinGroup });
    fireEvent.click(groupRow());
    expect(onTogglePinGroup).toHaveBeenCalledWith('/hub', GROUP);
    expect(onClickNode).not.toHaveBeenCalled();
  });

  it('aggregates highlight, focus and crossing from the members', () => {
    const { container } = renderNode({
      ...folded,
      highlightedPins: new Set([GROUP]),
      focusedPin: 'M05_AXI',
      pinMarks: { M03_AXI: { crossing: true } },
    });
    const label = groupRow().querySelector('.sd-pin-label')!;
    expect(label).toHaveAttribute('data-highlight', 'true');
    expect(label).toHaveAttribute('data-crossing', 'true');
    expect(container.querySelector('.sd-pin-halo')).not.toBeNull();
  });

  it('shares a mark color only when the members agree', () => {
    const marks = { M00_AXI: { color: '#f00' }, M01_AXI: { color: '#0f0' } };
    const { container, unmount } = renderNode({ ...folded, pinMarks: marks });
    expect(container.querySelector('.sd-pin-freq')).toBeNull();
    unmount();
    const agree = renderNode({
      ...folded,
      pinMarks: { M00_AXI: { frequency: '100 MHz' }, M01_AXI: { frequency: '100 MHz' } },
    });
    expect(agree.container.querySelector('.sd-pin-freq')).toHaveTextContent('100 MHz');
  });

  it('draws a review stub when a member is unconnected, undriven for a sink', () => {
    const review = { all: 1, undriven: 0, pinListKnown: true };
    const connected = renderNode({ ...folded, review });
    expect(connected.container.querySelector('.sd-pin-stub')).toBeNull();
    connected.unmount();
    const members = folded.east[0].group!.members.map((member, index) =>
      index === 2 ? { ...member, unconnected: true, direction: 'slave' as const } : member
    );
    const row = { ...folded.east[0], group: { ...folded.east[0].group!, members } };
    const { container } = renderNode({ ...folded, review, east: [row] });
    expect(container.querySelector('.sd-pin-stub')).toHaveAttribute('data-class', 'undriven');
  });
});

describe('folded row with a truncated label', () => {
  const full = 'M00..M27_AXI [28]';
  const truncated = 'M00..…[28]';
  const shortened = (): InstanceNodeData => ({
    ...folded,
    east: [{ ...folded.east[0], label: truncated }],
  });

  it('keeps the whole label as accessible name and in the hover card', () => {
    const onHoverPin = jest.fn();
    renderNode({ ...shortened(), onHoverPin });
    const row = screen.getByRole('button', { name: full });
    expect(row).toHaveTextContent(truncated);
    fireEvent.pointerEnter(row);
    expect(onHoverPin.mock.calls[0][0].pin.name).toBe(full);
  });

  it('adds no accessible name override when the label is whole', () => {
    renderNode(folded);
    expect(groupRow()).not.toHaveAttribute('aria-label');
  });
});

describe('open pin array', () => {
  it('shows a header with a down chevron and no handle, above the member rows', () => {
    const { container } = renderNode(open);
    const header = groupRow();
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(header.querySelector('.codicon-chevron-down')).not.toBeNull();
    expect(handles(container)).not.toContain(`source:${GROUP}`);
    expect(handles(container)).toContain('source:M00_AXI');
    expect(screen.getByText('M27_AXI')).toBeInTheDocument();
  });

  it('folds again on a click of the header', () => {
    const onTogglePinGroup = jest.fn();
    renderNode({ ...open, onTogglePinGroup });
    fireEvent.click(groupRow());
    expect(onTogglePinGroup).toHaveBeenCalledWith('/hub', GROUP);
  });
});
