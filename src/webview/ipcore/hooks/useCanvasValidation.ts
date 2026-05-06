import { IpCore, Clock, Reset, Port, BusInterface } from '../../types/ipCore';

export type ValidationSeverity = 'warning' | 'error';

export interface ValidationAnnotation {
  severity: ValidationSeverity;
  message: string;
}

export type CanvasAnnotations = Record<string, ValidationAnnotation[]>;

export const useCanvasValidation = (ipCore: IpCore): CanvasAnnotations => {
  const annotations: CanvasAnnotations = {};

  const addAnnotation = (id: string, severity: ValidationSeverity, message: string) => {
    if (!annotations[id]) {
      annotations[id] = [];
    }
    annotations[id].push({ severity, message });
  };

  const portNames = new Set<string>();
  const busNames = new Set<string>();

  // Check clocks
  ipCore.clocks?.forEach((clock: Clock, idx: number) => {
    const id = `clock:${idx}`;
    if (!clock.name) {
      addAnnotation(id, 'error', 'Clock must have a name');
    }
  });

  // Check resets
  ipCore.resets?.forEach((reset: Reset, idx: number) => {
    const id = `reset:${idx}`;
    if (!reset.name) {
      addAnnotation(id, 'error', 'Reset must have a name');
    }
  });

  // Check ports
  ipCore.ports?.forEach((port: Port, idx: number) => {
    const id = `port:${idx}`;
    if (!port.name) {
      addAnnotation(id, 'error', 'Port must have a name');
    } else {
      if (portNames.has(port.name)) {
        addAnnotation(id, 'error', `Duplicate port name: ${port.name}`);
      } else {
        portNames.add(port.name);
      }
    }
  });

  // Check bus interfaces
  ipCore.busInterfaces?.forEach((bus: BusInterface, idx: number) => {
    const id = `bus:${idx}`;
    if (!bus.name) {
      addAnnotation(id, 'error', 'Bus interface must have a name');
    } else {
      if (busNames.has(bus.name)) {
        addAnnotation(id, 'error', `Duplicate bus interface name: ${bus.name}`);
      } else {
        busNames.add(bus.name);
      }
    }

    if (!bus.type) {
      addAnnotation(id, 'error', 'Bus interface must have a type');
    }

    if (!bus.associatedClock) {
      addAnnotation(id, 'warning', 'Bus interface is missing an associated clock');
    } else {
      const clockExists = ipCore.clocks?.some((c: Clock) => c.name === bus.associatedClock);
      if (!clockExists) {
        addAnnotation(id, 'error', `Referenced clock '${bus.associatedClock}' does not exist`);
      }
    }

    if (bus.associatedReset) {
      const resetExists = ipCore.resets?.some((r: Reset) => r.name === bus.associatedReset);
      if (!resetExists) {
        addAnnotation(id, 'error', `Referenced reset '${bus.associatedReset}' does not exist`);
      }
    }
  });

  return annotations;
};
