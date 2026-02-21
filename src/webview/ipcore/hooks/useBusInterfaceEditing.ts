import React, { useCallback, useEffect, useState } from 'react';
import { focusContainer } from '../../shared/utils/focus';

interface BusPort {
  name: string;
  width?: number;
  direction?: string;
  presence?: string;
}

interface BusInterface {
  name: string;
  type: string;
  mode: string;
  physicalPrefix?: string;
  associatedClock?: string;
  associatedReset?: string;
  useOptionalPorts?: string[];
  portWidthOverrides?: Record<string, number>;
  portNameOverrides?: Record<string, string>;
  array?: {
    count: number;
    indexStart?: number;
    namingPattern?: string;
    physicalPrefixPattern?: string;
  };
}

type ArrayField = 'count' | 'indexStart' | 'namingPattern' | 'physicalPrefixPattern';
type BusField = 'name' | 'type' | 'mode';

type OnUpdate = (path: (string | number)[], value: unknown) => void;

interface UseBusInterfaceEditingOptions {
  busInterfaces: BusInterface[];
  busLibrary?: Record<string, { ports?: BusPort[] }>;
  onUpdate: OnUpdate;
  containerRef: React.RefObject<HTMLDivElement>;
  getEffectivePorts: (
    bus: BusInterface,
    library: Record<string, { ports?: BusPort[] }> | undefined
  ) => BusPort[];
}

export const useBusInterfaceEditing = ({
  busInterfaces,
  busLibrary,
  onUpdate,
  containerRef,
  getEffectivePorts,
}: UseBusInterfaceEditingOptions) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(new Set());
  const [expandAll, setExpandAll] = useState(false);

  const [editingPrefix, setEditingPrefix] = useState<number | null>(null);
  const [draftPrefix, setDraftPrefix] = useState('');

  const [editingPortName, setEditingPortName] = useState<{
    busIndex: number;
    portName: string;
  } | null>(null);
  const [draftPortName, setDraftPortName] = useState('');

  const [selectedPortIndex, setSelectedPortIndex] = useState(0);
  const [selectedColumn, setSelectedColumn] = useState<'name' | 'width'>('name');

  const [editingPortWidth, setEditingPortWidth] = useState<{
    busIndex: number;
    portName: string;
  } | null>(null);
  const [draftPortWidth, setDraftPortWidth] = useState('');

  const [editingArrayField, setEditingArrayField] = useState<{
    busIndex: number;
    field: ArrayField;
  } | null>(null);
  const [draftArrayValue, setDraftArrayValue] = useState('');

  const [editingBusField, setEditingBusField] = useState<{
    busIndex: number;
    field: BusField;
  } | null>(null);
  const [draftBusValue, setDraftBusValue] = useState('');

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    if (expandAll) {
      setExpandedIndexes(new Set());
    } else {
      setExpandedIndexes(new Set(busInterfaces.map((_, i) => i)));
    }
    setExpandAll(!expandAll);
  }, [expandAll, busInterfaces]);

  const startEditPrefix = useCallback((index: number, currentPrefix: string) => {
    setEditingPrefix(index);
    setDraftPrefix(currentPrefix || '');
  }, []);

  const savePrefix = useCallback(
    (index: number) => {
      onUpdate(['busInterfaces', index, 'physicalPrefix'], draftPrefix);
      setEditingPrefix(null);
      setDraftPrefix('');
      focusContainer(containerRef);
    },
    [containerRef, draftPrefix, onUpdate]
  );

  const cancelEditPrefix = useCallback(() => {
    setEditingPrefix(null);
    setDraftPrefix('');
    focusContainer(containerRef);
  }, [containerRef]);

  const getPortSuffix = useCallback((bus: BusInterface, portName: string): string => {
    if (bus.portNameOverrides?.[portName]) {
      return bus.portNameOverrides[portName];
    }
    return portName.toLowerCase();
  }, []);

  const startEditPortName = useCallback(
    (busIndex: number, portName: string, currentSuffix: string) => {
      setEditingPortName({ busIndex, portName });
      setDraftPortName(currentSuffix);
    },
    []
  );

  const savePortName = useCallback(
    (busIndex: number, portName: string) => {
      const defaultSuffix = portName.toLowerCase();
      const bus = busInterfaces[busIndex];
      const newOverrides = { ...(bus.portNameOverrides ?? {}) };

      if (draftPortName === defaultSuffix || draftPortName === '') {
        delete newOverrides[portName];
      } else {
        newOverrides[portName] = draftPortName;
      }

      onUpdate(
        ['busInterfaces', busIndex, 'portNameOverrides'],
        Object.keys(newOverrides).length > 0 ? newOverrides : undefined
      );
      setEditingPortName(null);
      setDraftPortName('');
      focusContainer(containerRef);
    },
    [busInterfaces, containerRef, draftPortName, onUpdate]
  );

  const cancelEditPortName = useCallback(() => {
    setEditingPortName(null);
    setDraftPortName('');
    focusContainer(containerRef);
  }, [containerRef]);

  const startEditPortWidth = useCallback(
    (busIndex: number, portName: string, currentWidth: number) => {
      setEditingPortWidth({ busIndex, portName });
      setDraftPortWidth(String(currentWidth));
    },
    []
  );

  const savePortWidth = useCallback(
    (busIndex: number, portName: string, defaultWidth: number) => {
      const bus = busInterfaces[busIndex];
      const newOverrides = { ...(bus.portWidthOverrides ?? {}) };
      const newWidth = parseInt(draftPortWidth, 10);

      if (isNaN(newWidth) || newWidth === defaultWidth) {
        delete newOverrides[portName];
      } else {
        newOverrides[portName] = newWidth;
      }

      onUpdate(
        ['busInterfaces', busIndex, 'portWidthOverrides'],
        Object.keys(newOverrides).length > 0 ? newOverrides : undefined
      );
      setEditingPortWidth(null);
      setDraftPortWidth('');
      focusContainer(containerRef);
    },
    [busInterfaces, containerRef, draftPortWidth, onUpdate]
  );

  const cancelEditPortWidth = useCallback(() => {
    setEditingPortWidth(null);
    setDraftPortWidth('');
    focusContainer(containerRef);
  }, [containerRef]);

  const startEditArrayField = useCallback(
    (busIndex: number, field: ArrayField, currentValue: string | number) => {
      setEditingArrayField({ busIndex, field });
      setDraftArrayValue(String(currentValue));
    },
    []
  );

  const saveArrayField = useCallback(
    (busIndex: number) => {
      if (!editingArrayField) {
        return;
      }
      const { field } = editingArrayField;

      if (field === 'count' || field === 'indexStart') {
        const numValue = parseInt(draftArrayValue, 10);
        if (!isNaN(numValue) && (field === 'indexStart' || numValue > 0)) {
          onUpdate(['busInterfaces', busIndex, 'array', field], numValue);
        }
      } else if (draftArrayValue.trim()) {
        onUpdate(['busInterfaces', busIndex, 'array', field], draftArrayValue.trim());
      } else {
        onUpdate(['busInterfaces', busIndex, 'array', field], undefined);
      }

      setEditingArrayField(null);
      setDraftArrayValue('');
      focusContainer(containerRef);
    },
    [containerRef, draftArrayValue, editingArrayField, onUpdate]
  );

  const cancelEditArrayField = useCallback(() => {
    setEditingArrayField(null);
    setDraftArrayValue('');
    focusContainer(containerRef);
  }, [containerRef]);

  const toggleArray = useCallback(
    (busIndex: number, hasArray: boolean) => {
      if (hasArray) {
        onUpdate(['busInterfaces', busIndex, 'array'], undefined);
      } else {
        onUpdate(['busInterfaces', busIndex, 'array'], {
          count: 2,
          indexStart: 0,
        });
      }
    },
    [onUpdate]
  );

  const toggleOptionalPort = useCallback(
    (busIndex: number, portName: string, currentlyEnabled: boolean) => {
      const bus = busInterfaces[busIndex];
      const currentOptional = bus.useOptionalPorts ?? [];

      const newOptional = currentlyEnabled
        ? currentOptional.filter((p) => p !== portName)
        : [...currentOptional, portName];

      onUpdate(
        ['busInterfaces', busIndex, 'useOptionalPorts'],
        newOptional.length > 0 ? newOptional : undefined
      );
    },
    [busInterfaces, onUpdate]
  );

  const updateAssociation = useCallback(
    (busIndex: number, field: 'associatedClock' | 'associatedReset', value: string) => {
      onUpdate(['busInterfaces', busIndex, field], value || undefined);
    },
    [onUpdate]
  );

  const getOptionalPorts = useCallback(
    (bus: BusInterface): BusPort[] => {
      if (!busLibrary || !bus.type || !busLibrary[bus.type]) {
        return [];
      }
      const libraryDef = busLibrary[bus.type];
      return (libraryDef.ports ?? []).filter((p) => p.presence === 'optional');
    },
    [busLibrary]
  );

  const addBusInterface = useCallback(() => {
    const availableTypes = busLibrary ? Object.keys(busLibrary) : [];
    const defaultType = availableTypes.includes('AXI4') ? 'AXI4' : availableTypes[0] || 'AXI4';

    const newBus: BusInterface = {
      name: `NEW_INTERFACE_${busInterfaces.length}`,
      type: defaultType,
      mode: 'slave',
    };

    onUpdate(['busInterfaces'], [...busInterfaces, newBus]);

    setTimeout(() => {
      setSelectedIndex(busInterfaces.length);
      setExpandedIndexes((prev) => new Set(prev).add(busInterfaces.length));
    }, 50);
  }, [busInterfaces, busLibrary, onUpdate]);

  const removeBusInterface = useCallback(
    (index: number) => {
      const newInterfaces = [...busInterfaces];
      newInterfaces.splice(index, 1);
      onUpdate(['busInterfaces'], newInterfaces);

      if (selectedIndex >= newInterfaces.length) {
        setSelectedIndex(Math.max(0, newInterfaces.length - 1));
      }
    },
    [busInterfaces, onUpdate, selectedIndex]
  );

  const startEditBusField = useCallback(
    (busIndex: number, field: BusField, currentValue: string) => {
      setEditingBusField({ busIndex, field });
      setDraftBusValue(currentValue);
    },
    []
  );

  const saveBusField = useCallback(
    (busIndex: number, overrideValue?: string) => {
      if (!editingBusField) {
        return;
      }
      const { field } = editingBusField;
      const valueToSave = overrideValue ?? draftBusValue;

      if (valueToSave.trim()) {
        onUpdate(['busInterfaces', busIndex, field], valueToSave.trim());
      }

      setEditingBusField(null);
      setDraftBusValue('');
      focusContainer(containerRef);
    },
    [containerRef, draftBusValue, editingBusField, onUpdate]
  );

  const cancelEditBusField = useCallback(() => {
    setEditingBusField(null);
    setDraftBusValue('');
    focusContainer(containerRef);
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        editingPortName !== null ||
        editingPrefix !== null ||
        editingPortWidth !== null ||
        editingArrayField !== null ||
        editingBusField !== null
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const currentBusExpanded = expandedIndexes.has(selectedIndex);
      const currentBus = busInterfaces[selectedIndex];
      const ports = currentBus ? getEffectivePorts(currentBus, busLibrary) : [];

      if (currentBusExpanded && ports.length > 0) {
        if (key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedPortIndex((prev) => Math.min(prev + 1, ports.length - 1));
        } else if (key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedPortIndex((prev) => Math.max(prev - 1, 0));
        } else if (key === 'h' || e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedColumn('name');
        } else if (key === 'l' || e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedColumn('width');
        } else if (key === 'e') {
          e.preventDefault();
          const port = ports[selectedPortIndex];
          if (port) {
            if (selectedColumn === 'name') {
              startEditPortName(selectedIndex, port.name, getPortSuffix(currentBus, port.name));
            } else {
              startEditPortWidth(selectedIndex, port.name, port.width ?? 1);
            }
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          toggleExpand(selectedIndex);
        } else if (key === 'g') {
          e.preventDefault();
          setSelectedPortIndex(0);
        } else if (e.key === 'G' && e.shiftKey) {
          e.preventDefault();
          setSelectedPortIndex(ports.length - 1);
        }
      } else if (key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, busInterfaces.length - 1));
        setSelectedPortIndex(0);
      } else if (key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        setSelectedPortIndex(0);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpand(selectedIndex);
        setSelectedPortIndex(0);
      } else if (key === 'g') {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === 'G' && e.shiftKey) {
        e.preventDefault();
        setSelectedIndex(busInterfaces.length - 1);
      } else if (key === '0') {
        e.preventDefault();
        toggleExpandAll();
      } else if (key === 'd' && e.ctrlKey) {
        e.preventDefault();
        removeBusInterface(selectedIndex);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [
    busInterfaces,
    busLibrary,
    containerRef,
    editingArrayField,
    editingBusField,
    editingPortName,
    editingPortWidth,
    editingPrefix,
    expandedIndexes,
    getEffectivePorts,
    getPortSuffix,
    removeBusInterface,
    selectedColumn,
    selectedIndex,
    selectedPortIndex,
    startEditPortName,
    startEditPortWidth,
    toggleExpand,
    toggleExpandAll,
  ]);

  return {
    selectedIndex,
    setSelectedIndex,
    expandedIndexes,
    setExpandedIndexes,
    expandAll,
    toggleExpand,
    toggleExpandAll,
    editingPrefix,
    draftPrefix,
    setDraftPrefix,
    startEditPrefix,
    savePrefix,
    cancelEditPrefix,
    editingPortName,
    draftPortName,
    setDraftPortName,
    selectedPortIndex,
    setSelectedPortIndex,
    selectedColumn,
    editingPortWidth,
    draftPortWidth,
    setDraftPortWidth,
    editingArrayField,
    draftArrayValue,
    setDraftArrayValue,
    editingBusField,
    draftBusValue,
    setDraftBusValue,
    getPortSuffix,
    startEditPortName,
    savePortName,
    cancelEditPortName,
    startEditPortWidth,
    savePortWidth,
    cancelEditPortWidth,
    startEditArrayField,
    saveArrayField,
    cancelEditArrayField,
    toggleArray,
    toggleOptionalPort,
    updateAssociation,
    getOptionalPorts,
    addBusInterface,
    removeBusInterface,
    startEditBusField,
    saveBusField,
    cancelEditBusField,
  };
};
