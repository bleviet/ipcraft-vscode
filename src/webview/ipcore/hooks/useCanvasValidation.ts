import { IpCore, Clock, Reset, Port, BusInterface } from '../../types/ipCore';
import { reconstructBusPortNameSet } from '../../../shared/busPortNameSet';

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

    // A hand-edited YAML file can bypass the UI restrictions. A parameterized (string)
    // width is left unflagged — it may resolve to a byte multiple at elaboration, and the
    // generated HDL guards that with a runtime assertion.
    if (port.endianness === 'big' && port.direction === 'inout') {
      addAnnotation(id, 'warning', 'Endianness "big" has no effect on an inout port');
    } else if (
      port.endianness === 'big' &&
      typeof port.width === 'number' &&
      !(port.width > 1 && port.width % 8 === 0)
    ) {
      addAnnotation(
        id,
        'warning',
        'Endianness "big" has no effect: width must be a multiple of 8 bits'
      );
    }
  });

  // Detect bus interfaces whose reconstructed physical port names actually collide —
  // mirroring the generator's own physicalPrefix + portNameOverrides formula. Distinct
  // instances of the same protocol (e.g. two Avalon-ST sinks) may legitimately share a
  // physicalPrefix as long as portNameOverrides fully disambiguate them; only a real
  // name collision is flagged.
  const busList = ipCore.busInterfaces ?? [];
  const reconstructedSets = busList.map((bus) =>
    bus.physicalPrefix ? reconstructBusPortNameSet(bus) : null
  );
  const collisionMessages = new Map<number, string[]>();
  for (let i = 0; i < busList.length; i++) {
    for (let j = i + 1; j < busList.length; j++) {
      const setI = reconstructedSets[i];
      const setJ = reconstructedSets[j];
      if (!setI || !setJ) {
        continue;
      }
      const collidingNames = [...setI].filter((n) => setJ.has(n)).sort();
      if (collidingNames.length === 0) {
        continue;
      }
      const message = `Port name "${collidingNames[0]}" collides with another bus interface`;
      collisionMessages.set(i, [...(collisionMessages.get(i) ?? []), message]);
      collisionMessages.set(j, [...(collisionMessages.get(j) ?? []), message]);
    }
  }

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

    // A conduit is a signal group with no clock domain of its own, so it must not
    // have either association. A real bus protocol (master/slave) may optionally
    // have a clock and/or reset — neither is required, but a reference to a
    // nonexistent clock/reset is always an error.
    const isConduit = (bus.mode ?? 'conduit') === 'conduit';

    if (isConduit) {
      if (bus.associatedClock) {
        addAnnotation(id, 'error', 'Conduit interfaces must not have an associated clock');
      }
      if (bus.associatedReset) {
        addAnnotation(id, 'error', 'Conduit interfaces must not have an associated reset');
      }
    } else {
      if (bus.associatedClock) {
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

    // Warn when this interface's reconstructed physical port names collide with another
    (collisionMessages.get(idx) ?? []).forEach((message) => {
      addAnnotation(id, 'warning', message);
    });

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
