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
