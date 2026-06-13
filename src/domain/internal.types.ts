export type MemoryMapRootStyle = 'standalone' | 'array' | 'nested';

export interface MemoryMapDoc {
  rootStyle: MemoryMapRootStyle;
  map: NormalizedMemoryMap;
}

export interface NormalizedField {
  rowId: string;
  name: string;
  bits: string;
  offset: number; // bit LSB position
  width: number; // bit width
  access?: string;
  resetValue: number;
  description: string;
  enumeratedValues?: Record<string, string> | null;
  monitorChangeOf?: string | null;
}

export interface NormalizedRegister {
  rowId: string;
  name: string;
  offset: number; // byte offset
  size: number; // register width in bits
  access?: string;
  resetValue: number;
  description: string;
  fields: NormalizedField[];
  // If it's a register array
  __kind?: 'array';
  count?: number;
  stride?: number;
  registers?: NormalizedRegister[];
}

export interface NormalizedAddressBlock {
  rowId: string;
  name: string;
  baseAddress: number;
  range?: number | string | null;
  usage: string; // 'register' | 'memory' | 'reserved'
  access?: string;
  description: string;
  defaultRegWidth: number;
  registers: NormalizedRegister[];
}

export interface NormalizedMemoryMap {
  name: string;
  description: string;
  addressBlocks: NormalizedAddressBlock[];
}
