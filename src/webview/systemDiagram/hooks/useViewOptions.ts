import { useCallback, useState } from 'react';
import type { NetCategory } from '../../../domain/systemGraph';
import { NO_HIDDEN_LAYERS, soloLayer, toggleLayer, type HiddenLayers } from '../layerFilter';

/**
 * Options that change only what the canvas draws, never the layout: Auto
 * detail, the minimap (`minimapChoice` is the user's choice, undefined until
 * made) and the hidden wire categories of the legend. Session state.
 */
export function useViewOptions(): {
  autoDetail: boolean;
  setAutoDetail: (on: boolean) => void;
  minimapChoice: boolean | undefined;
  setMinimapChoice: (shown: boolean) => void;
  hiddenLayers: HiddenLayers;
  toggleLayer: (category: NetCategory) => void;
  soloLayer: (category: NetCategory, all: readonly NetCategory[]) => void;
} {
  const [autoDetail, setAutoDetail] = useState(true);
  const [minimapChoice, setMinimapChoice] = useState<boolean | undefined>(undefined);
  const [hiddenLayers, setHiddenLayers] = useState<HiddenLayers>(NO_HIDDEN_LAYERS);
  const toggle = useCallback(
    (category: NetCategory) => setHiddenLayers((hidden) => toggleLayer(hidden, category)),
    []
  );
  const solo = useCallback(
    (category: NetCategory, all: readonly NetCategory[]) =>
      setHiddenLayers((hidden) => soloLayer(hidden, category, all)),
    []
  );
  return {
    autoDetail,
    setAutoDetail,
    minimapChoice,
    setMinimapChoice,
    hiddenLayers,
    toggleLayer: toggle,
    soloLayer: solo,
  };
}

/** What the canvas reads of {@link useViewOptions}. */
export type ViewOptions = ReturnType<typeof useViewOptions>;
