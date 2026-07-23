import { renderHook, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useCanvasCommands } from '../../../webview/ipcore/hooks/useCanvasCommands';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';

function baseOptions(overrides: Partial<Parameters<typeof useCanvasCommands>[0]> = {}) {
  const ipCore = {
    ports: [{ name: 'data_in', direction: 'in', width: 8 }],
    clocks: [{ name: 'clk' }],
    busInterfaces: [
      { name: 'S_AXI', type: 'axi4_lite', mode: 'slave', useOptionalPorts: ['ARUSER'] },
    ],
  } as unknown as IpCore;

  return {
    ipCore,
    updateIpCore: jest.fn(),
    canvasSelected: null as CanvasElement | null,
    canvasSelectedId: null as string | null,
    canvasDeselect: jest.fn(),
    selectedSubPortId: null as string | null,
    clearSubPort: jest.fn(),
    ungroupBusInterface: jest.fn(),
    showToast: jest.fn(),
    ...overrides,
  };
}

describe('useCanvasCommands', () => {
  describe('handleCanvasRemove', () => {
    it('deletes the matching element by name and deselects when it was selected', () => {
      const opts = baseOptions({ canvasSelectedId: 'data_in' });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleCanvasRemove('port', 'data_in'));

      expect(opts.updateIpCore).toHaveBeenCalledWith(['ports', 0], undefined);
      expect(opts.canvasDeselect).toHaveBeenCalled();
    });

    it('does nothing when no element matches the given name', () => {
      const opts = baseOptions();
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleCanvasRemove('port', 'does_not_exist'));

      expect(opts.updateIpCore).not.toHaveBeenCalled();
    });
  });

  describe('handleDuplicate', () => {
    it('appends a uniquely-named copy for a non-bus element', () => {
      const opts = baseOptions({
        canvasSelected: { kind: 'port', index: 0, id: 'port:0' },
      });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleDuplicate());

      expect(opts.updateIpCore).toHaveBeenCalledWith(
        ['ports'],
        expect.arrayContaining([expect.objectContaining({ name: 'data_in_copy' })])
      );
    });

    it('converts a plain bus interface into a 2-element array on first duplicate', () => {
      const opts = baseOptions({
        canvasSelected: { kind: 'busInterface', index: 0, id: 'bus:0' },
      });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleDuplicate());

      expect(opts.updateIpCore).toHaveBeenCalledWith(
        ['busInterfaces', 0, 'array'],
        expect.objectContaining({ count: 2 })
      );
    });

    it('increments an existing bus array count', () => {
      const ipCore = {
        busInterfaces: [{ name: 'S_AXI', type: 'axi4_lite', array: { count: 2 } }],
      } as unknown as IpCore;
      const opts = baseOptions({
        ipCore,
        canvasSelected: { kind: 'busInterface', index: 0, id: 'bus:0' },
      });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleDuplicate());

      expect(opts.updateIpCore).toHaveBeenCalledWith(['busInterfaces', 0, 'array', 'count'], 3);
    });

    it('refuses to array-ify a bus interface that has a memory map reference', () => {
      const ipCore = {
        busInterfaces: [{ name: 'S_AXI', type: 'axi4_lite', memoryMapRef: 'REGS' }],
      } as unknown as IpCore;
      const opts = baseOptions({
        ipCore,
        canvasSelected: { kind: 'busInterface', index: 0, id: 'bus:0' },
      });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleDuplicate());

      expect(opts.updateIpCore).not.toHaveBeenCalled();
      expect(opts.showToast).toHaveBeenCalled();
    });

    it('does nothing when there is no selection', () => {
      const opts = baseOptions();
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleDuplicate());

      expect(opts.updateIpCore).not.toHaveBeenCalled();
    });
  });

  describe('handleInspectorDelete', () => {
    it('removes the selected element, deselects, and clears the sub-port selection', () => {
      const opts = baseOptions({ canvasSelected: { kind: 'port', index: 0, id: 'port:0' } });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleInspectorDelete());

      expect(opts.updateIpCore).toHaveBeenCalledWith(['ports'], []);
      expect(opts.canvasDeselect).toHaveBeenCalled();
      expect(opts.clearSubPort).toHaveBeenCalled();
    });
  });

  describe('handleInspectorUngroup', () => {
    it('ungroups the selected bus interface and clears selection', () => {
      const opts = baseOptions({ canvasSelected: { kind: 'busInterface', index: 0, id: 'bus:0' } });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleInspectorUngroup());

      expect(opts.ungroupBusInterface).toHaveBeenCalledWith(0);
      expect(opts.canvasDeselect).toHaveBeenCalled();
      expect(opts.clearSubPort).toHaveBeenCalled();
    });

    it('does nothing when the selection is not a bus interface', () => {
      const opts = baseOptions({ canvasSelected: { kind: 'port', index: 0, id: 'port:0' } });
      const { result } = renderHook(() => useCanvasCommands(opts));

      act(() => result.current.handleInspectorUngroup());

      expect(opts.ungroupBusInterface).not.toHaveBeenCalled();
    });
  });

  describe('global keyboard shortcuts', () => {
    it('Delete removes the selected element', () => {
      const opts = baseOptions({ canvasSelected: { kind: 'port', index: 0, id: 'port:0' } });
      renderHook(() => useCanvasCommands(opts));

      fireEvent.keyDown(window, { key: 'Delete' });

      expect(opts.updateIpCore).toHaveBeenCalledWith(['ports'], []);
    });

    it('Delete deactivates the selected sub-port instead of deleting the bus', () => {
      const opts = baseOptions({
        canvasSelected: { kind: 'busInterface', index: 0, id: 'bus:0' },
        selectedSubPortId: 'bus:0:ARUSER',
      });
      renderHook(() => useCanvasCommands(opts));

      fireEvent.keyDown(window, { key: 'Delete' });

      expect(opts.updateIpCore).toHaveBeenCalledWith(
        ['busInterfaces', 0, 'useOptionalPorts'],
        undefined
      );
    });

    it('Ctrl+D duplicates the selected element', () => {
      const opts = baseOptions({ canvasSelected: { kind: 'port', index: 0, id: 'port:0' } });
      renderHook(() => useCanvasCommands(opts));

      fireEvent.keyDown(window, { key: 'd', ctrlKey: true });

      expect(opts.updateIpCore).toHaveBeenCalledWith(
        ['ports'],
        expect.arrayContaining([expect.objectContaining({ name: 'data_in_copy' })])
      );
    });

    it('ignores Delete/Ctrl+D while typing in an input', () => {
      const opts = baseOptions({ canvasSelected: { kind: 'port', index: 0, id: 'port:0' } });
      renderHook(() => useCanvasCommands(opts));

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      fireEvent.keyDown(window, { key: 'Delete' });
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true });

      expect(opts.updateIpCore).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });
});
