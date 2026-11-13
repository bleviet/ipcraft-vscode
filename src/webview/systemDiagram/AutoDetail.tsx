import { useEffect, useRef, type RefObject } from 'react';
import { useStore, useStoreApi } from '@xyflow/react';
import { farNameScale, farRingScale, isFar } from './layout/zoomDetail';

/**
 * Render-only level of detail. Sets `data-far` on `target` while Auto is on and
 * the zoom is far, and keeps `--sd-name-scale` and `--sd-ring-scale` (far only, in coarse steps) in step with the zoom without a
 * React render per frame: only crossing the threshold re-renders this component.
 * It changes no node, so no size and no layout.
 */
export function AutoDetail({
  target,
  enabled,
  marks = false,
}: {
  target: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** The marks of a comparison are drawn: only then is the ring scale written, since only they read it. */
  marks?: boolean;
}) {
  const far = useStore((state) => isFar(state.transform[2]));
  const store = useStoreApi();
  const written = useRef<string | undefined>(undefined);
  const ringWritten = useRef<string | undefined>(undefined);

  useEffect(() => {
    const element = target.current;
    if (!element) {
      return undefined;
    }
    if (!enabled) {
      element.removeAttribute('data-far');
      element.style.removeProperty('--sd-name-scale');
      element.style.removeProperty('--sd-ring-scale');
      written.current = undefined;
      ringWritten.current = undefined;
      return undefined;
    }
    element.dataset.far = String(far);
    // Changing an inherited custom property restyles every descendant, so write it only
    // when the quantized value changes, and only while far (it is read under data-far).
    const write = (name: string, value: number | undefined, last: { current?: string }) => {
      const text = value === undefined ? undefined : String(value);
      if (text === last.current) {
        return;
      }
      last.current = text;
      if (text === undefined) {
        element.style.removeProperty(name);
      } else {
        element.style.setProperty(name, text);
      }
    };
    const apply = (zoom: number) => {
      write('--sd-name-scale', farNameScale(zoom), written);
      write('--sd-ring-scale', marks ? farRingScale(zoom) : undefined, ringWritten);
    };
    apply(store.getState().transform[2]);
    return store.subscribe((state) => apply(state.transform[2]));
  }, [target, enabled, marks, far, store]);

  return null;
}
