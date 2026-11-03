/**
 * Static reader for Vivado `write_bd_tcl` block design scripts. It evaluates a
 * fixed command set (procs, `set`, `current_bd_instance`, `create_bd_*`,
 * `connect_bd_*`, `set_property`, `assign_bd_address`) over the script text and
 * never executes, sources, or opens anything. Conditionals and loops are
 * skipped with diagnostics; the result is a vendor-neutral {@link SystemGraph}.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import {
  assignAddress,
  connectNet,
  createBoundaryPin,
  createCell,
  setProperty,
  type CommandEnv,
} from './bdTclCommands';
import { SystemGraphBuilder, joinPath } from './bdTclGraphBuilder';
import {
  blockEnd,
  collectProcs,
  toLogicalLines,
  type LogicalLine,
  type ProcDef,
} from './bdTclLines';
import { bracketWords, isBracketed, splitWords, wordValue, type Word } from './bdTclWords';
import { classifyNets, inferPinDirections } from './systemGraphInference';

const MAX_CALL_DEPTH = 16;
const SILENT_COMMANDS = new Set([
  'variable',
  'global',
  'upvar',
  'puts',
  'return',
  'catch',
  'common::send_gid_msg',
  'current_bd_design',
  'open_bd_design',
  'get_property',
  'set_param',
  'lappend',
]);
const UNRESOLVABLE_COMMANDS = new Set([
  'apply_bd_automation',
  'apply_board_connection',
  'source',
  'exec',
  'open',
  'file',
]);
const VIVADO_ONLY_COMMANDS = new Set([
  'validate_bd_design',
  'save_bd_design',
  'regenerate_bd_layout',
  'create_project',
  'update_compile_order',
  'make_wrapper',
  'generate_target',
]);
const LOOP_COMMANDS = new Set(['foreach', 'for', 'while']);
const STRUCTURAL =
  /\b(?:create_bd_cell|create_bd_(?:intf_)?port|create_bd_(?:intf_)?pin|connect_bd_(?:intf_)?net|assign_bd_address)\b/;
const EMBEDDED_CELL = /\bset\s+(\S+)\s+\[\s*(create_bd_cell\b[^\]]*)\]/;

interface Frame {
  vars: Map<string, string>;
  depth: number;
  procName?: string;
  callLine?: number;
  procLine?: number;
}

class BdTclInterpreter {
  readonly builder: SystemGraphBuilder;
  private current = '/';

  constructor(
    fileName: string,
    private readonly procs: ReadonlyMap<string, ProcDef>
  ) {
    this.builder = new SystemGraphBuilder(fileName);
  }

  run(lines: readonly LogicalLine[], frame: Frame): void {
    let i = 0;
    while (i < lines.length) {
      const words = splitWords(lines[i].text);
      const next = blockEnd(lines, i);
      if (words.length > 0) {
        this.statement(words, lines, i, frame);
      }
      i = next;
    }
  }

  private env(line: number, frame: Frame): CommandEnv {
    const inHierProc = frame.procName?.startsWith('create_hier_cell_') === true;
    return {
      builder: this.builder,
      current: this.current,
      line,
      vars: frame.vars,
      ...(inHierProc &&
        frame.callLine !== undefined &&
        frame.procLine !== undefined && {
          hierSite: { callLine: frame.callLine, procLine: frame.procLine },
        }),
      argValue: (w) => this.argValue(w, line, frame),
    };
  }

  private argValue(word: Word, line: number, frame: Frame): string {
    if (isBracketed(word)) {
      return this.bracket(word, line, frame) ?? '';
    }
    return wordValue(word, frame.vars);
  }

  /** Evaluates `[cmd ...]` for the commands that yield a BD object path. */
  private bracket(word: Word, line: number, frame: Frame): string | undefined {
    const words = bracketWords(word);
    return words.length > 0 ? this.valueCommand(words, line, frame) : undefined;
  }

  private levelArg(word: Word | undefined, line: number, frame: Frame): string {
    const value = word ? this.argValue(word, line, frame).trim() : '.';
    if (value === '.') {
      return this.current;
    }
    return value === '' || value === '/' ? '/' : joinPath(this.current, value);
  }

  /** Commands usable both as statements and inside brackets; returns an object path. */
  private valueCommand(words: Word[], line: number, frame: Frame): string | undefined {
    const env = this.env(line, frame);
    const args = words.slice(1).filter((w) => !w.text.startsWith('-'));
    switch (words[0].text) {
      case 'current_bd_instance':
        this.current = this.levelArg(args[0], line, frame);
        return this.current;
      case 'get_bd_cells':
        if (words.some((w) => ['-filter', '-of_objects', '-hier'].includes(w.text))) {
          this.builder.report('warning', 'Cannot be resolved offline: get_bd_cells', line);
          return undefined;
        }
        return args.length > 0 ? this.levelArg(args[0], line, frame) : undefined;
      case 'create_bd_cell':
        return createCell(env, words);
      case 'create_bd_port':
        return createBoundaryPin(env, words, { isInterface: false, isPort: true });
      case 'create_bd_intf_port':
        return createBoundaryPin(env, words, { isInterface: true, isPort: true });
      case 'create_bd_pin':
        return createBoundaryPin(env, words, { isInterface: false, isPort: false });
      case 'create_bd_intf_pin':
        return createBoundaryPin(env, words, { isInterface: true, isPort: false });
      default:
        return undefined;
    }
  }

  private statement(words: Word[], lines: readonly LogicalLine[], idx: number, frame: Frame): void {
    const { line } = lines[idx];
    const cmd = words[0].text;
    const proc = this.procs.get(cmd);
    if (proc) {
      this.callProc(proc, words.slice(1), line, frame);
    } else if (cmd === 'set') {
      this.set(words, line, frame);
    } else if (cmd === 'if') {
      this.skipConditional(lines, idx, frame);
    } else if (LOOP_COMMANDS.has(cmd)) {
      this.builder.report('warning', `Cannot be resolved offline: ${cmd} loop`, line);
    } else if (cmd === 'proc' || cmd === 'namespace' || cmd.startsWith('}')) {
      return;
    } else if (this.bdCommand(cmd, words, line, frame)) {
      return;
    } else if (UNRESOLVABLE_COMMANDS.has(cmd)) {
      this.builder.report('warning', `Cannot be resolved offline: ${cmd}`, line);
    } else if (VIVADO_ONLY_COMMANDS.has(cmd)) {
      this.builder.reportVivadoOnly(cmd, line);
    } else if (!SILENT_COMMANDS.has(cmd)) {
      this.builder.report('info', `Ignored unrecognized command \`${cmd}\``, line);
    }
  }

  /** Handles the recognized BD commands; true when `cmd` was one of them. */
  private bdCommand(cmd: string, words: Word[], line: number, frame: Frame): boolean {
    const env = this.env(line, frame);
    switch (cmd) {
      case 'current_bd_instance':
      case 'create_bd_cell':
      case 'create_bd_port':
      case 'create_bd_intf_port':
      case 'create_bd_pin':
      case 'create_bd_intf_pin':
        this.valueCommand(words, line, frame);
        return true;
      case 'set_property':
        setProperty(env, words);
        return true;
      case 'connect_bd_intf_net':
        connectNet(env, words, true);
        return true;
      case 'connect_bd_net':
        connectNet(env, words, false);
        return true;
      case 'assign_bd_address':
      case 'create_bd_addr_seg':
        assignAddress(env, words);
        return true;
      case 'exclude_bd_addr_seg':
        this.builder.report(
          'info',
          'Excluded address segments are not shown: exclude_bd_addr_seg',
          line
        );
        return true;
      case 'create_bd_design': {
        const name = words.slice(1).find((w) => !w.text.startsWith('-'));
        const value = name ? this.argValue(name, line, frame) : '';
        if (value && !value.includes('$')) {
          this.builder.createdDesignName ??= value;
        }
        return true;
      }
      default:
        return false;
    }
  }

  private set(words: Word[], line: number, frame: Frame): void {
    if (words.length < 3) {
      return;
    }
    const name = words[1].text;
    const valueWord = words[2];
    if (isBracketed(valueWord)) {
      const path = this.bracket(valueWord, line, frame);
      if (path !== undefined) {
        frame.vars.set(name, path);
      }
      return;
    }
    const value = wordValue(valueWord, frame.vars);
    frame.vars.set(name, value);
    if (frame.depth === 0 && name === 'scripts_vivado_version') {
      this.builder.toolVersion = value;
    } else if (frame.depth === 0 && name === 'design_name') {
      this.builder.designName = value;
    }
  }

  /** Skips an `if` chain, evaluating only a `set VAR [create_bd_cell ...]` in its header. */
  private skipConditional(lines: readonly LogicalLine[], idx: number, frame: Frame): void {
    const { text, line } = lines[idx];
    const header = splitWords(text);
    const condition = header[1]?.kind === 'brace' ? header[1].text : '';
    const embedded = EMBEDDED_CELL.exec(condition);
    if (embedded) {
      const cellWords = splitWords(embedded[2]);
      const path = this.valueCommand(cellWords, line, frame);
      if (path !== undefined) {
        frame.vars.set(embedded[1], path);
      }
    }
    // Everything after the condition is a body: words on the header line plus all later lines.
    const bodyText = [
      ...header.slice(2).map((w) => w.text),
      ...lines.slice(idx + 1, blockEnd(lines, idx)).map((l) => l.text),
    ];
    if (bodyText.some((t) => STRUCTURAL.test(t))) {
      this.builder.report('info', 'Skipped a conditional block that creates design objects', line);
    }
  }

  private callProc(proc: ProcDef, args: Word[], line: number, frame: Frame): void {
    if (frame.depth >= MAX_CALL_DEPTH) {
      this.builder.report('warning', `Recursion limit reached calling ${proc.name}`, line);
      return;
    }
    const vars = new Map<string, string>();
    proc.params.forEach((param, i) => {
      const value = i < args.length ? this.argValue(args[i], line, frame) : param.defaultValue;
      vars.set(param.name, value ?? '');
    });
    this.run(proc.body, {
      vars,
      depth: frame.depth + 1,
      procName: proc.name,
      callLine: line,
      procLine: proc.line,
    });
  }
}

/** Reads a block design Tcl script into a system graph. Never executes the script. */
export function readBdTcl(text: string, fileName: string): SystemGraph {
  const lines = toLogicalLines(text);
  const interpreter = new BdTclInterpreter(fileName, collectProcs(lines));
  interpreter.run(lines, { vars: new Map(), depth: 0 });
  const graph = interpreter.builder.finish();
  inferPinDirections(graph);
  classifyNets(graph);
  return graph;
}
