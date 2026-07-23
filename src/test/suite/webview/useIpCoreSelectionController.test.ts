import { renderHook, act } from '@testing-library/react';
import { useIpCoreSelectionController } from '../../../webview/ipcore/hooks/useIpCoreSelectionController';

describe('useIpCoreSelectionController', () => {
  it('starts with no selection and no sub-port selected', () => {
    const { result } = renderHook(() => useIpCoreSelectionController());
    expect(result.current.selectedId).toBeNull();
    expect(result.current.selectedSubPortId).toBeNull();
  });

  it('select() clears any sub-port selection', () => {
    const { result } = renderHook(() => useIpCoreSelectionController());
    act(() => result.current.selectSubPort('bus:0:TLAST'));
    expect(result.current.selectedSubPortId).toBe('bus:0:TLAST');

    act(() => result.current.select('bus:0'));
    expect(result.current.selectedId).toBe('bus:0');
    expect(result.current.selectedSubPortId).toBeNull();
  });

  it('selectSubPort() sets the sub-port id without disturbing the primary selection', () => {
    const { result } = renderHook(() => useIpCoreSelectionController());
    act(() => result.current.select('bus:0'));
    act(() => result.current.selectSubPort('bus:0:TLAST'));

    expect(result.current.selectedId).toBe('bus:0');
    expect(result.current.selectedSubPortId).toBe('bus:0:TLAST');
  });

  it('clearSubPort() clears only the sub-port selection, leaving the primary selection intact', () => {
    const { result } = renderHook(() => useIpCoreSelectionController());
    act(() => result.current.select('bus:0'));
    act(() => result.current.selectSubPort('bus:0:TLAST'));
    act(() => result.current.clearSubPort());

    expect(result.current.selectedId).toBe('bus:0');
    expect(result.current.selectedSubPortId).toBeNull();
  });

  it('deselect() and deselectAll() do not implicitly touch the sub-port id (callers clear it explicitly)', () => {
    const { result } = renderHook(() => useIpCoreSelectionController());
    act(() => result.current.select('bus:0'));
    act(() => result.current.selectSubPort('bus:0:TLAST'));
    act(() => result.current.deselect());

    expect(result.current.selectedId).toBeNull();
    expect(result.current.selectedSubPortId).toBe('bus:0:TLAST');
  });

  it('passes multi-selection (shiftSelect) through to the underlying canvas selection', () => {
    const { result } = renderHook(() => useIpCoreSelectionController());
    act(() => result.current.select('port:0'));
    act(() => result.current.shiftSelect('port:1'));

    const ids = Array.from(result.current.multiSelection.all.keys());
    expect(ids).toContain('port:0');
    expect(ids).toContain('port:1');
    expect(result.current.multiSelection.isMulti).toBe(true);
  });
});
