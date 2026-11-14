import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { CompareControl } from '../../../../webview/systemDiagram/CompareControl';
import { compareOf, renameDiff, zynqDiff } from './compareFixtures';

const noop = {
  onStart: jest.fn(),
  onStop: jest.fn(),
  onOpenChanges: jest.fn(),
  marksOn: true,
  onMarksChange: jest.fn(),
};

function renderControl(
  on: boolean,
  options: {
    marksOn?: boolean;
    onChangesOnly?: () => void;
    versionOnly?: { on: boolean; onChange: (on: boolean) => void };
    showVersion?: boolean;
  } = {}
) {
  const handlers = {
    onStart: jest.fn(),
    onStop: jest.fn(),
    onOpenChanges: jest.fn(),
    onMarksChange: jest.fn(),
  };
  render(
    <CompareControl
      compare={on ? compareOf(zynqDiff(), 'main (merge base 1234567)') : undefined}
      marksOn={options.marksOn ?? true}
      onChangesOnly={options.onChangesOnly}
      versionOnly={options.versionOnly}
      showVersion={options.showVersion}
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
    render(<CompareControl compare={compareOf(renameDiff())} {...noop} />);
    const counts = screen.getAllByRole('img').map((item) => item.getAttribute('aria-label'));
    expect(counts).toEqual(['0 added', '0 removed', '1 changed', '1 renamed', '0 version only']);
    expect(screen.getByLabelText('1 renamed')).toHaveAttribute('data-zero', 'false');
  });

  it('mutes a count of zero', () => {
    const diff = zynqDiff();
    render(
      <CompareControl
        compare={compareOf({ ...diff, summary: { ...diff.summary, added: 0 } })}
        {...noop}
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

  it('has a Marks toggle that is pressed while the marks are on', () => {
    const { onMarksChange } = renderControl(true);
    const marks = screen.getByRole('button', { name: 'Marks' });
    expect(marks).toHaveAttribute('aria-pressed', 'true');
    expect(marks).toHaveAttribute('title', 'Mark the changes on the diagram');
    expect(marks.querySelector('.codicon-diff')).not.toBeNull();
    fireEvent.click(marks);
    expect(onMarksChange).toHaveBeenCalledWith(false);
  });

  it('turns the marks on again from the pressed-off state', () => {
    const { onMarksChange } = renderControl(true, { marksOn: false });
    const marks = screen.getByRole('button', { name: 'Marks' });
    expect(marks).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(marks);
    expect(onMarksChange).toHaveBeenCalledWith(true);
  });

  it('starts Changes only, or is disabled with a reason when the level has no changed block', () => {
    const onChangesOnly = jest.fn();
    renderControl(true, { onChangesOnly });
    const button = screen.getByRole('button', { name: 'Changes only' });
    expect(button).toHaveAttribute(
      'title',
      'Show only the changed blocks of this level and what they connect to'
    );
    expect(button.querySelector('.codicon-filter')).not.toBeNull();
    fireEvent.click(button);
    expect(onChangesOnly).toHaveBeenCalledTimes(1);
  });

  it('disables Changes only on a level without changed blocks', () => {
    renderControl(true);
    const button = screen.getByRole('button', { name: 'Changes only' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'No changed blocks on this level');
  });

  it('disables Changes only while Marks is off, and says why', () => {
    renderControl(true, { marksOn: false });
    const button = screen.getByRole('button', { name: 'Changes only' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Turn on Marks to show only the changes');
  });

  it('has a Version only toggle only when given one', () => {
    renderControl(true);
    expect(
      screen.queryByRole('button', { name: 'Show version-only changes' })
    ).not.toBeInTheDocument();
  });

  it('has a pressed Version only toggle that hides the version-only blocks', () => {
    const onChange = jest.fn();
    renderControl(true, { versionOnly: { on: true, onChange } });
    const toggle = screen.getByRole('button', { name: 'Show version-only changes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('title', 'Hide the blocks whose only change is the IP version');
    expect(toggle).toHaveTextContent('v');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('has a released Version only toggle that shows them again', () => {
    const onChange = jest.fn();
    renderControl(true, { versionOnly: { on: false, onChange } });
    const toggle = screen.getByRole('button', { name: 'Show version-only changes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('title', 'Show the blocks whose only change is the IP version');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('lists no version-only count while the kind is not shown', () => {
    renderControl(true, { showVersion: false });
    expect(screen.queryByLabelText(/version only/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('img').map((item) => item.getAttribute('aria-label'))).toEqual([
      '1 added',
      '4 removed',
      '2 changed',
    ]);
  });

  it('has no Version only toggle without a comparison', () => {
    renderControl(false, { versionOnly: { on: true, onChange: jest.fn() } });
    expect(
      screen.queryByRole('button', { name: 'Show version-only changes' })
    ).not.toBeInTheDocument();
  });

  it('has neither control without a comparison', () => {
    renderControl(false);
    expect(screen.queryByRole('button', { name: 'Marks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changes only' })).not.toBeInTheDocument();
  });
});
