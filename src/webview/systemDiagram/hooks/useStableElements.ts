import { useMemo, useRef } from 'react';
import { reuseUnchanged } from '../stableElements';

/** `elements` with the previous object kept for every element that did not change. */
export function useStableElements<T extends { id: string; data?: unknown }>(elements: T[]): T[] {
  const previous = useRef<T[]>([]);
  return useMemo(() => {
    previous.current = reuseUnchanged(previous.current, elements);
    return previous.current;
  }, [elements]);
}
