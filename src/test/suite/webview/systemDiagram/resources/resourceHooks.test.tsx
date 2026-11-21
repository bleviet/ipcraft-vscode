import { act, renderHook } from '@testing-library/react';
import type { SystemDiagramToExtensionMessage } from '../../../../../shared/messages/systemDiagram';
import { useBottomTab } from '../../../../../webview/systemDiagram/hooks/useBottomTab';
import { useSystemDiagramMessages } from '../../../../../webview/systemDiagram/hooks/useSystemDiagramMessages';
import { useResourceChannel } from '../../../../../webview/systemDiagram/resources/useResourceChannel';
import { useResourceView } from '../../../../../webview/systemDiagram/resources/useResourceView';
import { vscode } from '../../../../../webview/vscode';
import { vivadoReport } from './resourceReports';

const resources = { sources: [], searched: [], hierarchicalTcl: '', report: vivadoReport };

describe('useResourceChannel', () => {
  it('posts one message per gesture', () => {
    const post = jest.fn<void, [SystemDiagramToExtensionMessage]>();
    const { result } = renderHook(() => useResourceChannel(resources, 0, post));
    act(() => {
      result.current.load();
      result.current.select('a');
      result.current.attach();
      result.current.chooseFolder();
      result.current.remove('a');
      result.current.chooseRoot('top/sys');
      result.current.extract('ck');
      result.current.compare('b');
      result.current.compare(undefined);
    });
    expect(post.mock.calls.map(([message]) => message)).toEqual([
      { type: 'loadResources' },
      { type: 'selectResourceSource', id: 'a' },
      { type: 'attachResourceReport' },
      { type: 'chooseResourceFolder' },
      { type: 'removeResourceSource', id: 'a' },
      { type: 'chooseResourceRoot', root: 'top/sys' },
      { type: 'extractResources', id: 'ck' },
      { type: 'compareResourceSource', id: 'b' },
      { type: 'compareResourceSource' },
    ]);
    expect(result.current.resources).toBe(resources);
  });
});

describe('useResourceView', () => {
  const channel = (load = jest.fn()) => ({
    resources,
    showToken: 0,
    load,
    select: jest.fn(),
    attach: jest.fn(),
    chooseFolder: jest.fn(),
    remove: jest.fn(),
    chooseRoot: jest.fn(),
    extract: jest.fn(),
    compare: jest.fn(),
  });

  it('is off, and loads the reports once when it first turns on', () => {
    const load = jest.fn();
    const { result } = renderHook(() => useResourceView(channel(load)));
    expect(result.current.on).toBe(false);
    expect(result.current.report).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    act(() => result.current.setOn(true));
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.report).toBe(vivadoReport);
    expect(result.current.chip).toBe('Post-route · 841 LUTs · 1.3 %');
    act(() => result.current.setOn(false));
    act(() => result.current.setOn(true));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('turns on when the extension says to show it, without asking for the reports again', () => {
    const load = jest.fn();
    const { result, rerender } = renderHook(
      ({ showToken }) => useResourceView({ ...channel(load), showToken }),
      { initialProps: { showToken: 0 } }
    );
    expect(result.current.on).toBe(false);
    rerender({ showToken: 1 });
    expect(result.current.on).toBe(true);
    expect(result.current.report).toBe(vivadoReport);
    act(() => result.current.setOn(false));
    act(() => result.current.setOn(true));
    expect(load).not.toHaveBeenCalled();
  });

  it('gives the compared report only while it is on', () => {
    const withCompare = {
      ...channel(),
      resources: { ...resources, compare: { id: 'synth', report: vivadoReport } },
    };
    const { result } = renderHook(() => useResourceView(withCompare));
    expect(result.current.compare).toBeUndefined();
    act(() => result.current.setOn(true));
    expect(result.current.compare).toBe(vivadoReport);
  });

  it('draws no report while it is off', () => {
    const { result } = renderHook(() => useResourceView(channel()));
    act(() => result.current.setOn(true));
    act(() => result.current.setOn(false));
    expect(result.current.report).toBeUndefined();
  });
});

describe('useBottomTab and Resources', () => {
  const panel = { collapsed: false, toggle: jest.fn() };
  const hook = (on: boolean) =>
    renderHook(({ resourcesOn }) => useBottomTab(undefined, panel, resourcesOn), {
      initialProps: { resourcesOn: on },
    });

  it('falls back to the Address map when Resources turns off on its tab', () => {
    const { result, rerender } = hook(true);
    act(() => result.current.setTab('resources'));
    expect(result.current.tab).toBe('resources');
    rerender({ resourcesOn: false });
    expect(result.current.tab).toBe('address');
    rerender({ resourcesOn: true });
    expect(result.current.tab).toBe('address');
  });

  it('leaves another tab alone when Resources turns off', () => {
    const { result, rerender } = hook(true);
    act(() => result.current.setTab('clocks'));
    rerender({ resourcesOn: false });
    expect(result.current.tab).toBe('clocks');
  });
});

describe('useSystemDiagramMessages resources', () => {
  beforeEach(() => (vscode?.postMessage as jest.Mock | undefined)?.mockClear());

  it('keeps the resources message apart from the diagram state', () => {
    const { result } = renderHook(() => useSystemDiagramMessages());
    expect(result.current.resourceChannel.resources).toBeUndefined();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'resources', resources } }));
    });
    expect(result.current.resourceChannel.resources).toEqual(resources);
    expect(result.current.state).toEqual({ status: 'loading' });
    expect(result.current.resourceChannel.showToken).toBe(0);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'resources', resources, show: true } })
      );
    });
    expect(result.current.resourceChannel.showToken).toBe(1);
    act(() => result.current.resourceChannel.chooseFolder());
    expect(vscode?.postMessage).toHaveBeenCalledWith({ type: 'chooseResourceFolder' });
  });
});
