/**
 * Mutable accumulator the Platform Designer reader writes into: a flat root
 * level of module instances, connection nets grouped by their start endpoint,
 * exported-interface boundary pins, address segments and diagnostics. Knows
 * nothing about XML.
 */

import type {
  AddressSegment,
  PinRef,
  SystemGraph,
  SystemInstance,
  SystemNet,
  SystemPin,
} from '../../domain/systemGraph';
import { qsysEndpointSpec, type QsysEnd } from './qsysInterfaceTypes';

const ROOT = '/';

export interface QsysEndpoint {
  instance: string;
  pin: string;
  /** The endpoint as written in the file. */
  text: string;
}

/** `instance.interface`, split at the first `.`. */
export function splitEndpoint(text: string): QsysEndpoint {
  const cut = text.indexOf('.');
  return cut < 0
    ? { instance: text, pin: '', text }
    : { instance: text.slice(0, cut), pin: text.slice(cut + 1), text };
}

export class QsysGraphBuilder {
  private readonly graph: SystemGraph;
  private readonly startNets = new Map<string, SystemNet>();
  private hasWarning = false;

  constructor(fileName: string, name: string) {
    this.graph = {
      name,
      source: { fileName, format: 'qsys' },
      levels: { [ROOT]: { path: ROOT, name, boundaryPins: [], instances: [] } },
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

  addModule(
    name: string,
    component: string | undefined,
    version: string | undefined,
    parameters: Record<string, string>,
    line: number
  ): void {
    const path = `/${name}`;
    if (this.graph.instances[path]) {
      return;
    }
    const instance: SystemInstance = {
      path,
      name,
      parent: ROOT,
      kind: 'ip',
      ...(component !== undefined && { component }),
      ...(version !== undefined && { version }),
      parameters,
      pins: [],
      line,
    };
    this.graph.instances[path] = instance;
    this.graph.levels[ROOT].instances.push(path);
  }

  hasModule(name: string): boolean {
    return `/${name}` in this.graph.instances;
  }

  warn(message: string, lines: number | number[]): void {
    this.hasWarning = true;
    this.graph.diagnostics.push({
      severity: 'warning',
      message,
      lines: Array.isArray(lines) ? lines : [lines],
    });
  }

  info(message: string, lines: number[]): void {
    this.graph.diagnostics.push({ severity: 'info', message, lines });
  }

  /** Adds `end` to the net grouped under `start` (created from the first connection). */
  connect(
    start: QsysEndpoint,
    end: QsysEndpoint,
    kind: string,
    parameters: Record<string, string>,
    line: number
  ): void {
    const startText = start.text;
    const startSpec = qsysEndpointSpec(kind, 'start');
    let net = this.startNets.get(startText);
    if (!net) {
      net = {
        id: `${ROOT}::${startText}`,
        name: startText,
        level: ROOT,
        isInterface: startSpec.isInterface,
        category: startSpec.category,
        categorySource: 'declared',
        endpoints: [],
        line,
      };
      this.startNets.set(startText, net);
      this.graph.nets.push(net);
    }
    this.addEndpoint(net, this.instancePin(start, kind, 'start', 'connection'));
    this.addEndpoint(net, this.instancePin(end, kind, 'end', 'connection'));
    if (startSpec.category === 'avalonmm' || startSpec.category === 'aximm') {
      this.addSegment(start, end, parameters.baseAddress, line);
    }
  }

  /**
   * Exports `internal` as a root boundary pin named `name`. Without `internal`
   * (its module is unknown) only the unconnected boundary pin is added.
   */
  exportInterface(
    name: string,
    internal: QsysEndpoint | undefined,
    type: string,
    end: QsysEnd,
    line: number
  ): void {
    const spec = qsysEndpointSpec(type, end);
    const boundary: PinRef = { instance: null, pin: name };
    const pin: SystemPin = {
      name,
      isInterface: spec.isInterface,
      direction: spec.direction,
      directionSource: 'declared',
      interfaceType: type,
      ...(spec.signalType !== undefined && { signalType: spec.signalType }),
      parameters: {},
      line,
    };
    this.graph.levels[ROOT].boundaryPins.push(pin);
    if (!internal) {
      return;
    }
    const internalRef = this.instancePin(internal, type, end, 'declared');
    const net = this.graph.nets.find((candidate) =>
      candidate.endpoints.some(
        (ref) => ref.instance === internalRef.instance && ref.pin === internalRef.pin
      )
    );
    if (net) {
      net.endpoints.push(boundary);
      return;
    }
    this.graph.nets.push({
      id: `${ROOT}::${name}`,
      name,
      level: ROOT,
      isInterface: spec.isInterface,
      category: spec.category,
      categorySource: 'declared',
      endpoints: [boundary, internalRef],
      line,
    });
  }

  finish(): SystemGraph {
    const graph = this.graph;
    if (this.hasWarning) {
      graph.capabilities.connections = 'partial';
    }
    if (graph.addressSegments.length > 0) {
      graph.capabilities.addressMap = 'partial';
    }
    return graph;
  }

  private addEndpoint(net: SystemNet, ref: PinRef): void {
    if (!net.endpoints.some((e) => e.instance === ref.instance && e.pin === ref.pin)) {
      net.endpoints.push(ref);
    }
  }

  /** Creates the instance pin on first use (first direction wins) and returns its ref. */
  private instancePin(
    endpoint: QsysEndpoint,
    type: string,
    end: QsysEnd,
    directionSource: 'declared' | 'connection'
  ): PinRef {
    const path = `/${endpoint.instance}`;
    const pins = this.graph.instances[path].pins;
    if (!pins.some((pin) => pin.name === endpoint.pin)) {
      const spec = qsysEndpointSpec(type, end);
      pins.push({
        name: endpoint.pin,
        isInterface: spec.isInterface,
        direction: spec.direction,
        directionSource,
        interfaceType: type,
        ...(spec.signalType !== undefined && { signalType: spec.signalType }),
        parameters: {},
      });
    }
    return { instance: path, pin: endpoint.pin };
  }

  private addSegment(
    start: QsysEndpoint,
    end: QsysEndpoint,
    offset: string | undefined,
    line: number
  ): void {
    const segment: AddressSegment = {
      addressSpace: start.text,
      segment: end.text,
      masterInstance: `/${start.instance}`,
      slaveInstance: `/${end.instance}`,
      ...(offset !== undefined && { offset }),
      line,
    };
    this.graph.addressSegments.push(segment);
  }
}
