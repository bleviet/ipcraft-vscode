import { ReactNode } from 'react';
import { AddressBlock, Register, RegisterArray } from '../../types/memoryMap';

export type YamlPath = Array<string | number>;

export type RegisterArrayNode = {
  __kind: 'array';
  name: string;
  address_offset: number;
  count: number;
  stride: number;
  description?: string;
  registers: Register[];
};

export const isArrayNode = (node: unknown): node is RegisterArrayNode => {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as Record<string, unknown>;
  return n.__kind === 'array' && typeof n.count === 'number' && typeof n.stride === 'number';
};

export interface BlockNode extends AddressBlock {
  registers?: (Register | RegisterArrayNode)[];
  register_arrays?: RegisterArray[];
}

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
  };
}

export type RenderNameOrEdit = (
  id: string,
  name: string,
  path: YamlPath,
  className?: string
) => ReactNode;
