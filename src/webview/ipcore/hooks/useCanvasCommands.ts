import { useCallback, useEffect } from 'react';
import type { IpCore, BusInterface } from '../../types/ipCore';
import type { YamlUpdateHandler } from '../../types/editor';
import type { CanvasElement } from './useCanvasSelection';

interface UseCanvasCommandsOptions {
  ipCore: IpCore;
  updateIpCore: YamlUpdateHandler;
  canvasSelected: CanvasElement | null;
  canvasSelectedId: string | null;
  canvasDeselect: () => void;
  selectedSubPortId: string | null;
  clearSubPort: () => void;
  ungroupBusInterface: (index: number) => void;
  showToast: (message: string) => void;
}

/**
 * Model-mutating canvas commands (remove, duplicate, delete, ungroup) plus
 * the global Delete/Ctrl+D keyboard shortcut that drives them. Extracted
 * from IpCoreApp (issue #129) so the app component composes controllers
 * instead of owning raw `window` listeners and YAML path calculations.
 */
export function useCanvasCommands({
  ipCore,
  updateIpCore,
  canvasSelected,
  canvasSelectedId,
  canvasDeselect,
  selectedSubPortId,
  clearSubPort,
  ungroupBusInterface,
  showToast,
}: UseCanvasCommandsOptions) {
  // Canvas drag-to-remove handling (Phase 4)
  const handleCanvasRemove = useCallback(
    (kind: string, id: string) => {
      let path: Array<string | number> | null = null;

      const findIndex = (arr: unknown[]) => {
        if (!Array.isArray(arr)) {
          return -1;
        }
        return arr.findIndex((item) => (item as { name?: string })?.name === id);
      };

      if (kind === 'clock') {
        const idx = findIndex(ipCore?.clocks ?? []);
        if (idx !== -1) {
          path = ['clocks', idx];
        }
      } else if (kind === 'reset') {
        const idx = findIndex(ipCore?.resets ?? []);
        if (idx !== -1) {
          path = ['resets', idx];
        }
      } else if (kind === 'bus') {
        const idx = findIndex(ipCore?.busInterfaces ?? []);
        if (idx !== -1) {
          path = ['busInterfaces', idx];
        }
      } else if (kind === 'port') {
        const idx = findIndex(ipCore?.ports ?? []);
        if (idx !== -1) {
          path = ['ports', idx];
        }
      } else if (kind === 'interrupt') {
        const idx = findIndex(ipCore?.interrupts ?? []);
        if (idx !== -1) {
          path = ['interrupts', idx];
        }
      }

      if (path) {
        updateIpCore(path, undefined);
        if (canvasSelectedId === id) {
          canvasDeselect();
        }
      }
    },
    [ipCore, updateIpCore, canvasSelectedId, canvasDeselect]
  );

  // Duplicate selected canvas element (Ctrl+D)
  // - Bus interface: first Ctrl+D adds array config (count=2); subsequent ones increment count
  // - Other elements: appends a copy with a unique name
  const handleDuplicate = useCallback(() => {
    if (!canvasSelected) {
      return;
    }

    if (canvasSelected.kind === 'busInterface') {
      const bus = ((ipCore.busInterfaces ?? []) as BusInterface[])[canvasSelected.index] as
        | (BusInterface & Record<string, unknown>)
        | undefined;
      if (!bus) {
        return;
      }
      if (bus.memoryMapRef) {
        showToast(
          `Cannot convert "${bus.name}" to an array — arrays cannot have a memory map reference. Remove the memory map reference first.`
        );
        return;
      }
      const arr = bus.array as
        | {
            count?: number;
            indexStart?: number;
            namingPattern?: string;
            physicalPrefixPattern?: string;
          }
        | undefined
        | null;
      if (arr?.count) {
        updateIpCore(['busInterfaces', canvasSelected.index, 'array', 'count'], arr.count + 1);
      } else {
        const baseName = String(bus.name ?? 'INTERFACE').toUpperCase();
        const physicalPrefix = String(bus.physicalPrefix ?? bus.name ?? '')
          .replace(/_$/, '')
          .toLowerCase();
        updateIpCore(['busInterfaces', canvasSelected.index, 'array'], {
          count: 2,
          indexStart: 0,
          namingPattern: `${baseName}_{index}`,
          physicalPrefixPattern: `${physicalPrefix}_{index}_`,
        });
      }
      return;
    }

    const kindToKey: Record<string, string> = {
      clock: 'clocks',
      reset: 'resets',
      port: 'ports',
      parameter: 'parameters',
      interrupt: 'interrupts',
    };
    const key = kindToKey[canvasSelected.kind];
    if (!key) {
      return;
    }
    const arr2 = ipCore[key as keyof IpCore] as unknown[] | undefined;
    if (!Array.isArray(arr2)) {
      return;
    }
    const original = arr2[canvasSelected.index] as Record<string, unknown>;
    if (!original) {
      return;
    }
    const existingNames = arr2.map((item) => String((item as Record<string, unknown>).name ?? ''));
    const baseName = String(original.name ?? 'item');
    let newName = `${baseName}_copy`;
    let n = 2;
    while (existingNames.includes(newName)) {
      newName = `${baseName}_copy_${n++}`;
    }
    updateIpCore([key], [...arr2, { ...original, name: newName }]);
  }, [canvasSelected, ipCore, updateIpCore, showToast]);

  // Delete selected element from the inspector panel (safe array-filter approach)
  const handleInspectorDelete = useCallback(() => {
    if (!canvasSelected) {
      return;
    }
    const pathKey: Record<string, string> = {
      clock: 'clocks',
      reset: 'resets',
      port: 'ports',
      busInterface: 'busInterfaces',
      parameter: 'parameters',
      interrupt: 'interrupts',
      subcore: 'subcores',
    };
    const key = pathKey[canvasSelected.kind];
    if (!key) {
      return;
    }
    const currentArr = ipCore[key as keyof IpCore] as unknown[] | undefined;
    if (!Array.isArray(currentArr)) {
      return;
    }
    const updated = currentArr.filter((_, i) => i !== canvasSelected.index);
    updateIpCore([key], updated);
    canvasDeselect();
    clearSubPort();
  }, [canvasSelected, ipCore, updateIpCore, canvasDeselect, clearSubPort]);

  const handleInspectorUngroup = useCallback(() => {
    if (canvasSelected?.kind !== 'busInterface') {
      return;
    }
    ungroupBusInterface(canvasSelected.index);
    canvasDeselect();
    clearSubPort();
  }, [canvasSelected, ungroupBusInterface, canvasDeselect, clearSubPort]);

  // Global keyboard shortcuts for canvas deletion/duplication
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      // Delete: deactivate the selected optional bus signal, if one is selected —
      // this must take priority over whole-element deletion below, since
      // canvasSelected still points at the signal's parent bus interface.
      if (e.key === 'Delete' && !isTyping && selectedSubPortId) {
        e.preventDefault();
        const parts = selectedSubPortId.split(':');
        if (parts.length >= 3) {
          const busIndex = parseInt(parts[1], 10);
          const portName = parts.slice(2).join(':');
          const bus = ((ipCore.busInterfaces ?? []) as BusInterface[])[busIndex] as
            | { useOptionalPorts?: string[] }
            | undefined;
          const current = bus?.useOptionalPorts ?? [];
          const updated = current.filter((p) => p !== portName);
          if (updated.length !== current.length) {
            updateIpCore(
              ['busInterfaces', busIndex, 'useOptionalPorts'],
              updated.length > 0 ? updated : undefined
            );
          }
        }
      }
      // Delete: remove selected canvas element
      else if (e.key === 'Delete' && !isTyping && canvasSelected) {
        e.preventDefault();
        handleInspectorDelete();
      }
      // Ctrl+D: duplicate selected canvas element
      else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'd' &&
        !isTyping &&
        canvasSelected
      ) {
        e.preventDefault();
        handleDuplicate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canvasSelected,
    handleInspectorDelete,
    handleDuplicate,
    selectedSubPortId,
    ipCore,
    updateIpCore,
  ]);

  return {
    handleCanvasRemove,
    handleDuplicate,
    handleInspectorDelete,
    handleInspectorUngroup,
  };
}
