/**
 * Format-neutral description of a Platform Designer system (what a `.qsys`
 * XML file or a `qsys-script` Tcl script declares) and the one function that
 * turns it into a {@link SystemGraph}. Both readers collect records and call
 * {@link buildQsysGraph}, so duplicate, disabled and unknown modules, the
 * connection/export join and their diagnostics are decided in one place.
 */

import type { SystemDiagnostic, SystemGraph, SystemNet } from '../../domain/systemGraph';
import { QsysGraphBuilder, splitEndpoint } from './qsysGraphBuilder';
import type { QsysEnd } from './qsysInterfaceTypes';

export interface QsysModuleRecord {
  name: string;
  kind?: string;
  version?: string;
  parameters: Record<string, string>;
  enabled: boolean;
  line: number;
}

export interface QsysConnectionRecord {
  /** `instance.interface` as written. */
  start: string;
  end: string;
  /** Connection type (`avalon`, `clock`, ...); `''` when unknown. */
  kind: string;
  kindSource: SystemNet['categorySource'];
  parameters: Record<string, string>;
  line: number;
}

export interface QsysInterfaceRecord {
  name: string;
  /** The exported endpoint as written; undefined for an interface exporting nothing. */
  internal?: string;
  type: string;
  end: QsysEnd;
  line: number;
}

export interface QsysSystemDescription {
  name: string;
  modules: QsysModuleRecord[];
  connections: QsysConnectionRecord[];
  interfaces: QsysInterfaceRecord[];
  /** Reader-specific diagnostics, appended after the ones the build produces. */
  diagnostics: SystemDiagnostic[];
}

/** The file name without directories and extension. */
export function fileBaseName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^.]*$/, '');
}

export function buildQsysGraph(
  description: QsysSystemDescription,
  fileName: string,
  format: SystemGraph['source']['format']
): SystemGraph {
  const builder = new QsysGraphBuilder(fileName, description.name, format);

  const disabled = new Map<string, number>();
  const moduleLines = new Map<string, number>();
  for (const module of description.modules) {
    const firstLine = moduleLines.get(module.name);
    if (firstLine !== undefined) {
      builder.warn(`Duplicate module ${module.name}; the first definition is used.`, [
        firstLine,
        module.line,
      ]);
      continue;
    }
    moduleLines.set(module.name, module.line);
    if (!module.enabled) {
      disabled.set(module.name, module.line);
      continue;
    }
    builder.addModule(module.name, module.kind, module.version, module.parameters, module.line);
  }

  const touchesDisabled = (...instances: string[]): boolean =>
    instances.some((name) => disabled.has(name));
  /** An empty module name (missing attribute) can neither be shown nor connected. */
  const unnamed = (...instances: string[]): boolean => instances.some((name) => name === '');

  // Modules that connections and exports refer to but the file never declares.
  const blackBoxes = new Map<string, number[]>();
  const noteReference = (name: string, line: number): void => {
    if (name === '' || builder.hasModule(name) || disabled.has(name)) {
      return;
    }
    blackBoxes.set(name, [...(blackBoxes.get(name) ?? []), line]);
    builder.addBlackBox(name, blackBoxes.get(name)?.[0] ?? line);
  };
  for (const connection of description.connections) {
    const start = splitEndpoint(connection.start).instance;
    const end = splitEndpoint(connection.end).instance;
    if (!touchesDisabled(start, end) && !unnamed(start, end)) {
      noteReference(start, connection.line);
      noteReference(end, connection.line);
    }
  }
  for (const exported of description.interfaces) {
    if (exported.internal !== undefined) {
      const instance = splitEndpoint(exported.internal).instance;
      if (!touchesDisabled(instance)) {
        noteReference(instance, exported.line);
      }
    }
  }
  if (blackBoxes.size > 0) {
    builder.warn(
      `Not defined in this file, shown as a black box: ${[...blackBoxes.keys()].join(', ')}`,
      [...new Set([...blackBoxes.values()].flat())].sort((x, y) => x - y)
    );
  }

  // Connections first, so an exported interface can join a connection's net.
  for (const connection of description.connections) {
    const start = splitEndpoint(connection.start);
    const end = splitEndpoint(connection.end);
    if (unnamed(start.instance, end.instance)) {
      builder.warn(
        `Connection ${connection.start} -> ${connection.end} refers to unknown module .`,
        connection.line
      );
    } else if (!touchesDisabled(start.instance, end.instance)) {
      builder.connect(
        start,
        end,
        connection.kind,
        connection.kindSource,
        connection.parameters,
        connection.line
      );
    }
  }

  for (const exported of description.interfaces) {
    const internal = exported.internal === undefined ? undefined : splitEndpoint(exported.internal);
    if (internal && unnamed(internal.instance)) {
      builder.warn(
        `Exported interface ${exported.name} refers to unknown module ${internal.instance}.`,
        exported.line
      );
      builder.exportInterface(exported.name, undefined, exported.type, exported.end, exported.line);
    } else if (!internal || !touchesDisabled(internal.instance)) {
      builder.exportInterface(exported.name, internal, exported.type, exported.end, exported.line);
    }
  }

  if (disabled.size > 0) {
    builder.info(`Skipped disabled modules: ${[...disabled.keys()].join(', ')}`, [
      ...disabled.values(),
    ]);
  }
  for (const diagnostic of description.diagnostics) {
    if (diagnostic.severity === 'warning') {
      builder.warn(diagnostic.message, diagnostic.lines ?? []);
    } else {
      builder.info(diagnostic.message, diagnostic.lines ?? []);
    }
  }
  return builder.finish();
}
