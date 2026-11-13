import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { CompareControl } from '../../../../webview/systemDiagram/CompareControl';
import { compareOf, renameDiff, zynqDiff } from './compareFixtures';

function renderControl(on: boolean) {
  const handlers = { onStart: jest.fn(), onStop: jest.fn(), onOpenChanges: jest.fn() };
  render(
    <CompareControl
      compare={on ? compareOf(zynqDiff(), 'main (merge base 1234567)') : undefined}
      {...handlers}
    />
  );
  return handlers;
}

describe('CompareControl', () => {
  it('has only the Compare button without a comparison', () => {
    const { onStart } = renderControl(false);
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveAttribute(
      'title',
      'Compare with a revision or a file'
    );
    expect(screen.queryByRole('button', { name: 'Exit compare' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^vs /)).not.toBeInTheDocument();
  });

  it('shows the base, the counts and an exit while a comparison is on', () => {
    renderControl(true);
    const chip = screen.getByRole('button', { name: 'vs main (merge base 1234567)' });
    expect(chip).toHaveAttribute(
      'title',
      'Base: main (merge base 1234567). Current: sys/current.bd. Click to show the changes.'
    );
    expect(screen.getByLabelText('1 added')).toHaveTextContent('+1');
    expect(screen.getByLabelText('4 removed')).toHaveTextContent('−4');
    expect(screen.getByLabelText('2 changed')).toHaveTextContent('~2');
    expect(screen.queryByLabelText(/renamed/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getByLabelText('1 version only')).toHaveTextContent('v1');
  });

  it('shows the renamed count, fourth of five, only when a block was renamed', () => {
    render(
      <CompareControl
        compare={compareOf(renameDiff())}
        onStart={jest.fn()}
        onStop={jest.fn()}
        onOpenChanges={jest.fn()}
      />
    );
    const counts = screen.getAllByRole('img').map((item) => item.getAttribute('aria-label'));
    expect(counts).toEqual(['0 added', '0 removed', '1 changed', '1 renamed', '0 version only']);
    expect(screen.getByLabelText('1 renamed')).toHaveAttribute('data-zero', 'false');
  });

  it('mutes a count of zero', () => {
    const diff = zynqDiff();
    render(
      <CompareControl
        compare={compareOf({ ...diff, summary: { ...diff.summary, added: 0 } })}
        onStart={jest.fn()}
        onStop={jest.fn()}
        onOpenChanges={jest.fn()}
      />
    );
    expect(screen.getByLabelText('0 added')).toHaveAttribute('data-zero', 'true');
    expect(screen.getByLabelText('4 removed')).toHaveAttribute('data-zero', 'false');
  });

  it('opens the Changes tab from the base and from the counts', () => {
    const { onOpenChanges } = renderControl(true);
    fireEvent.click(screen.getByRole('button', { name: /^vs / }));
    fireEvent.click(screen.getByLabelText('1 added'));
    expect(onOpenChanges).toHaveBeenCalledTimes(2);
  });

  it('ends the comparison with Exit compare', () => {
    const { onStop } = renderControl(true);
    fireEvent.click(screen.getByRole('button', { name: 'Exit compare' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
