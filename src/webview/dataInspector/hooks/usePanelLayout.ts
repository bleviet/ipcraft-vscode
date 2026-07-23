import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { BitVector } from '../../../dataInspector/BitVector';
import type { CanvasAddCommand } from '../canvas/TransformCanvas';

export type MobileTab = 'value' | 'bits' | 'transform' | 'library' | 'inspect';
export type InspectorTab = 'properties' | 'fields' | 'capture';
export type CenterMode = 'both' | 'bits' | 'transform';

export function usePanelLayout(vector: BitVector | null) {
  const [laneWidth, setLaneWidth] = useState<8 | 16 | 32 | 64>(32);
  const [zoom, setZoom] = useState<'overview' | 'field' | 'bit'>('field');
  const [mobileTab, setMobileTab] = useState<MobileTab>('bits');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('properties');
  const [inspectedValueId, setInspectedValueId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('input');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [libraryPanelWidth, setLibraryPanelWidth] = useState(238);
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(350);
  const [centerMode, setCenterMode] = useState<CenterMode>('both');
  const [bitsPercent, setBitsPercent] = useState(42);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [canvasAddCommand, setCanvasAddCommand] = useState<CanvasAddCommand>();
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileTab((current) => {
      if (!vector) {
        return 'value';
      }
      return current === 'value' ? 'bits' : current;
    });
  }, [vector]);

  const inspectCanvasValue = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setInspectedValueId(nodeId);
    setInspectorTab('properties');
  };

  const queueCanvasAdd = (kind: CanvasAddCommand['kind'], value: string) => {
    setCanvasAddCommand((current) => ({ id: (current?.id ?? 0) + 1, kind, value }));
    setMobileTab('transform');
  };

  const beginCenterResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = centerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize = (moveEvent: PointerEvent) => {
      const next = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      setBitsPercent(Math.max(24, Math.min(72, next)));
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
  };

  const beginPanelResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    panel: 'library' | 'inspector'
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = panel === 'library' ? libraryPanelWidth : inspectorPanelWidth;
    const resize = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = panel === 'library' ? startWidth + delta : startWidth - delta;
      if (panel === 'library') {
        setLibraryPanelWidth(Math.max(180, Math.min(420, next)));
      } else {
        setInspectorPanelWidth(Math.max(260, Math.min(520, next)));
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
  };

  return {
    beginCenterResize,
    beginPanelResize,
    bitsPercent,
    canvasAddCommand,
    centerMode,
    centerRef,
    inspectCanvasValue,
    inspectedValueId,
    inspectorCollapsed,
    inspectorPanelWidth,
    inspectorTab,
    laneWidth,
    libraryCollapsed,
    libraryPanelWidth,
    mobileTab,
    problemsOpen,
    queueCanvasAdd,
    selectedNodeId,
    setBitsPercent,
    setCenterMode,
    setInspectedValueId,
    setInspectorCollapsed,
    setInspectorPanelWidth,
    setInspectorTab,
    setLaneWidth,
    setLibraryCollapsed,
    setLibraryPanelWidth,
    setMobileTab,
    setProblemsOpen,
    setSelectedNodeId,
    setZoom,
    zoom,
  };
}

export type PanelLayoutState = ReturnType<typeof usePanelLayout>;
