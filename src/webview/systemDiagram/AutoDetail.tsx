import { useEffect, useRef, type RefObject } from 'react';
import { useStore, useStoreApi } from '@xyflow/react';
import { farNameScale, isFar } from './layout/zoomDetail';

/**
 * Render-only level of detail. Sets `data-far` on `target` while Auto is on and
 * the zoom is far, and keeps `--sd-name-scale` (far only, in coarse steps) in step with the zoom without a
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
  const written = useRef<string | undefined>(undefined);

  useEffect(() => {
    const element = target.current;
    if (!element) {
      return undefined;
    }
    if (!enabled) {
      element.removeAttribute('data-far');
      element.style.removeProperty('--sd-name-scale');
      written.current = undefined;
      return undefined;
    }
    element.dataset.far = String(far);
    // Changing an inherited custom property restyles every descendant, so write it only
    // when the quantized value changes, and only while far (it is read under data-far).
    const apply = (zoom: number) => {
      const next = farNameScale(zoom);
      const text = next === undefined ? undefined : String(next);
      if (text === written.current) {
        return;
      }
      written.current = text;
      if (text === undefined) {
        element.style.removeProperty('--sd-name-scale');
      } else {
        element.style.setProperty('--sd-name-scale', text);
      }
    };
    apply(store.getState().transform[2]);
    return store.subscribe((state) => apply(state.transform[2]));
  }, [target, enabled, far, store]);

  return null;
}
