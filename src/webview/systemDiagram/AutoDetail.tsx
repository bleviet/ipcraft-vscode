import { useEffect, type RefObject } from 'react';
import { useStore, useStoreApi } from '@xyflow/react';
import { isFar, nameScale } from './layout/zoomDetail';

/**
 * Render-only level of detail. Sets `data-far` on `target` while Auto is on and
 * the zoom is far, and keeps `--sd-name-scale` in step with the zoom without a
 * React render per frame: only crossing the threshold re-renders this component.
 * It changes no node, so no size and no layout.
 */
export function AutoDetail({
  target,
  enabled,
}: {
  target: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  const far = useStore((state) => isFar(state.transform[2]));
  const store = useStoreApi();

  useEffect(() => {
    const element = target.current;
    if (!element) {
      return undefined;
    }
    if (!enabled) {
      element.removeAttribute('data-far');
      element.style.removeProperty('--sd-name-scale');
      return undefined;
    }
    element.dataset.far = String(far);
    const apply = (zoom: number) =>
      element.style.setProperty('--sd-name-scale', String(nameScale(zoom)));
    apply(store.getState().transform[2]);
    return store.subscribe((state) => apply(state.transform[2]));
  }, [target, enabled, far, store]);

  return null;
}
