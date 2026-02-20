import { act, renderHook } from '@testing-library/react';
import { useSelection, type Selection } from '../../../webview/hooks/useSelection';

describe('useSelection', () => {
  const rootSelection: Selection = {
    id: 'root',
    type: 'memoryMap',
    object: { name: 'MapA' },
    breadcrumbs: ['MapA'],
    path: [],
  };

  const blockSelection: Selection = {
    id: 'block-0',
    type: 'block',
    object: { name: 'Block0' },
    breadcrumbs: ['MapA', 'Block0'],
    path: ['addressBlocks', 0],
  };

  it('tracks current selection fields', () => {
    const { result } = renderHook(() => useSelection());

    act(() => {
      result.current.handleSelect(blockSelection);
    });

    expect(result.current.selectedId).toBe('block-0');
    expect(result.current.selectedType).toBe('block');
    expect(result.current.selectedObject).toEqual({ name: 'Block0' });
    expect(result.current.breadcrumbs).toEqual(['MapA', 'Block0']);
    expect(result.current.canGoBack).toBe(false);
  });

  it('adds prior selections to history and supports goBack', () => {
    const { result } = renderHook(() => useSelection());

    act(() => {
      result.current.handleSelect(rootSelection);
      result.current.handleSelect(blockSelection);
    });

    expect(result.current.selectedId).toBe('block-0');
    expect(result.current.canGoBack).toBe(true);

    act(() => {
      const didGoBack = result.current.goBack();
      expect(didGoBack).toBe(true);
    });

    expect(result.current.selectedId).toBe('root');
    expect(result.current.selectedType).toBe('memoryMap');
    expect(result.current.canGoBack).toBe(false);
  });

  it('clears selection state', () => {
    const { result } = renderHook(() => useSelection());

    act(() => {
      result.current.handleSelect(rootSelection);
      result.current.clearSelection();
    });

    expect(result.current.selectedId).toBe('');
    expect(result.current.selectedType).toBeNull();
    expect(result.current.selectedObject).toBeNull();
    expect(result.current.breadcrumbs).toEqual([]);
    expect(result.current.canGoBack).toBe(false);
  });
});
