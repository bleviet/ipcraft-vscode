import type { IpCore, Interrupt } from '../../../../types/ipCore';
import type { CanvasElement, CanvasElementKind } from '../../../hooks/useCanvasSelection';

export function getElementName(element: CanvasElement, ipCore: IpCore): string {
  switch (element.kind) {
    case 'body':
      return ipCore.vlnv.name;
    case 'clock':
      return (ipCore.clocks ?? [])[element.index]?.name ?? '';
    case 'reset':
      return (ipCore.resets ?? [])[element.index]?.name ?? '';
    case 'port':
      return (ipCore.ports ?? [])[element.index]?.name ?? '';
    case 'busInterface':
      return (ipCore.busInterfaces ?? [])[element.index]?.name ?? '';
    case 'parameter': {
      const p = (ipCore.parameters ?? [])[element.index] as unknown as
        | Record<string, unknown>
        | undefined;
      return String(p?.name ?? '');
    }
    case 'interrupt':
      return ((ipCore.interrupts ?? []) as Interrupt[])[element.index]?.name ?? '';
    case 'subcore': {
      const rawSubcores = (ipCore.subcores ?? []) as Array<
        string | { vlnv: string; path?: string }
      >;
      const sub = rawSubcores[element.index];
      if (!sub) {
        return '';
      }
      const vlnv = typeof sub === 'string' ? sub : sub.vlnv;
      return vlnv.split(':')[2] ?? vlnv;
    }
    case 'generics':
      return '';
    case 'busInterfaceMatrix':
      return '';
    default:
      return '';
  }
}

export function kindLabel(kind: CanvasElementKind): string {
  switch (kind) {
    case 'body':
      return 'IP Core';
    case 'clock':
      return 'Clock';
    case 'reset':
      return 'Reset';
    case 'port':
      return 'Port';
    case 'busInterface':
      return 'Bus Interface';
    case 'parameter':
      return 'Parameter';
    case 'interrupt':
      return 'Interrupt';
    case 'subcore':
      return 'Dependency';
    case 'generics':
      return 'Generics';
    case 'busInterfaceMatrix':
      return 'Ports';
    default:
      return kind;
  }
}

export function canonicalDirection(dir?: string, fallback = 'in'): string {
  if (dir === 'in' || dir === 'input') {
    return 'in';
  }
  if (dir === 'out' || dir === 'output') {
    return 'out';
  }
  if (dir === 'inout') {
    return 'inout';
  }
  return fallback;
}

export function normalizePolarity(p?: string): string {
  if (p === 'active_low' || p === 'activeLow') {
    return 'activeLow';
  }
  if (p === 'active_high' || p === 'activeHigh') {
    return 'activeHigh';
  }
  return p ?? 'activeLow';
}

export const DIR_2WAY = [
  { value: 'in', label: 'input' },
  { value: 'out', label: 'output' },
];

export const DIR_3WAY = [
  { value: 'in', label: 'input' },
  { value: 'out', label: 'output' },
  { value: 'inout', label: 'inout' },
];

export const POLARITY_OPTS = [
  { value: 'activeLow', label: 'activeLow (active-low / RESET_N)' },
  { value: 'activeHigh', label: 'activeHigh (active-high / RESET)' },
];

export const BUS_MODE_OPTS = [
  { value: 'slave', label: 'slave' },
  { value: 'master', label: 'master' },
];

export const BUS_ENDIANNESS_OPTS = [
  { value: 'little', label: 'little' },
  { value: 'big', label: 'big' },
];

export const CONDUIT_MODE_OPTS = [
  { value: 'conduit', label: 'conduit (signal group / neutral)' },
  { value: 'master', label: 'master (initiator)' },
  { value: 'slave', label: 'slave (target)' },
];

/** Normalize legacy sink/source modes to slave/master for display and persistence. */
export function normalizeBusMode(mode: string): string {
  if (mode === 'sink') {
    return 'slave';
  }
  if (mode === 'source') {
    return 'master';
  }
  return mode;
}
