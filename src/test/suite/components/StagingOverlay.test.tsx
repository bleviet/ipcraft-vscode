import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  StagingOverlay,
  type StagedFileView,
} from '../../../webview/ipcore/components/canvas/StagingOverlay';
import { STAGING_ACTION_DESCRIPTIONS, type StagingAction } from '../../../shared/staging';

const modified: StagedFileView = {
  relativePath: 'rtl/a_core.vhd',
  status: 'modified',
  protected: false,
  handEdited: true,
  interfaceDrift: { added: ['bus_awaddr'], removed: ['old_p'], changed: ['q', 'r'] },
  actions: ['keep', 'overwrite', 'sync-interface', 'auto-merge'],
  defaultAction: 'auto-merge',
};
const locked: StagedFileView = {
  relativePath: 'rtl/locked.vhd',
  status: 'modified',
  protected: true,
  actions: ['keep', 'overwrite'],
  defaultAction: 'keep',
};

function renderOverlay(
  files: StagedFileView[],
  stagingActions: Record<string, StagingAction>,
  onSelectAction = jest.fn()
) {
  render(
    <StagingOverlay
      files={files}
      mergedPaths={new Set()}
      stagingActions={stagingActions}
      onMerge={jest.fn()}
      onSelectAction={onSelectAction}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />
  );
  return onSelectAction;
}

describe('StagingOverlay action selector', () => {
  it('offers the actions in UI order and marks the chosen one', () => {
    renderOverlay([modified], { 'rtl/a_core.vhd': 'auto-merge' });
    const labels = screen
      .getAllByRole('button', { pressed: undefined })
      .filter((b) => b.hasAttribute('aria-pressed'))
      .map((b) => b.textContent);
    expect(labels).toEqual(['Auto-merge', 'Sync interface', 'Overwrite', 'Keep']);
    expect(screen.getByRole('button', { name: 'Auto-merge', pressed: true })).toBeTruthy();
  });

  it('describes each action in a tooltip', () => {
    renderOverlay([modified], { 'rtl/a_core.vhd': 'auto-merge' });
    expect(screen.getByRole('button', { name: 'Keep' }).getAttribute('title')).toBe(
      STAGING_ACTION_DESCRIPTIONS.keep
    );
    expect(screen.getByRole('button', { name: 'Sync interface' }).getAttribute('title')).toBe(
      STAGING_ACTION_DESCRIPTIONS['sync-interface']
    );
  });

  it('reports the selected action', () => {
    const onSelect = renderOverlay([modified], { 'rtl/a_core.vhd': 'auto-merge' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onSelect).toHaveBeenCalledWith('rtl/a_core.vhd', 'keep');
  });

  it('renders hand-edited and interface drift badges', () => {
    renderOverlay([modified], { 'rtl/a_core.vhd': 'auto-merge' });
    expect(screen.getByText('Hand-edited')).toBeTruthy();
    const drift = screen.getByText(/Interface out of date: \+1\/-1\/~2/);
    expect(drift.getAttribute('title')).toBe('Added: bus_awaddr\nRemoved: old_p\nChanged: q, r');
  });

  it('hides the sync hint when sync-interface is not chosen', () => {
    renderOverlay([modified], { 'rtl/a_core.vhd': 'auto-merge' });
    expect(screen.queryByText('Entity updated; connect new ports in the architecture')).toBeNull();
  });

  it('shows the sync hint when sync-interface is chosen', () => {
    renderOverlay([modified], { 'rtl/a_core.vhd': 'sync-interface' });
    expect(screen.getByText('Entity updated; connect new ports in the architecture')).toBeTruthy();
  });

  it('mutes a file whose action is Keep and recolors the lock of a locked non-Keep file', () => {
    const { container } = render(
      <StagingOverlay
        files={[modified, locked]}
        mergedPaths={new Set()}
        stagingActions={{ 'rtl/a_core.vhd': 'keep', 'rtl/locked.vhd': 'overwrite' }}
        onMerge={jest.fn()}
        onSelectAction={jest.fn()}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    const rows = container.querySelectorAll('.staging-tree-file');
    expect(rows[0].classList.contains('staging-tree-file--muted')).toBe(true);
    expect(rows[1].classList.contains('staging-tree-file--muted')).toBe(false);
    expect(container.querySelector('.staging-status-lock--overridden')).not.toBeNull();
  });

  it('shows the all-kept banner when every modified file is set to Keep', () => {
    renderOverlay([locked], { 'rtl/locked.vhd': 'keep' });
    expect(screen.getByText(/set to Keep/)).toBeTruthy();
  });
});
