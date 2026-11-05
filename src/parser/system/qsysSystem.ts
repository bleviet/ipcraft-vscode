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

  /** The first module name that is neither enabled nor disabled, if any. */
  const unknownModule = (...instances: string[]): string | undefined =>
    instances.find((name) => !builder.hasModule(name) && !disabled.has(name));
  const touchesDisabled = (...instances: string[]): boolean =>
    instances.some((name) => disabled.has(name));

  // Connections first, so an exported interface can join a connection's net.
  for (const connection of description.connections) {
    const start = splitEndpoint(connection.start);
    const end = splitEndpoint(connection.end);
    const unknown = unknownModule(start.instance, end.instance);
    if (unknown !== undefined) {
      builder.warn(
        `Connection ${connection.start} -> ${connection.end} refers to unknown module ${unknown}.`,
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
    const unknown = internal && unknownModule(internal.instance);
    if (unknown !== undefined) {
      builder.warn(
        `Exported interface ${exported.name} refers to unknown module ${unknown}.`,
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
