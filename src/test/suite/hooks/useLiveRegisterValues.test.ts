import { act, renderHook } from '@testing-library/react';
import { useLiveRegisterValues } from '../../../webview/hooks/useLiveRegisterValues';

function postMessageEvent(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('useLiveRegisterValues', () => {
  it('ignores non-liveValues messages (the update protocol in particular)', () => {
    const { result } = renderHook(() => useLiveRegisterValues(undefined));

    act(() => {
      postMessageEvent({ type: 'update', text: 'name: core', docVersion: 5 });
    });

    expect(result.current.liveValues).toEqual({});
  });

  it('applies a liveValues message keyed by register name', () => {
    const { result } = renderHook(() => useLiveRegisterValues(undefined));

    act(() => {
      postMessageEvent({ type: 'liveValues', values: { VERSION: 0x100, LED_PATTERN: 0xff } });
    });

    expect(result.current.liveValues.VERSION).toMatchObject({ status: 'value', value: 0x100 });
    expect(result.current.liveValues.LED_PATTERN).toMatchObject({ status: 'value', value: 0xff });
  });

  it('applies a liveValues error entry with status "error"', () => {
    const { result } = renderHook(() => useLiveRegisterValues(undefined));

    act(() => {
      postMessageEvent({ type: 'liveValues', errors: { EVENTS: 'not connected' } });
    });

    expect(result.current.liveValues.EVENTS).toMatchObject({
      status: 'error',
      error: 'not connected',
    });
  });

  it('requestRead() sets status "reading" and posts a readRegister command', () => {
    const postMessage = jest.fn();
    const { result } = renderHook(() => useLiveRegisterValues({ postMessage }));

    act(() => {
      result.current.requestRead('VERSION');
    });

    expect(result.current.liveValues.VERSION).toMatchObject({ status: 'reading' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'readRegister', name: 'VERSION' });
  });

  it('a later liveValues message resolves a pending "reading" state', () => {
    const postMessage = jest.fn();
    const { result } = renderHook(() => useLiveRegisterValues({ postMessage }));

    act(() => {
      result.current.requestRead('VERSION');
    });
    expect(result.current.liveValues.VERSION.status).toBe('reading');

    act(() => {
      postMessageEvent({ type: 'liveValues', values: { VERSION: 0x100 } });
    });

    expect(result.current.liveValues.VERSION).toMatchObject({ status: 'value', value: 0x100 });
  });
});
