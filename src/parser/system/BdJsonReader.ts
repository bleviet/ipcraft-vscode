/**
 * Static reader for Vivado JSON block design files (`.bd`, Vivado 2018.3 and
 * later). Maps the `design` object onto the same vendor-neutral
 * {@link SystemGraph} the Tcl reader produces, so every downstream feature works
 * unchanged. Source lines come from parsing the same text as YAML (JSON is valid
 * YAML), which keeps node positions that `JSON.parse` discards.
 */

import { LineCounter, isNode, parseDocument } from 'yaml';
import type { PinRef, SystemGraph } from '../../domain/systemGraph';
import { addBdJsonAddressing } from './bdJsonAddressing';
import { asRecord, readParameters, toPinSpec, type JsonRecord } from './bdJsonPins';
import { SystemGraphBuilder, joinPath } from './bdTclGraphBuilder';
import { classifyNets, inferPinDirections } from './systemGraphInference';

const XML_ERROR =
  'This .bd file uses the XML format of Vivado 2018.2 and earlier, which is not supported. Save it with Vivado 2018.3 or later, or export it with write_bd_tcl.';

/** Source line (1-based) of the value at a JSON path; 0 when not found. */
export type LineOf = (path: readonly string[]) => number;

function createLineOf(text: string): LineOf {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  return (path) => {
    const node = doc.getIn(path, true);
    const offset = isNode(node) ? node.range?.[0] : undefined;
    return offset === undefined ? 0 : lineCounter.linePos(offset).line;
  };
}

function parseRoot(text: string): JsonRecord {
  if (text.trimStart().startsWith('<')) {
    throw new Error(XML_ERROR);
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `The .bd file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const design = asRecord(asRecord(root)?.design);
  if (!design) {
    throw new Error('Not a Vivado block design: the file has no "design" object.');
  }
  return design;
}

interface NetLevel {
  level: string;
  node: JsonRecord;
  path: string[];
}

interface Ctx {
  builder: SystemGraphBuilder;
  lineOf: LineOf;
  /** Levels whose nets are connected once every instance exists. */
  netLevels: NetLevel[];
}

/** Declares the `ports` and `interface_ports` of `node` on `owner` (boundary pins or instance pins). */
function addPins(ctx: Ctx, owner: string, isBoundary: boolean, node: JsonRecord, path: string[]) {
  for (const [key, isInterface] of [
    ['interface_ports', true],
    ['ports', false],
  ] as const) {
    for (const [name, value] of Object.entries(asRecord(node[key]) ?? {})) {
      const pinPath = [...path, key, name];
      const spec = toPinSpec(name, asRecord(value) ?? {}, isInterface, ctx.lineOf(pinPath));
      if (isBoundary) {
        ctx.builder.addBoundaryPin(owner, spec);
      } else {
        ctx.builder.addInstancePin(owner, spec);
      }
    }
  }
}

/** Adds the components of one level (recursing into hierarchies), then queues its nets. */
function addLevel(ctx: Ctx, level: string, node: JsonRecord, path: string[]): void {
  ctx.netLevels.push({ level, node, path });
  for (const [name, value] of Object.entries(asRecord(node.components) ?? {})) {
    const component = asRecord(value);
    if (!component) {
      continue;
    }
    const compPath = [...path, 'components', name];
    const refName = asRecord(component.reference_info)?.ref_name;
    const vlnv = component.vlnv;
    const kind = typeof refName === 'string' ? 'module' : typeof vlnv === 'string' ? 'ip' : 'hier';
    ctx.builder.addInstance({
      parent: level,
      name,
      kind,
      ...(kind === 'ip' && { vlnv: vlnv as string }),
      ...(kind === 'module' && { moduleRef: refName as string, pinsComplete: true as const }),
      line: ctx.lineOf(compPath),
    });
    const instance = joinPath(level, name);
    ctx.builder.setParameters({ owner: instance }, readParameters(component.parameters));
    addPins(ctx, instance, kind === 'hier', component, compPath);
    if (kind === 'hier') {
      addLevel(ctx, instance, component, compPath);
    }
  }
}

/** `a/b` names pin `b` of the instance `a` of `level`; a name without `/` is a boundary pin. */
function toPinRef(level: string, endpoint: string): PinRef {
  const slash = endpoint.lastIndexOf('/');
  if (slash < 0) {
    return { instance: null, pin: endpoint };
  }
  return {
    instance: joinPath(level, endpoint.slice(0, slash)),
    pin: endpoint.slice(slash + 1),
  };
}

function connectNets(ctx: Ctx, { level, node, path }: NetLevel): void {
  for (const [key, member, isInterface] of [
    ['nets', 'ports', false],
    ['interface_nets', 'interface_ports', true],
  ] as const) {
    for (const [name, value] of Object.entries(asRecord(node[key]) ?? {})) {
      const endpoints = asRecord(value)?.[member];
      const refs = (Array.isArray(endpoints) ? endpoints : [])
        .filter((e): e is string => typeof e === 'string')
        .map((e) => toPinRef(level, e));
      ctx.builder.connect(level, name, isInterface, refs, ctx.lineOf([...path, key, name]));
    }
  }
}

export function readBdJson(text: string, fileName: string): SystemGraph {
  const design = parseRoot(text);
  const builder = new SystemGraphBuilder(fileName, 'vivado-bd');
  const ctx: Ctx = { builder, lineOf: createLineOf(text), netLevels: [] };
  const info = asRecord(design.design_info);
  if (typeof info?.name === 'string') {
    builder.designName = info.name;
  }
  if (typeof info?.tool_version === 'string') {
    builder.toolVersion = info.tool_version;
  }
  const rootPath = ['design'];
  addPins(ctx, '/', true, design, rootPath);
  addLevel(ctx, '/', design, rootPath);
  ctx.netLevels.forEach((netLevel) => connectNets(ctx, netLevel));
  addBdJsonAddressing(builder, ctx.lineOf, asRecord(design.addressing));
  const graph = builder.finish();
  inferPinDirections(graph);
  classifyNets(graph);
  return graph;
}
