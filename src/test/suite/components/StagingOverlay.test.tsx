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

describe('StagingOverlay panel width', () => {
  const WIDTH_KEY = 'ipcraft.inspectorWidth';

  beforeEach(() => {
    sessionStorage.clear();
  });

  function renderPanel() {
    const { container } = render(
      <StagingOverlay
        files={[modified]}
        mergedPaths={new Set()}
        stagingActions={{ 'rtl/a_core.vhd': 'keep' }}
        onMerge={jest.fn()}
        onSelectAction={jest.fn()}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    const panel = container.querySelector('.canvas-inspector') as HTMLElement;
    const handle = container.querySelector('.ci-resize-handle') as HTMLElement;
    return { panel, handle };
  }

  function drag(handle: HTMLElement, fromX: number, toX: number) {
    fireEvent.mouseDown(handle, { clientX: fromX });
    fireEvent.mouseMove(document, { clientX: toX });
    fireEvent.mouseUp(document);
  }

  it('defaults to 320px when nothing is stored', () => {
    expect(renderPanel().panel.style.width).toBe('320px');
  });

  it('raises a stored width below 300 to 300px', () => {
    sessionStorage.setItem(WIDTH_KEY, '250');
    expect(renderPanel().panel.style.width).toBe('300px');
  });

  it('uses a stored in-range width as is', () => {
    sessionStorage.setItem(WIDTH_KEY, '500');
    expect(renderPanel().panel.style.width).toBe('500px');
  });

  it('falls back to 320px for an out-of-range stored width', () => {
    sessionStorage.setItem(WIDTH_KEY, '700');
    expect(renderPanel().panel.style.width).toBe('320px');
  });

  it.each([
    ['240', '300px'],
    ['300', '300px'],
    ['640', '640px'],
    ['239', '320px'],
    ['641', '320px'],
    ['abc', '320px'],
  ])('opens with stored width %s at %s', (stored, width) => {
    sessionStorage.setItem(WIDTH_KEY, stored);
    expect(renderPanel().panel.style.width).toBe(width);
  });

  it('resizes by dragging the handle and stores the dragged width', () => {
    const { panel, handle } = renderPanel();
    drag(handle, 800, 700);
    expect(panel.style.width).toBe('420px');
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('420');
  });

  it('clamps a drag to 640px at most and to 240px at least, below the 300px mount floor', () => {
    const { panel, handle } = renderPanel();
    drag(handle, 800, 0);
    expect(panel.style.width).toBe('640px');
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('640');
    drag(handle, 0, 2000);
    expect(panel.style.width).toBe('240px');
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('240');
  });

  it('sets the resize cursor during a drag and clears it on mouseup', () => {
    const { handle } = renderPanel();
    fireEvent.mouseDown(handle, { clientX: 800 });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.mouseUp(document);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
