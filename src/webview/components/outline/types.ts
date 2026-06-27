import { ReactNode } from 'react';
import type { NormalizedAddressBlock, NormalizedRegister } from '../../../domain/internal.types';

export type YamlPath = Array<string | number>;

export type RegisterArrayNode = NormalizedRegister & { __kind: 'array' };

export const isArrayNode = (node: unknown): node is RegisterArrayNode => {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as Record<string, unknown>;
  return n.__kind === 'array' && typeof n.count === 'number' && typeof n.stride === 'number';
};

export type BlockNode = NormalizedAddressBlock;

export interface OutlineSelection {
  id: string;
  type: 'memoryMap' | 'block' | 'register' | 'array';
  object: unknown;
  breadcrumbs: string[];
  path: YamlPath;
  meta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
    activeRegisterIndex?: number;
  };
}

export type RenderNameOrEdit = (
  id: string,
  name: string,
  path: YamlPath,
  className?: string
) => ReactNode;

/**
 * A drag-to-reorder request emitted by the outline tree. `position` is relative
 * to `toIdx` ('before' = insert above, 'after' = insert below). Only same-kind,
 * same-sibling-group moves are emitted (blocks among blocks, registers among
 * the same block's top-level registers).
 */
export type OutlineReorder =
  | { kind: 'block'; fromIdx: number; toIdx: number; position: 'before' | 'after' }
  | {
      kind: 'register';
      blockIndex: number;
      fromIdx: number;
      toIdx: number;
      position: 'before' | 'after';
    };
