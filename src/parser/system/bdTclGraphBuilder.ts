/**
 * Mutable accumulator the Vivado block design readers (Tcl script and JSON
 * `.bd`) write into: instances, levels, pins, nets, address segments and
 * aggregated diagnostics. Knows nothing about either syntax.
 */

import type {
  AddressSegment,
  PinRef,
  SystemDiagnostic,
  SystemGraph,
  SystemInstance,
  SystemPin,
} from '../../domain/systemGraph';

export function joinPath(level: string, name: string): string {
  const clean = name.replace(/^\/+|\/+$/g, '');
  if (name.startsWith('/')) {
    return `/${clean}`;
  }
  return level === '/' ? `/${clean}` : `${level}/${clean}`;
}

export function parentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

export function lastComponent(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export interface NewInstance {
  parent: string;
  name: string;
  kind: SystemInstance['kind'];
  vlnv?: string;
  moduleRef?: string;
  pinsComplete?: true;
  line: number;
  procLine?: number;
}

/** A pin to declare; `parameters` are those the declaration itself sets (e.g. `-freq_hz`). */
export type PinSpec = Omit<SystemPin, 'parameters'> & { parameters?: Record<string, string> };

/** Where `set_property` writes: a cell, or a (boundary or instance) pin. */
export type ParameterTarget = { owner: string; pin?: string };

export class SystemGraphBuilder {
  designName?: string;
  createdDesignName?: string;
  toolVersion?: string;
  private readonly graph: SystemGraph;
  private readonly diagnostics = new Map<string, SystemDiagnostic>();
  private readonly vivadoOnly = new Map<string, number[]>();
  private readonly blackBoxLines = new Map<string, number[]>();
  /** Lines of the connect commands naming each instance path, in order. */
  private readonly mentions = new Map<string, number[]>();
  private hasWarning = false;

  constructor(
    private readonly fileName: string,
    format: SystemGraph['source']['format'] = 'vivado-bd-tcl'
  ) {
    this.graph = {
      name: '',
      source: { fileName, format },
      levels: { '/': { path: '/', name: '', boundaryPins: [], instances: [] } },
      instances: {},
      nets: [],
      addressSegments: [],
      capabilities: {
        hierarchy: 'complete',
        connections: 'complete',
        addressMap: 'complete',
        userParameters: 'complete',
        propagatedParameters: 'unavailable',
        unconnectedPins: 'unavailable',
      },
      diagnostics: [],
    };
  }

  hasLevel(path: string): boolean {
    return path in this.graph.levels;
  }

  hasInstance(path: string): boolean {
    return path in this.graph.instances;
  }

  report(severity: 'warning' | 'info', message: string, line: number): void {
    if (severity === 'warning') {
      this.hasWarning = true;
    }
    const key = `${severity}:${message}`;
    const existing = this.diagnostics.get(key);
    if (existing) {
      if (!existing.lines?.includes(line)) {
        existing.lines?.push(line);
      }
    } else {
      this.diagnostics.set(key, { severity, message, lines: [line] });
    }
  }

  reportVivadoOnly(command: string, line: number): void {
    this.vivadoOnly.set(command, [...(this.vivadoOnly.get(command) ?? []), line]);
  }

  addInstance(spec: NewInstance): string | undefined {
    const path = joinPath(spec.parent, spec.name);
    if (this.graph.instances[path]) {
      return path;
    }
    const parentLevel = this.graph.levels[spec.parent];
    if (!parentLevel) {
      this.report('warning', `Unknown hierarchy level ${spec.parent}`, spec.line);
      return undefined;
    }
    let pins: SystemPin[] = [];
    if (spec.kind === 'hier') {
      this.graph.levels[path] = { path, name: spec.name, boundaryPins: pins, instances: [] };
      pins = this.graph.levels[path].boundaryPins;
    }
    this.graph.instances[path] = {
      path,
      name: spec.name,
      parent: spec.parent,
      kind: spec.kind,
      ...(spec.vlnv !== undefined && { vlnv: spec.vlnv }),
      ...(spec.moduleRef !== undefined && { moduleRef: spec.moduleRef }),
      ...(spec.pinsComplete && { pinsComplete: true as const }),
      parameters: {},
      pins,
      line: spec.line,
      ...(spec.procLine !== undefined && { procLine: spec.procLine }),
    };
    parentLevel.instances.push(path);
    return path;
  }

  /** Adds an instance the design references but does not define, once per path. */
  addBlackBox(parent: string, name: string, line: number): void {
    if (name.trim() === '') {
      return;
    }
    const path = this.addInstance({ parent, name, kind: 'blackbox', line });
    if (path !== undefined && this.graph.instances[path].kind === 'blackbox') {
      this.noteBlackBox(path, line);
    }
  }

  private noteBlackBox(path: string, line: number): void {
    const lines = this.blackBoxLines.get(path) ?? [];
    if (!lines.includes(line)) {
      lines.push(line);
    }
    this.blackBoxLines.set(path, lines);
  }

  /** Turns net endpoints naming an undefined instance of an existing level into black boxes. */
  private addReferencedBlackBoxes(): void {
    for (const net of this.graph.nets) {
      for (const ref of net.endpoints) {
        if (
          ref.instance === null ||
          lastComponent(ref.instance) === '' ||
          !this.hasLevel(parentPath(ref.instance))
        ) {
          continue;
        }
        const lines = this.mentions.get(ref.instance) ?? [net.line];
        if (!this.hasInstance(ref.instance)) {
          this.addInstance({
            parent: parentPath(ref.instance),
            name: lastComponent(ref.instance),
            kind: 'blackbox',
            line: lines[0],
          });
        }
        const box = this.graph.instances[ref.instance];
        if (box.kind !== 'blackbox') {
          continue;
        }
        lines.forEach((line) => this.noteBlackBox(ref.instance as string, line));
        if (!box.pins.some((p) => p.name === ref.pin)) {
          box.pins.push({
            name: ref.pin,
            isInterface: net.isInterface,
            direction: 'unknown',
            directionSource: 'unknown',
            parameters: {},
          });
        }
      }
    }
  }

  /** Declares a boundary pin of `level`; returns its path. */
  addBoundaryPin(level: string, spec: PinSpec): string | undefined {
    const pins = this.graph.levels[level]?.boundaryPins;
    if (!pins) {
      this.report('warning', `Unknown hierarchy level ${level}`, spec.line ?? 0);
      return undefined;
    }
    if (!pins.some((p) => p.name === spec.name)) {
      pins.push({ ...spec, parameters: { ...spec.parameters } });
    }
    return joinPath(level, spec.name);
  }

  /** Declares a pin on the instance at `owner`, unless it has a pin of that name. */
  addInstancePin(owner: string, spec: PinSpec): void {
    const pins = this.graph.instances[owner]?.pins;
    if (pins && !pins.some((p) => p.name === spec.name)) {
      pins.push({ ...spec, parameters: { ...spec.parameters } });
    }
  }

  setParameters(target: ParameterTarget, entries: readonly (readonly [string, string])[]): void {
    let parameters: Record<string, string> | undefined;
    if (target.pin === undefined) {
      parameters = this.graph.instances[target.owner]?.parameters;
    } else {
      parameters = this.findPin(target.owner, target.pin)?.parameters;
    }
    if (!parameters) {
      return;
    }
    for (const [key, value] of entries) {
      parameters[key] = value;
    }
  }

  /** Pin `name` of the level (boundary) or instance at `owner`. */
  private findPin(owner: string, name: string): SystemPin | undefined {
    const pins = this.graph.instances[owner]?.pins ?? this.graph.levels[owner]?.boundaryPins;
    return pins?.find((p) => p.name === name);
  }

  connect(
    level: string,
    requestedName: string | undefined,
    isInterface: boolean,
    refs: readonly PinRef[],
    line: number
  ): void {
    if (refs.length === 0) {
      return;
    }
    const first = refs[0];
    const name =
      requestedName ??
      (first.instance === null ? first.pin : `${lastComponent(first.instance)}_${first.pin}`);
    const id = `${level}::${name}`;
    let net = this.graph.nets.find((n) => n.id === id);
    if (!net) {
      net = {
        id,
        name,
        level,
        isInterface,
        category: isInterface ? 'interface' : 'signal',
        categorySource: 'default',
        endpoints: [],
        line,
      };
      this.graph.nets.push(net);
    }
    for (const ref of refs) {
      if (ref.instance !== null) {
        const lines = this.mentions.get(ref.instance) ?? [];
        if (!lines.includes(line)) {
          this.mentions.set(ref.instance, [...lines, line]);
        }
      }
      if (!net.endpoints.some((e) => e.instance === ref.instance && e.pin === ref.pin)) {
        net.endpoints.push(ref);
        this.ensurePin(level, ref, isInterface);
      }
    }
  }

  /** Makes sure the endpoint's pin exists on its instance or level. */
  private ensurePin(level: string, ref: PinRef, isInterface: boolean): void {
    const pins =
      ref.instance === null
        ? this.graph.levels[level]?.boundaryPins
        : this.graph.instances[ref.instance]?.pins;
    if (pins && !pins.some((p) => p.name === ref.pin)) {
      pins.push({
        name: ref.pin,
        isInterface,
        direction: 'unknown',
        directionSource: 'unknown',
        parameters: {},
      });
    }
  }

  addAddressSegment(segment: AddressSegment): void {
    this.graph.addressSegments.push(segment);
  }

  /** Finalizes metadata, diagnostics and capabilities and returns the graph. */
  finish(): SystemGraph {
    const base = this.fileName.split(/[\\/]/).pop() ?? this.fileName;
    const name = this.designName ?? this.createdDesignName ?? base.replace(/\.[^.]*$/, '');
    const graph = this.graph;
    this.addReferencedBlackBoxes();
    if (this.blackBoxLines.size > 0) {
      this.hasWarning = true;
      const message = `Not defined in this file, shown as a black box: ${[
        ...this.blackBoxLines.keys(),
      ]
        .map((path) => path.slice(1))
        .join(', ')}`;
      const lines = [...new Set([...this.blackBoxLines.values()].flat())].sort((x, y) => x - y);
      this.diagnostics.set(`warning:${message}`, { severity: 'warning', message, lines });
    }
    graph.name = name;
    graph.levels['/'].name = name;
    if (this.toolVersion !== undefined) {
      graph.source.toolVersion = this.toolVersion;
    }
    const diagnostics = [...this.diagnostics.values()];
    if (this.vivadoOnly.size > 0) {
      diagnostics.push({
        severity: 'info',
        message: `Skipped Vivado-only commands: ${[...this.vivadoOnly.keys()].join(', ')}`,
        lines: [...this.vivadoOnly.values()].flat().sort((a, b) => a - b),
      });
    }
    graph.diagnostics = diagnostics;
    if (this.hasWarning) {
      graph.capabilities.connections = 'partial';
      graph.capabilities.addressMap = 'partial';
    }
    return graph;
  }
}
