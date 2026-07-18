import { BitState, BitVector } from './BitVector';

export interface VcdSignal {
  id: string;
  name: string;
  width: number;
}

interface IndexedChange {
  time: bigint;
  literal: string;
}

export interface VcdSample {
  index: number;
  time: bigint;
  values: ReadonlyMap<string, BitVector>;
  changedSignals: ReadonlySet<string>;
  changedBits: ReadonlyMap<string, ReadonlySet<number>>;
}

function normalizeVcdBits(raw: string, width: number): BitVector {
  const states = Array.from(raw.toUpperCase(), (state): BitState => {
    if (state === '0' || state === '1') {
      return state === '0' ? 0 : 1;
    }
    return state === 'Z' ? 'Z' : 'X';
  });
  if (states.length > width) {
    throw new Error(`VCD value has ${states.length} bits but signal width is ${width}`);
  }
  const fill = states[0] === 'X' || states[0] === 'Z' ? states[0] : 0;
  return BitVector.fromBits([...Array<BitState>(width - states.length).fill(fill), ...states]);
}

function changedBitSet(previous: BitVector | undefined, current: BitVector): Set<number> {
  const changed = new Set<number>();
  if (previous?.width !== current.width) {
    for (let bit = 0; bit < current.width; bit++) {
      changed.add(bit);
    }
    return changed;
  }
  for (let bit = 0; bit < current.width; bit++) {
    if (previous.bit(bit) !== current.bit(bit)) {
      changed.add(bit);
    }
  }
  return changed;
}

export class VcdCapture {
  readonly signals: readonly VcdSignal[];
  readonly timescale: string;
  private readonly body: string;

  private constructor(signals: VcdSignal[], timescale: string, body: string) {
    this.signals = signals;
    this.timescale = timescale;
    this.body = body;
  }

  static parse(text: string): VcdCapture {
    const endDefinitions = text.indexOf('$enddefinitions');
    if (endDefinitions < 0) {
      throw new Error('VCD is missing $enddefinitions');
    }
    const bodyStart = text.indexOf('$end', endDefinitions + '$enddefinitions'.length);
    if (bodyStart < 0) {
      throw new Error('VCD has an incomplete $enddefinitions directive');
    }
    const header = text.slice(0, bodyStart + 4);
    const signals: VcdSignal[] = [];
    const scopes: string[] = [];
    for (const line of header.split(/\r?\n/)) {
      const scope = /^\s*\$scope\s+\S+\s+(\S+)\s+\$end/.exec(line);
      if (scope) {
        scopes.push(scope[1]);
        continue;
      }
      if (/^\s*\$upscope\s+\$end/.test(line)) {
        scopes.pop();
        continue;
      }
      const variable = /^\s*\$var\s+\S+\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+\[[^\]]+\])?\s+\$end/.exec(
        line
      );
      if (variable) {
        signals.push({
          width: Number(variable[1]),
          id: variable[2],
          name: [...scopes, variable[3]].join('.'),
        });
      }
    }
    const timescaleMatch = /\$timescale\s+([\s\S]*?)\s+\$end/.exec(header);
    return new VcdCapture(
      signals,
      timescaleMatch?.[1].replace(/\s+/g, '') ?? '1',
      text.slice(bodyStart + 4)
    );
  }

  selectSignals(names: readonly string[]): VcdSelection {
    const selected = this.signals.filter((signal) => names.includes(signal.name));
    if (selected.length !== names.length) {
      const found = new Set(selected.map((signal) => signal.name));
      const missing = names.filter((name) => !found.has(name));
      throw new Error(`VCD signal not found: ${missing.join(', ')}`);
    }
    const byId = new Map(selected.map((signal) => [signal.id, signal]));
    const changes = new Map(selected.map((signal) => [signal.id, [] as IndexedChange[]]));
    const sampleTimes: bigint[] = [];
    let time = BigInt(0);
    let changedAtTime = false;
    for (const line of this.body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('$')) {
        continue;
      }
      if (trimmed.startsWith('#')) {
        if (changedAtTime) {
          sampleTimes.push(time);
        }
        time = BigInt(trimmed.slice(1));
        changedAtTime = false;
        continue;
      }
      const vector = /^[bB]([01xXzZ]+)\s+(\S+)$/.exec(trimmed);
      const scalar = /^([01xXzZ])(\S+)$/.exec(trimmed);
      const id = vector?.[2] ?? scalar?.[2];
      const raw = vector?.[1] ?? scalar?.[1];
      if (id && raw && byId.has(id)) {
        changes.get(id)!.push({ time, literal: raw });
        changedAtTime = true;
      }
    }
    if (changedAtTime) {
      sampleTimes.push(time);
    }
    return new VcdSelection(selected, changes, [...new Set(sampleTimes.map(String))].map(BigInt));
  }
}

export class VcdSelection {
  constructor(
    readonly signals: readonly VcdSignal[],
    private readonly changes: ReadonlyMap<string, readonly IndexedChange[]>,
    readonly sampleTimes: readonly bigint[]
  ) {}

  get sampleCount(): number {
    return this.sampleTimes.length;
  }

  sample(index: number): VcdSample {
    if (!Number.isInteger(index) || index < 0 || index >= this.sampleCount) {
      throw new RangeError(`VCD sample ${index} is outside 0..${this.sampleCount - 1}`);
    }
    const time = this.sampleTimes[index];
    const previousTime = index > 0 ? this.sampleTimes[index - 1] : undefined;
    const values = new Map<string, BitVector>();
    const changedSignals = new Set<string>();
    const changedBits = new Map<string, ReadonlySet<number>>();
    for (const signal of this.signals) {
      const signalChanges = this.changes.get(signal.id) ?? [];
      const currentChange = this.latestAtOrBefore(signalChanges, time);
      if (!currentChange) {
        continue;
      }
      const current = normalizeVcdBits(currentChange.literal, signal.width);
      values.set(signal.name, current);
      const previousChange =
        previousTime === undefined ? undefined : this.latestAtOrBefore(signalChanges, previousTime);
      const previous = previousChange
        ? normalizeVcdBits(previousChange.literal, signal.width)
        : undefined;
      const bits = changedBitSet(previous, current);
      if (bits.size > 0) {
        changedSignals.add(signal.name);
        changedBits.set(signal.name, bits);
      }
    }
    return { index, time, values, changedSignals, changedBits };
  }

  private latestAtOrBefore(
    changes: readonly IndexedChange[],
    time: bigint
  ): IndexedChange | undefined {
    let low = 0;
    let high = changes.length - 1;
    let result: IndexedChange | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (changes[middle].time <= time) {
        result = changes[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return result;
  }
}
