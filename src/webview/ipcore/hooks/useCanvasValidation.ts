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
      const key = port.name.toLowerCase();
      if (portNames.has(key)) {
        addAnnotation(id, 'error', `Duplicate port name: ${port.name}`);
      } else {
        portNames.add(key);
      }
    }
  });

  // Collect duplicate physicalPrefix values across all bus interfaces
  const prefixCount = new Map<string, number>();
  ipCore.busInterfaces?.forEach((bus: BusInterface) => {
    const p = (bus.physicalPrefix ?? '').toLowerCase();
    if (p) {
      prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
    }
  });
  const duplicatePrefixSet = new Set(
    Array.from(prefixCount.entries())
      .filter(([, count]) => count > 1)
      .map(([prefix]) => prefix)
  );

  // Check bus interfaces
  ipCore.busInterfaces?.forEach((bus: BusInterface, idx: number) => {
    const id = `bus:${idx}`;
    if (!bus.name) {
      addAnnotation(id, 'error', 'Bus interface must have a name');
    } else {
      const key = bus.name.toLowerCase();
      if (busNames.has(key)) {
        addAnnotation(id, 'error', `Duplicate bus interface name: ${bus.name}`);
      } else {
        busNames.add(key);
      }
    }

    if (!bus.type) {
      addAnnotation(id, 'error', 'Bus interface must have a type');
    }

    // A conduit is a signal group with no clock domain of its own — unlike a real
    // bus protocol, where the clock association is expected (warned if missing)
    // and the reset association is optional.
    const isConduit = (bus.mode ?? 'conduit') === 'conduit';

    if (isConduit) {
      if (bus.associatedClock) {
        addAnnotation(id, 'error', 'Conduit interfaces must not have an associated clock');
      }
      if (bus.associatedReset) {
        addAnnotation(id, 'error', 'Conduit interfaces must not have an associated reset');
      }
    } else {
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
    }

    // Warn when this interface's physicalPrefix collides with another interface
    const prefix = bus.physicalPrefix ?? '';
    if (prefix && duplicatePrefixSet.has(prefix.toLowerCase())) {
      addAnnotation(
        id,
        'warning',
        `Duplicate physicalPrefix "${prefix}" — will produce conflicting port names in generated HDL`
      );
    }

    // Check conduit ports for duplicate names within the same bus interface
    if (Array.isArray(bus.conduitPorts)) {
      const conduitPortNames = new Set<string>();
      bus.conduitPorts.forEach((cp, portIdx) => {
        if (!cp.name) {
          return;
        }
        const key = cp.name.toLowerCase();
        if (conduitPortNames.has(key)) {
          addAnnotation(`bus:${idx}:cp:${portIdx}`, 'error', `Duplicate port name: ${cp.name}`);
        } else {
          conduitPortNames.add(key);
        }
      });
    }

    // Check standard bus portNameOverrides for duplicate physical suffixes within the same interface
    if (bus.portNameOverrides) {
      const suffixToLogicals = new Map<string, string[]>();
      for (const [logicalName, suffix] of Object.entries(bus.portNameOverrides)) {
        const key = suffix.toLowerCase();
        const existing = suffixToLogicals.get(key);
        if (existing) {
          existing.push(logicalName);
        } else {
          suffixToLogicals.set(key, [logicalName]);
        }
      }
      for (const [suffix, logicalNames] of suffixToLogicals) {
        if (logicalNames.length > 1) {
          for (const logicalName of logicalNames) {
            addAnnotation(`bus:${idx}:${logicalName}`, 'error', `Duplicate port name: ${suffix}`);
          }
        }
      }
    }
  });

  // Check interrupts
  const irqNames = new Set<string>();
  ((ipCore.interrupts ?? []) as Array<{ name?: string }>).forEach((irq, idx) => {
    const id = `interrupt:${idx}`;
    if (!irq.name) {
      addAnnotation(id, 'error', 'Interrupt must have a name');
    } else {
      const key = irq.name.toLowerCase();
      if (irqNames.has(key)) {
        addAnnotation(id, 'error', `Duplicate interrupt name: ${irq.name}`);
      } else {
        irqNames.add(key);
      }
    }
  });

  return annotations;
};
