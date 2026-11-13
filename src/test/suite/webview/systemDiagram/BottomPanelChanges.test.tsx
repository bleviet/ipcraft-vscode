import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { BottomPanel, type BottomTab } from '../../../../webview/systemDiagram/BottomPanel';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { useBottomTab } from '../../../../webview/systemDiagram/hooks/useBottomTab';
import { compareOf, zynqDiff } from './compareFixtures';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const compare = compareOf(zynqDiff());

function Panel({ initial = 'address', on = true }: { initial?: BottomTab; on?: boolean }) {
  const [tab, setTab] = React.useState<BottomTab>(initial);
  return (
    <BottomPanel
      graph={graph}
      clocks={analyzeClocks(graph)}
      levelPath="/"
      expanded={new Set()}
      tab={tab}
      onTabChange={setTab}
      findings={[]}
      selection={null}
      focusedPin={null}
      onSelectInstance={jest.fn()}
      onSelectPin={jest.fn()}
      onSelectNet={jest.fn()}
      onReveal={jest.fn()}
      changes={on ? { compare, onSelectPort: jest.fn(), onSwapCompare: jest.fn() } : undefined}
    />
  );
}

describe('BottomPanel Changes tab', () => {
  it('has four tabs without a comparison', () => {
    render(<Panel on={false} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).not.toContain('Changes');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('puts the tab first during a comparison, with the number of rows', () => {
    render(<Panel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveAccessibleName('Changes 12');
  });

  it('lists the changes in the tab and filters them with the filter box', () => {
    render(<Panel initial="changes" />);
    expect(screen.getByText(/differ\.$/)).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Changes' }), {
      target: { value: 'led_o' },
    });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    // The tab counts what differs, not what the filter leaves.
    expect(screen.getByRole('tab', { name: 'Changes 12' })).toBeVisible();
  });

  it('keeps a filter text per tab', () => {
    render(<Panel initial="changes" />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Changes' }), {
      target: { value: 'led_o' },
    });
    fireEvent.click(screen.getByRole('tab', { name: /^Address map/ }));
    expect(screen.getByRole('searchbox', { name: 'Filter Address map' })).toHaveValue('');
  });
});

describe('useBottomTab', () => {
  const bottom = (collapsed: boolean) => ({ collapsed, toggle: jest.fn() });
  const hook = (initial: string | undefined, panel = bottom(false)) =>
    renderHook(({ label }) => useBottomTab(label, panel), {
      initialProps: { label: initial },
    });

  it('starts on the Address map', () => {
    const { result } = hook(undefined, bottom(true));
    expect(result.current.tab).toBe('address');
  });

  it('opens on Changes once when a comparison starts, expanding a hidden panel', () => {
    const panel = bottom(true);
    const { result, rerender } = hook(undefined, panel);
    rerender({ label: 'HEAD' });
    expect(result.current.tab).toBe('changes');
    expect(panel.toggle).toHaveBeenCalledTimes(1);
    act(() => result.current.setTab('clocks'));
    rerender({ label: 'HEAD' });
    expect(result.current.tab).toBe('clocks');
  });

  it('brings Changes forward again when another base is picked', () => {
    const { result, rerender } = hook('HEAD');
    act(() => result.current.setTab('clocks'));
    rerender({ label: 'main' });
    expect(result.current.tab).toBe('changes');
  });

  it('leaves the tab alone when the same base gets a new diff', () => {
    const { result, rerender } = hook('HEAD');
    act(() => result.current.setTab('clocks'));
    rerender({ label: 'HEAD' });
    expect(result.current.tab).toBe('clocks');
  });

  it('falls back to the Address map when the comparison ends on the Changes tab', () => {
    const { result, rerender } = hook('HEAD');
    expect(result.current.tab).toBe('changes');
    rerender({ label: undefined });
    expect(result.current.tab).toBe('address');
    rerender({ label: undefined });
    expect(result.current.tab).toBe('address');
  });

  it('leaves another tab alone when the comparison ends', () => {
    const { result, rerender } = hook('HEAD');
    act(() => result.current.setTab('resets'));
    rerender({ label: undefined });
    expect(result.current.tab).toBe('resets');
  });

  it('opens on Changes again for the next comparison', () => {
    const { result, rerender } = hook('HEAD');
    rerender({ label: undefined });
    rerender({ label: 'HEAD' });
    expect(result.current.tab).toBe('changes');
  });
});
