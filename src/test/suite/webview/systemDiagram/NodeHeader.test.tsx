import React from 'react';
import { render } from '@testing-library/react';
import { nameParts, NodeHeader } from '../../../../webview/systemDiagram/NodeHeader';
import type { SystemInstance } from '../../../../domain/systemGraph';

describe('nameParts', () => {
  it('ends each part after an underscore', () => {
    expect(nameParts('pulse_gen_0')).toEqual(['pulse_', 'gen_', '0']);
  });

  it('keeps a name without underscores whole', () => {
    expect(nameParts('fifo')).toEqual(['fifo']);
  });
});

describe('NodeHeader name', () => {
  it('keeps the text and offers a break after each underscore', () => {
    const instance = {
      name: 'pulse_gen_0',
      path: '/pulse_gen_0',
      kind: 'leaf',
    } as unknown as SystemInstance;
    const { container } = render(<NodeHeader instance={instance} cellCount={0} expanded={false} />);
    const name = container.querySelector('.sd-node-name')!;
    expect(name.textContent).toBe('pulse_gen_0');
    expect(name).toHaveAttribute('title', 'pulse_gen_0');
    expect(name.querySelectorAll('wbr')).toHaveLength(2);
  });
});
