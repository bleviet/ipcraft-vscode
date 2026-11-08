/**
 * Index entries of the workspace files the system diagram reads, built from
 * the file text. Pure: shared by the VS Code and the CLI file adapters.
 *
 * `R` is the adapter's own handle for reading the file again (a `vscode.Uri`,
 * or a path); `uri` is the link the diagram stores in a definition.
 */

import type { IpCore } from '../../../domain/ipcore.types';
import { parseIpCore } from '../../../domain/parse';
import { fileBaseName } from '../../../parser/system/qsysSystem';
import type { HdlFileKey, IpFileKey, QsysFileKey } from './matchDefinitions';

export interface FileLocation<R> {
  /** Absolute file system path. */
  file: string;
  /** Path shown to the user (relative to the workspace). */
  displayName: string;
  uri: string;
  ref: R;
}

export type IpEntry<R> = IpFileKey & FileLocation<R> & { ipCore: IpCore };
export type HdlEntry<R> = HdlFileKey & FileLocation<R>;
export type QsysEntry<R> = QsysFileKey & FileLocation<R>;

/** Generated netlists are not module references. */
export const HDL_MAX_BYTES = 1024 * 1024;

const VHDL_ENTITY = /^\s*entity\s+([A-Za-z_]\w*)\s+is\b/gim;
// SystemVerilog lifetime keywords may sit between `module` and its name.
const VERILOG_MODULE = /^\s*module\s+(?:(?:automatic|static)\s+)?([A-Za-z_]\w*)/gm;

function namesIn(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[1]);
}

export function ipEntryFromText<R>(text: string, location: FileLocation<R>): IpEntry<R> {
  const ipCore = parseIpCore(text);
  const { vendor, library, name, version } = ipCore.vlnv;
  return { ...location, ipCore, vlnv: { vendor, library, name, version } };
}

export function hdlEntryFromText<R>(text: string, location: FileLocation<R>): HdlEntry<R> {
  const isVhdl = /\.vhdl?$/i.test(location.file);
  return {
    ...location,
    vhdlEntities: isVhdl ? namesIn(text, VHDL_ENTITY) : [],
    verilogModules: isVhdl ? [] : namesIn(text, VERILOG_MODULE),
  };
}

export function qsysEntry<R>(location: FileLocation<R>): QsysEntry<R> {
  return { ...location, systemName: fileBaseName(location.file) };
}
