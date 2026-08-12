import { act, renderHook, waitFor } from '@testing-library/react';
import type { IpCore } from '../../../webview/types/ipCore';
import { useIssuesSession } from '../../../webview/ipcore/hooks/useIssuesSession';

function core(name: string): IpCore {
  return {
    vlnv: { vendor: 'acme', library: 'ip', name, version: '1.0' },
  };
}

describe('useIssuesSession host report lifetime', () => {
  it('clears a host report when the edited IP core revision changes', async () => {
    const { result, rerender } = renderHook(
      ({ ipCore, revision }) =>
        useIssuesSession({
          ipCore,
          revision,
          validationErrors: [],
          onSelectElement: jest.fn(),
          onSelectSubPort: jest.fn(),
        }),
      { initialProps: { ipCore: core('before'), revision: 'before' } }
    );

    act(() => {
      result.current.setHostReport({
        issues: [
          {
            code: 'SCHEMA_TEST',
            severity: 'error',
            source: 'schema',
            path: ['vlnv', 'name'],
            message: 'invalid',
          },
        ],
        hasKnownErrors: true,
        hasUnresolved: false,
      });
    });
    expect(result.current.importSaveBlocked).toBe(true);

    rerender({ ipCore: core('after'), revision: 'after' });

    await waitFor(() => expect(result.current.importSaveBlocked).toBe(false));
    expect(result.current.issues).toEqual([]);
  });

  it('clears generation-originated issues after a successful generation', () => {
    const { result } = renderHook(() =>
      useIssuesSession({
        ipCore: core('test'),
        revision: 'test',
        validationErrors: [],
        onSelectElement: jest.fn(),
        onSelectSubPort: jest.fn(),
      })
    );

    act(() => {
      result.current.handleGenerateResult({
        success: false,
        issues: [
          {
            code: 'BUS_TEST',
            severity: 'error',
            source: 'protocol',
            path: ['busInterfaces', 0],
            message: 'invalid',
          },
        ],
      });
    });
    expect(result.current.errorCount).toBe(1);

    act(() => result.current.handleGenerateResult({ success: true }));

    expect(result.current.errorCount).toBe(0);
  });

  it('does not attach a delayed generation result to a newer source revision', () => {
    const onSelectElement = jest.fn();
    const onSelectSubPort = jest.fn();
    const { result, rerender } = renderHook(
      ({ revision }) =>
        useIssuesSession({
          ipCore: core('test'),
          revision,
          validationErrors: [],
          onSelectElement,
          onSelectSubPort,
        }),
      { initialProps: { revision: 'before' } }
    );
    rerender({ revision: 'after' });

    act(() => {
      result.current.handleGenerateResult({
        success: false,
        sourceRevision: 'before',
        issues: [
          {
            code: 'STALE',
            severity: 'error',
            source: 'schema',
            path: ['busInterfaces', 0],
            message: 'stale',
          },
        ],
      });
    });

    expect(result.current.errorCount).toBe(0);
    expect(result.current.importSaveBlocked).toBe(false);
    expect(result.current.showIssues).toBe(false);
    expect(result.current.focusRequest).toBeNull();
    expect(onSelectElement).not.toHaveBeenCalled();
    expect(onSelectSubPort).not.toHaveBeenCalled();
  });

  it('does not clear newer issues after a delayed successful generation result', () => {
    const { result } = renderHook(() =>
      useIssuesSession({
        ipCore: core('test'),
        revision: 'after',
        validationErrors: [],
        onSelectElement: jest.fn(),
        onSelectSubPort: jest.fn(),
      })
    );

    act(() => {
      result.current.setHostReport({
        issues: [
          {
            code: 'CURRENT',
            severity: 'error',
            source: 'schema',
            path: [],
            message: 'current',
          },
        ],
        hasKnownErrors: true,
        hasUnresolved: false,
      });
    });

    act(() => {
      result.current.handleGenerateResult({ success: true, sourceRevision: 'before' });
    });

    expect(result.current.errorCount).toBe(1);
    expect(result.current.importSaveBlocked).toBe(true);
  });
});
