import { act, renderHook } from '@testing-library/react';
import { useStagingSession } from '../../../webview/ipcore/hooks/useStagingSession';
import type { StagedFileView } from '../../../webview/ipcore/components/canvas/StagingOverlay';
import { vscode } from '../../../webview/vscode';

const files: StagedFileView[] = [
  {
    relativePath: 'rtl/a_core.vhd',
    status: 'modified',
    protected: false,
    handEdited: true,
    actions: ['keep', 'overwrite', 'auto-merge'],
    defaultAction: 'auto-merge',
  },
  {
    relativePath: 'rtl/locked.vhd',
    status: 'modified',
    protected: true,
    actions: ['keep', 'overwrite'],
    defaultAction: 'keep',
  },
  { relativePath: 'rtl/new.vhd', status: 'new', protected: false, actions: [] },
];

describe('useStagingSession actions', () => {
  beforeEach(() => {
    (vscode?.postMessage as jest.Mock | undefined)?.mockClear();
  });

  it('seeds actions from each modified file defaultAction', () => {
    const { result } = renderHook(() => useStagingSession());
    act(() => result.current.handleStagingStart({ files }));
    expect(result.current.stagingActions).toEqual({
      'rtl/a_core.vhd': 'auto-merge',
      'rtl/locked.vhd': 'keep',
    });
  });

  it('sends the selected actions on confirm', () => {
    const { result } = renderHook(() => useStagingSession());
    act(() => result.current.handleStagingStart({ files }));
    act(() => result.current.setStagingAction('rtl/locked.vhd', 'overwrite'));
    act(() => result.current.confirmStaging());
    expect(vscode?.postMessage).toHaveBeenCalledWith({
      type: 'stagingResult',
      confirmed: true,
      actions: { 'rtl/a_core.vhd': 'auto-merge', 'rtl/locked.vhd': 'overwrite' },
    });
    expect(result.current.stagingData).toBeNull();
  });

  it('drops a file from actions once it is opened in the merge editor', () => {
    const { result } = renderHook(() => useStagingSession());
    act(() => result.current.handleStagingStart({ files }));
    act(() => result.current.handleStagingFileMerged('rtl/a_core.vhd'));
    expect(result.current.stagingActions).toEqual({ 'rtl/locked.vhd': 'keep' });
    expect(result.current.stagingMergedPaths.has('rtl/a_core.vhd')).toBe(true);
  });
});
