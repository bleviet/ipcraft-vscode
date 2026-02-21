import type { RefObject } from 'react';

export function focusContainer(ref: RefObject<HTMLElement | null>): number {
  return window.setTimeout(() => ref.current?.focus(), 0);
}
