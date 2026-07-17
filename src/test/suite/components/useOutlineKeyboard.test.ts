/**
 * Register-list keyboard shortcuts on the Outline tree — relocated here from
 * the register rail that used to live in BlockEditor (see issue #99). A
 * top-level register/array node's path is always
 * ['addressBlocks', blockIndex, 'registers', regIndex]; a block node's path
 * is ['addressBlocks', blockIndex].
 */
import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useOutlineKeyboard } from '../../../webview/components/outline/useOutlineKeyboard';
import type { OutlineSelection } from '../../../webview/components/outline/types';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';

function makeSel(id: string, path: Array<string | number>, object: unknown = {}): OutlineSelection {
  return { id, type: 'register', object, breadcrumbs: [], path };
}

function fireKey(onKeyDown: (e: React.KeyboardEvent) => void, key: string, shiftKey = false) {
  const preventDefault = jest.fn();
  const stopPropagation = jest.fn();
  onKeyDown({
    key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault,
    stopPropagation,
  } as unknown as React.KeyboardEvent);
  return { preventDefault, stopPropagation };
}

describe('useOutlineKeyboard — register list shortcuts', () => {
  const memoryMap = {
    addressBlocks: [
      { name: 'B0', registers: [{ name: 'R0' }, { name: 'R1' }] },
      { name: 'EMPTY', registers: [] },
    ],
  } as unknown as NormalizedMemoryMap;

  const regSel = makeSel('block-0-reg-0', ['addressBlocks', 0, 'registers', 0], { name: 'R0' });
  const blockSel = makeSel('block-0', ['addressBlocks', 0]);
  const emptyBlockSel = makeSel('block-1', ['addressBlocks', 1]);
  // A template register reached through element 0 of an array at registers[1]
  // — every element shares this path regardless of which instance it's
  // clicked through.
  const arrayChildSel = makeSel(
    'block-0-arrreg-1-el-0-reg-0',
    ['addressBlocks', 0, 'registers', 1, 'registers', 0],
    { name: 'CTRL' }
  );

  function setup(
    selectedId: string,
    selections: OutlineSelection[],
    onRegisterAction: ReturnType<typeof jest.fn> | undefined = jest.fn()
  ) {
    const onSelect = jest.fn();
    const { result } = renderHook(() =>
      useOutlineKeyboard({
        editingId: null,
        selectedId,
        rootId: 'root',
        visibleSelections: selections,
        onSelect,
        startEditing: jest.fn(),
        memoryMap,
        setExpanded: jest.fn(),
        onRegisterAction,
      })
    );
    return { onKeyDown: result.current, onRegisterAction, onSelect };
  }

  it('o inserts a register after the selected register', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-reg-0', [regSel]);
    fireKey(onKeyDown, 'o');
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'insertAfter', 'register');
  });

  it('Shift+O inserts a register before the selected register', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-reg-0', [regSel]);
    fireKey(onKeyDown, 'O', true);
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'insertBefore', 'register');
  });

  it('Shift+A inserts a register array after the selected register', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-reg-0', [regSel]);
    fireKey(onKeyDown, 'A', true);
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'insertAfter', 'array');
  });

  it('Shift+I inserts a register array before the selected register', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-reg-0', [regSel]);
    fireKey(onKeyDown, 'I', true);
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'insertBefore', 'array');
  });

  it('d deletes the selected register', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-reg-0', [regSel]);
    fireKey(onKeyDown, 'd');
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'delete');
  });

  it('the Delete key deletes the selected register', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-reg-0', [regSel]);
    fireKey(onKeyDown, 'Delete');
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'delete');
  });

  it('o on an empty block inserts its first register (mirrors the removed rail\'s "Press o to add one")', () => {
    const { onKeyDown, onRegisterAction } = setup('block-1', [emptyBlockSel]);
    fireKey(onKeyDown, 'o');
    expect(onRegisterAction).toHaveBeenCalledWith(1, undefined, 'insertAfter', 'register');
  });

  it('o on a non-empty block does nothing — there is no register to anchor insert off of', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0', [blockSel]);
    fireKey(onKeyDown, 'o');
    expect(onRegisterAction).not.toHaveBeenCalled();
  });

  it('an unhandled register-action key does not fall through to arrow-key navigation', () => {
    const { onKeyDown, onSelect } = setup('block-0', [blockSel]);
    fireKey(onKeyDown, 'o');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing (and does not throw) when onRegisterAction is not provided', () => {
    const { onKeyDown } = setup('block-0-reg-0', [regSel], undefined);
    expect(() => fireKey(onKeyDown, 'o')).not.toThrow();
  });

  it('o inserts a register after a selected array-template child, threading parentRegIndex', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-arrreg-1-el-0-reg-0', [arrayChildSel]);
    fireKey(onKeyDown, 'o');
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'insertAfter', 'register', 1);
  });

  it('Shift+O inserts a register before a selected array-template child', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-arrreg-1-el-0-reg-0', [arrayChildSel]);
    fireKey(onKeyDown, 'O', true);
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'insertBefore', 'register', 1);
  });

  it('d deletes a selected array-template child, threading parentRegIndex', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-arrreg-1-el-0-reg-0', [arrayChildSel]);
    fireKey(onKeyDown, 'd');
    expect(onRegisterAction).toHaveBeenCalledWith(0, 0, 'delete', undefined, 1);
  });

  it('Shift+A does nothing on an array-template child — nested arrays-within-arrays are not supported', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-arrreg-1-el-0-reg-0', [arrayChildSel]);
    fireKey(onKeyDown, 'A', true);
    expect(onRegisterAction).not.toHaveBeenCalled();
  });

  it('Shift+I does nothing on an array-template child', () => {
    const { onKeyDown, onRegisterAction } = setup('block-0-arrreg-1-el-0-reg-0', [arrayChildSel]);
    fireKey(onKeyDown, 'I', true);
    expect(onRegisterAction).not.toHaveBeenCalled();
  });

  it('still navigates normally with arrow keys alongside the new shortcuts', () => {
    const regSel2 = makeSel('block-0-reg-1', ['addressBlocks', 0, 'registers', 1], { name: 'R1' });
    const { onKeyDown, onSelect } = setup('block-0-reg-0', [regSel, regSel2]);
    fireKey(onKeyDown, 'ArrowDown');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-0-reg-1' }));
  });
});
