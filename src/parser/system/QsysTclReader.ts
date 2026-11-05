/**
 * Static reader for Platform Designer `qsys-script` Tcl (`create_system`,
 * `add_instance`, `add_connection`, ...). Collects the declared records from
 * the top-level commands, infers the connection kinds the script omits, and
 * builds the graph through the shared {@link buildQsysGraph}. Nothing is
 * executed; loops, conditionals, procs and bracketed commands are skipped
 * with diagnostics and mark the connections partial.
 */

import type { SystemDiagnostic, SystemGraph } from '../../domain/systemGraph';
import { blockEnd, toLogicalLines, type LogicalLine } from './bdTclLines';
import { isBracketed, splitWords, wordValue, type Word } from './bdTclWords';
import { inferConnectionKinds } from './qsysConnectionKinds';
import type { QsysEnd } from './qsysInterfaceTypes';
import {
  buildQsysGraph,
  fileBaseName,
  type QsysConnectionRecord,
  type QsysInterfaceRecord,
  type QsysModuleRecord,
} from './qsysSystem';

const SILENT = new Set([
  'package',
  'set_project_property',
  'save_system',
  'puts',
  'load_system',
  'sync_sysinfo_parameters',
  'set_validation_property',
  'validate_system',
]);
const UNRESOLVABLE = new Set(['proc', 'if', 'foreach', 'for', 'while', 'source', 'exec']);
const AUTO_ASSIGN = new Set(['auto_assign_base_addresses', 'auto_assign_system_base_addresses']);
const UNSET_VARIABLE = /\$(?:\{(\w+)\}|(\w+))/g;
const ENABLED_VALUES = new Map([
  ['true', true],
  ['1', true],
  ['false', false],
  ['0', false],
]);
const START_DIRS = new Set(['start', 'source', 'master', 'receiver']);

type NoteGroup = 'unresolvable' | 'unsupported' | 'autoAssign' | 'unsetVariable';

interface EnabledOp {
  name: string;
  enabled: boolean;
  line: number;
}

interface ExportOp {
  name: string;
  endpoint: string;
  line: number;
}

interface ParameterOp {
  target: string;
  param: string;
  value: string;
  line: number;
}

/** Everything the commands declare, before ordering-dependent joins are applied. */
class Collector {
  systemName: string | undefined;
  readonly modules: QsysModuleRecord[] = [];
  readonly connections: (QsysConnectionRecord & { declared?: string })[] = [];
  readonly interfaces: QsysInterfaceRecord[] = [];
  readonly instanceParameters: ParameterOp[] = [];
  readonly connectionParameters: ParameterOp[] = [];
  readonly exports: ExportOp[] = [];
  readonly enabledOps: EnabledOp[] = [];
  private readonly noted = new Map<string, Map<string, number[]>>();

  /** Records a line under `key` in a diagnostic group. */
  note(group: NoteGroup, key: string, line: number): void {
    const keys = this.noted.get(group) ?? new Map<string, number[]>();
    keys.set(key, [...(keys.get(key) ?? []), line]);
    this.noted.set(group, keys);
  }

  noteEntries(group: NoteGroup): [string, number[]][] {
    return [...(this.noted.get(group) ?? [])];
  }
}

function collect(lines: readonly LogicalLine[]): Collector {
  const collector = new Collector();
  const vars = new Map<string, string>();
  let i = 0;
  while (i < lines.length) {
    const words = splitWords(lines[i].text);
    const next = blockEnd(lines, i);
    if (words.length > 0) {
      command(collector, words, lines[i].line, vars, next > i + 1);
    }
    i = next;
  }
  return collector;
}

function command(
  collector: Collector,
  words: Word[],
  line: number,
  vars: Map<string, string>,
  opensBlock: boolean
): void {
  const name = words[0].text;
  const args = words.slice(1);
  const arg = (index: number): string | undefined =>
    index < args.length ? wordValue(args[index], vars) : undefined;

  if (SILENT.has(name)) {
    return;
  }
  if (UNRESOLVABLE.has(name) || args.some(isBracketed)) {
    collector.note('unresolvable', name, line);
    return;
  }
  if (AUTO_ASSIGN.has(name)) {
    collector.note('autoAssign', name, line);
    return;
  }
  for (const word of args) {
    const values = word.kind === 'brace' ? [] : wordValue(word, vars).matchAll(UNSET_VARIABLE);
    for (const unset of values) {
      const variable = unset[1] ?? unset[2];
      collector.note(
        'unsetVariable',
        `Variable $${variable} is not set; ${name} may be wrong.`,
        line
      );
    }
  }
  const [a, b, c] = [arg(0), arg(1), arg(2)];
  switch (name) {
    case 'set':
      if (a !== undefined && b !== undefined) {
        vars.set(a, b);
      }
      return;
    case 'create_system':
      collector.systemName ??= a;
      return;
    case 'add_instance':
      if (a !== undefined) {
        collector.modules.push({
          name: a,
          ...(b !== undefined && { kind: b }),
          ...(c !== undefined && { version: c }),
          parameters: {},
          enabled: true,
          line,
        });
      }
      return;
    case 'set_instance_parameter_value':
      if (a !== undefined && b !== undefined && c !== undefined) {
        collector.instanceParameters.push({ target: a, param: b, value: c, line });
      }
      return;
    case 'set_instance_property':
      if (a !== undefined && b === 'ENABLED' && c !== undefined) {
        const enabled = ENABLED_VALUES.get(c.toLowerCase());
        if (enabled !== undefined) {
          collector.enabledOps.push({ name: a, enabled, line });
        }
      }
      return;
    case 'add_connection':
      if (a !== undefined && b !== undefined) {
        collector.connections.push({
          start: a,
          end: b,
          kind: '',
          kindSource: 'default',
          ...(c !== undefined && { declared: c }),
          parameters: {},
          line,
        });
      }
      return;
    case 'set_connection_parameter_value':
      if (a !== undefined && b !== undefined && c !== undefined) {
        collector.connectionParameters.push({ target: a, param: b, value: c, line });
      }
      return;
    case 'add_interface':
      if (a !== undefined) {
        collector.interfaces.push({ name: a, type: b ?? '', end: direction(c), line });
      }
      return;
    case 'set_interface_property':
      if (a !== undefined && b === 'EXPORT_OF' && c !== undefined) {
        collector.exports.push({ name: a, endpoint: c, line });
      }
      return;
    default:
      collector.note(opensBlock ? 'unresolvable' : 'unsupported', name, line);
  }
}

function direction(dir: string | undefined): QsysEnd {
  return dir !== undefined && START_DIRS.has(dir) ? 'start' : 'end';
}

/** Applies the order-independent joins and returns the warnings they produce. */
function applyJoins(collector: Collector): SystemDiagnostic[] {
  const warnings: SystemDiagnostic[] = [];
  const warn = (message: string, line: number): void => {
    warnings.push({ severity: 'warning', message, lines: [line] });
  };
  for (const op of collector.instanceParameters) {
    const module = collector.modules.find((candidate) => candidate.name === op.target);
    if (module) {
      module.parameters[op.param] = op.value;
    } else {
      warn(`Parameter ${op.param} set on unknown instance ${op.target}.`, op.line);
    }
  }
  for (const op of collector.enabledOps) {
    const module = collector.modules.find((candidate) => candidate.name === op.name);
    if (module) {
      module.enabled = op.enabled;
    } else {
      warn(`Property ENABLED set on unknown instance ${op.name}.`, op.line);
    }
  }
  for (const op of collector.connectionParameters) {
    const [start, end] = op.target.split('/');
    const connection = collector.connections.find(
      (candidate) => candidate.start === start && candidate.end === end
    );
    if (connection) {
      connection.parameters[op.param] = op.value;
    } else {
      warn(`Parameter ${op.param} set on unknown connection ${op.target}.`, op.line);
    }
  }
  for (const op of collector.exports) {
    const exported = collector.interfaces.find((candidate) => candidate.name === op.name);
    if (exported) {
      exported.internal = op.endpoint;
    } else {
      warn(`EXPORT_OF set on undeclared interface ${op.name}.`, op.line);
    }
  }
  return warnings;
}

function inferKinds(collector: Collector): SystemDiagnostic[] {
  const kinds = inferConnectionKinds(collector.connections, collector.interfaces);
  const named: number[] = [];
  const unknown: string[] = [];
  const unknownLines: number[] = [];
  collector.connections.forEach((connection, i) => {
    connection.kind = kinds[i].kind;
    connection.kindSource = kinds[i].kindSource;
    if (connection.kindSource === 'name') {
      named.push(connection.line);
    } else if (connection.kindSource === 'default') {
      unknown.push(`${connection.start} -> ${connection.end}`);
      unknownLines.push(connection.line);
    }
  });
  const infos: SystemDiagnostic[] = [];
  if (named.length > 0) {
    infos.push({
      severity: 'info',
      message:
        'Connection types were partly inferred from interface names because add_connection does not state them.',
      lines: named,
    });
  }
  if (unknown.length > 0) {
    infos.push({
      severity: 'info',
      message: `Connection type unknown: ${unknown.join(', ')}`,
      lines: unknownLines,
    });
  }
  return infos;
}

function noteDiagnostics(collector: Collector): SystemDiagnostic[] {
  const diagnostics: SystemDiagnostic[] = [
    ...collector.noteEntries('unresolvable').map(([name, lines]) => ({
      severity: 'warning' as const,
      message: `${name} cannot be evaluated offline; the system may be incomplete.`,
      lines,
    })),
    ...collector.noteEntries('unsetVariable').map(([message, lines]) => ({
      severity: 'warning' as const,
      message,
      lines,
    })),
  ];
  const autoAssign = collector.noteEntries('autoAssign');
  if (autoAssign.length > 0) {
    diagnostics.push({
      severity: 'info',
      message:
        'Base addresses are assigned by Platform Designer; addresses not set in the script are unknown.',
      lines: autoAssign.flatMap(([, lines]) => lines).sort((a, b) => a - b),
    });
  }
  const unsupported = collector.noteEntries('unsupported');
  if (unsupported.length > 0) {
    diagnostics.push({
      severity: 'info',
      message: `Skipped unsupported commands: ${unsupported.map(([name]) => name).join(', ')}`,
      lines: unsupported.flatMap(([, lines]) => lines).sort((a, b) => a - b),
    });
  }
  return diagnostics;
}

/** Reads a `qsys-script` Tcl file into a system graph. Never executes the script. */
export function readQsysTcl(text: string, fileName: string): SystemGraph {
  const collector = collect(toLogicalLines(text));
  const joinWarnings = applyJoins(collector);
  const inferred = inferKinds(collector);
  const noted = noteDiagnostics(collector);
  return buildQsysGraph(
    {
      name: collector.systemName ?? fileBaseName(fileName),
      modules: collector.modules,
      connections: collector.connections,
      interfaces: collector.interfaces,
      diagnostics: [
        ...noted.filter((d) => d.severity === 'warning'),
        ...joinWarnings,
        ...inferred,
        ...noted.filter((d) => d.severity === 'info'),
      ],
    },
    fileName,
    'qsys-tcl'
  );
}
