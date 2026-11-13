import { render } from '@testing-library/react';
import React from 'react';
import { ElkEdge } from '../../../../webview/systemDiagram/ElkEdge';
import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/elkLayout';

const RED = 'var(--vscode-charts-red)';

function drawn(data: Partial<DiagramFlowEdge['data']>, selected = false) {
  const props = {
    id: 'e',
    selected,
    data: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      netId: 'n',
      category: 'axis',
      isInterface: true,
      ...data,
    },
  };
  const { container } = render(
    <svg>
      <ElkEdge {...(props as unknown as React.ComponentProps<typeof ElkEdge>)} />
    </svg>
  );
  return {
    wire: container.querySelector('path.react-flow__edge-path') as SVGPathElement,
    halo: container.querySelector<SVGPathElement>('path.sd-edge-halo'),
    container,
  };
}

describe('ElkEdge highlight', () => {
  it('draws an unselected highlighted wire as thick as a selected one, with a halo', () => {
    const selected = drawn({}, true).wire.style.strokeWidth;
    const { wire, halo, container } = drawn({ highlightColor: RED });
    expect(wire.style.strokeWidth).toBe(selected);
    expect(wire.style.strokeWidth).toBe('3.25');
    expect(halo).not.toBeNull();
    expect(halo!.getAttribute('stroke')).toBe(RED);
    expect(halo!.getAttribute('stroke-width')).toBe('7.25');
    expect(halo!.getAttribute('stroke-opacity')).toBe('0.3');
    expect(halo!.getAttribute('d')).toBe(wire.getAttribute('d'));
    expect(halo!.style.pointerEvents).toBe('none');
    const paths = [...container.querySelectorAll('path')];
    expect(paths.indexOf(halo!)).toBeLessThan(paths.indexOf(wire));
  });

  it('has no halo without a highlight', () => {
    expect(drawn({}).halo).toBeNull();
  });

  it('adds the selection and highlight widths', () => {
    expect(drawn({ highlightColor: RED }, true).wire.style.strokeWidth).toBe('4.75');
  });

  it('keeps the halo in the highlight color on a crossing wire and fades it when dimmed', () => {
    const crossing = drawn({ crossing: true, highlightColor: RED });
    expect(crossing.halo!.getAttribute('stroke')).toBe(RED);
    expect(crossing.wire.style.stroke).toBe('var(--vscode-editorWarning-foreground)');
    expect(drawn({ highlightColor: RED, dimmed: true }).halo!.style.opacity).toBe('0.2');
    expect(drawn({ highlightColor: RED, dimmed: true }, true).halo!.style.opacity).toBe('');
  });
});

describe('ElkEdge lead', () => {
  it('draws the lead before the wire and keeps the dot and the halo on the wire', () => {
    const lead = [
      { x: -20, y: 5 },
      { x: -20, y: 0 },
      { x: 0, y: 0 },
    ];
    const { wire, halo, container } = drawn({ junction: true, lead, highlightColor: RED });
    expect(wire.getAttribute('d')).toBe('M -20 5 L -20 0 L 0 0 L 10 0');
    expect(halo!.getAttribute('d')).toBe('M 0 0 L 10 0');
    expect(container.querySelector('circle')!.getAttribute('cx')).toBe('0');
  });
});

describe('ElkEdge junction dot', () => {
  it('draws the dot at the first point only for a wire with a junction', () => {
    expect(drawn({}).container.querySelector('circle')).toBeNull();
    const dot = drawn({ junction: true, dimmed: true }).container.querySelector('circle')!;
    expect(dot.getAttribute('cx')).toBe('0');
    expect(dot.getAttribute('cy')).toBe('0');
    expect(dot.getAttribute('r')).toBe('2.5');
    expect(dot.getAttribute('fill')).toBe('var(--vscode-charts-green)');
    expect(dot.style.opacity).toBe('0.2');
    expect(dot.style.pointerEvents).toBe('none');
  });
});

describe('ElkEdge new wire', () => {
  const ADDED = 'var(--sd-change-added)';

  it('draws a new wire in the added color, a little thicker', () => {
    const plain = drawn({}).wire.style;
    const { wire, container } = drawn({ changeNew: true });
    expect(wire.style.stroke).toBe(ADDED);
    expect(Number(wire.style.strokeWidth)).toBeGreaterThan(Number(plain.strokeWidth));
    expect(wire).toHaveClass('sd-edge-new');
    expect(container.querySelector('path.react-flow__edge-path.sd-edge-new')).not.toBeNull();
  });

  it('draws an ordinary wire as before', () => {
    expect(drawn({}).wire.style.stroke).not.toBe(ADDED);
    expect(drawn({}).wire).not.toHaveClass('sd-edge-new');
  });

  it('lets a selected or highlighted wire keep its own style', () => {
    expect(drawn({ changeNew: true }, true).wire.style.stroke).toBe('var(--vscode-charts-green)');
    expect(drawn({ changeNew: true, highlightColor: RED }).wire.style.stroke).toBe(RED);
  });

  it('draws the junction dot in the wire color', () => {
    const { container } = drawn({ changeNew: true, junction: true });
    expect(container.querySelector('circle')!.getAttribute('fill')).toBe(ADDED);
  });
});

describe('ElkEdge new branch of a tree', () => {
  const ADDED = 'var(--sd-change-added)';
  const lead = [
    { x: -20, y: 5 },
    { x: -20, y: 0 },
    { x: 0, y: 0 },
  ];
  const overlay = (container: Element) =>
    container.querySelector<SVGPathElement>('path.sd-edge-new:not(.react-flow__edge-path)');

  it('marks only the own points of a branch, and draws the shared trunk as it would without the mark', () => {
    const plain = drawn({ lead });
    const { wire, container } = drawn({ lead, changeNew: true, junction: true });
    expect(wire.getAttribute('d')).toBe('M -20 5 L -20 0 L 0 0 L 10 0');
    expect(wire.style.stroke).toBe(plain.wire.style.stroke);
    expect(wire.style.strokeWidth).toBe(plain.wire.style.strokeWidth);
    expect(wire).not.toHaveClass('sd-edge-new');
    const own = overlay(container)!;
    expect(own.getAttribute('d')).toBe('M 0 0 L 10 0');
    expect(own.getAttribute('stroke')).toBe(ADDED);
    expect(Number(own.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(plain.wire.style.strokeWidth)
    );
    expect(container.querySelector('circle')!.getAttribute('fill')).toBe(ADDED);
  });

  it('has no overlay for a wire without a lead, or one that is not new', () => {
    expect(overlay(drawn({ changeNew: true }).container)).toBeNull();
    expect(overlay(drawn({ lead }).container)).toBeNull();
  });

  it('keeps the selection style on both parts of a selected branch', () => {
    const { wire, container } = drawn({ lead, changeNew: true }, true);
    expect(wire.style.stroke).toBe('var(--vscode-charts-green)');
    expect(overlay(container)!.getAttribute('stroke')).toBe('var(--vscode-charts-green)');
  });

  it('keeps the domain color of a new clock wire and only widens it', () => {
    const plain = drawn({ domainColor: 'blue' });
    const marked = drawn({ domainColor: 'blue', changeNew: true });
    expect(marked.wire.style.stroke).toBe(plain.wire.style.stroke);
    expect(Number(marked.wire.style.strokeWidth)).toBeGreaterThan(
      Number(plain.wire.style.strokeWidth)
    );
  });
});
