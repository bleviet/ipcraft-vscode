import { renderHook, act } from '@testing-library/react';
import {
  useCanvasSelection,
  parseCanvasId,
} from '../../../webview/ipcore/hooks/useCanvasSelection';

describe('useCanvasSelection', () => {
  describe('single selection', () => {
    it('selects an element on plain click', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      expect(result.current.selectedId).toBe('port:0');
      expect(result.current.multiSelection.isMulti).toBe(false);
    });

    it('parses the index-less "generics" id into a generics element', () => {
      expect(parseCanvasId('generics')).toEqual({ kind: 'generics', index: 0, id: 'generics' });
    });

    it('selects the Generics overview element when select("generics") is called', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('generics'));
      expect(result.current.selected).toEqual({ kind: 'generics', index: 0, id: 'generics' });
      expect(result.current.selectedId).toBe('generics');
    });

    it('clears selection on select(null)', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.select(null));
      expect(result.current.selectedId).toBeNull();
    });

    it('clears multiMap when a new plain click is made', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.shiftSelect('port:1'));
      act(() => result.current.select('port:2'));
      expect(result.current.multiSelection.all.size).toBe(0);
      expect(result.current.selectedId).toBe('port:2');
    });
  });

  describe('shift-click multi-selection', () => {
    it('auto-includes the anchor port on the first Shift+Click', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.shiftSelect('port:1'));

      const ids = Array.from(result.current.multiSelection.all.keys());
      expect(ids).toContain('port:0');
      expect(ids).toContain('port:1');
      expect(result.current.multiSelection.isMulti).toBe(true);
    });

    it('subsequent Shift+Clicks keep adding ports', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.shiftSelect('port:1'));
      act(() => result.current.shiftSelect('port:2'));

      const ids = Array.from(result.current.multiSelection.all.keys());
      expect(ids).toContain('port:0');
      expect(ids).toContain('port:1');
      expect(ids).toContain('port:2');
    });

    it('Shift+Clicking an already-selected port removes it (toggle)', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.shiftSelect('port:1'));
      act(() => result.current.shiftSelect('port:0'));

      const ids = Array.from(result.current.multiSelection.all.keys());
      expect(ids).not.toContain('port:0');
      expect(ids).toContain('port:1');
    });

    it('does not seed the anchor when the anchor kind is not groupable', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('clock:0'));
      act(() => result.current.shiftSelect('port:0'));

      const ids = Array.from(result.current.multiSelection.all.keys());
      expect(ids).not.toContain('clock:0');
      expect(ids).toContain('port:0');
    });

    it('does not seed the anchor when there is no prior selection', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.shiftSelect('port:0'));

      expect(result.current.multiSelection.all.size).toBe(1);
      expect(result.current.multiSelection.all.has('port:0')).toBe(true);
    });

    it('interrupts are groupable alongside ports', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('interrupt:0'));
      act(() => result.current.shiftSelect('port:0'));

      const ids = Array.from(result.current.multiSelection.all.keys());
      expect(ids).toContain('interrupt:0');
      expect(ids).toContain('port:0');
    });
  });

  describe('isInMultiSelection', () => {
    it('returns true for ports in the multi-selection', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.shiftSelect('port:1'));

      expect(result.current.isInMultiSelection('port:0')).toBe(true);
      expect(result.current.isInMultiSelection('port:1')).toBe(true);
      expect(result.current.isInMultiSelection('port:2')).toBe(false);
    });
  });

  describe('deselect', () => {
    it('clears both selected and multiMap', () => {
      const { result } = renderHook(() => useCanvasSelection());
      act(() => result.current.select('port:0'));
      act(() => result.current.shiftSelect('port:1'));
      act(() => result.current.deselect());

      expect(result.current.selectedId).toBeNull();
      expect(result.current.multiSelection.all.size).toBe(0);
    });
  });
});
