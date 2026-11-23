/** Types of the resolved packet format JSON (`resolvedPktVersion` 1), see ipcraft-spec/docs/packet_format_spec.md. */

export const PKT_VERSION = 1;
export const RESOLVED_VERSION = 1;
export const UNTIL_LAST = 'untilLast';
export const DATA = 'data';

export type PacketFormatErrorCode =
  | 'PKT_VERSION'
  | 'SCHEMA'
  | 'DUPLICATE_NAME'
  | 'BITS'
  | 'FIELD_RANGE'
  | 'FIELD_OVERLAP'
  | 'UNKNOWN_REF'
  | 'EXTENDS_CYCLE'
  | 'REFINE'
  | 'COMPOSITION'
  | 'COUNT'
  | 'MAP_BASE';

/** A packet format file is invalid. `path` is the dotted field path inside `file` (when known). */
export class PacketFormatError extends Error {
  readonly code: PacketFormatErrorCode;
  readonly file?: string;
  readonly path?: string;

  constructor(code: PacketFormatErrorCode, message: string, file?: string, path?: string) {
    const where = [file, path].filter(Boolean).join(': ');
    super(`${where ? `${where}: ` : ''}${code}: ${message}`);
    this.name = 'PacketFormatError';
    this.code = code;
    this.file = file;
    this.path = path;
  }

  /** The message without the `file: path:` prefix and code. */
  get detail(): string {
    const prefix = [this.file, this.path].filter(Boolean).join(': ');
    return this.message.slice((prefix ? prefix.length + 2 : 0) + this.code.length + 2);
  }
}

export interface ResolvedEnumValue {
  name: string;
  description: string;
}

export interface ResolvedEnum {
  /** Empty for an inline `enumeratedValues`. */
  name: string;
  flags: boolean;
  description: string;
  values: Record<string, ResolvedEnumValue>;
}

export interface ResolvedField {
  name: string;
  path: string;
  lsb: number;
  width: number;
  type: string;
  description: string;
  enum?: ResolvedEnum;
  unit?: string;
  scale?: number;
  offsetValue?: number;
  constraints?: { min?: number; max?: number; const?: number };
  array?: { count: number; stride: number };
  format?: string;
  fields?: ResolvedField[];
  [extension: `x-${string}`]: unknown;
}

export type ResolvedCount = number | 'untilLast' | { field: string; perBeat: number; add: number };

export interface ResolvedSection {
  name: string;
  description: string;
  count: ResolvedCount;
  signals: Record<string, ResolvedField[]>;
  [extension: `x-${string}`]: unknown;
}

export interface ResolvedFormat {
  name: string;
  description: string;
  dataWidth: number;
  busTypes: string[];
  /** Base chain, nearest first. */
  extends: string[];
  beats: ResolvedSection[];
  [extension: `x-${string}`]: unknown;
}

export interface ResolvedSource {
  name: string;
  format: string;
  description: string;
}

export interface ResolvedMap {
  name: string;
  description: string;
  selector: string;
  base: string;
  sources: Record<string, ResolvedSource>;
}

export interface ResolvedPacketDocument {
  resolvedPktVersion: number;
  formats: Record<string, ResolvedFormat>;
  map?: ResolvedMap;
}

/** Reads a file as text; returns undefined when it does not exist. Paths are absolute with `/` separators. */
export type PacketFileReader = (absolutePath: string) => string | undefined;
