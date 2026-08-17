import { useState, useCallback } from 'react';
import * as yaml from 'yaml';
import { applyPathEdits, applyPathDeletes } from '../../../yamledit';
import { busSupportsMemoryMap } from '../../../shared/busVlnv';
import {
  canonicalizeBusInterfacePorts,
  canonicalizeBusType,
  type BusInterfacePortMutation,
  type NormalizedBusLibrary,
} from '../../../shared/busContracts';
import type { BusInterface } from '../../../domain/ipcore.types';

export interface IpCoreImports {
  memoryMaps?: Record<string, unknown>[];
  fileSets?: Record<string, unknown>[];
  busLibrary?: NormalizedBusLibrary;
}

export interface IpCoreState {
  ipCore: Record<string, unknown> | null;
  rawYaml: string;
  parseError: string | null;
  fileName: string;
  imports: IpCoreImports;
}

interface InternalIpCoreState extends IpCoreState {
  pendingBusCanonicalization: readonly BusInterfacePortMutation[];
}

export interface UpdateMessage {
  type: 'update';
  text: string;
  fileName: string;
  imports?: IpCoreImports;
}

export interface ValidationError {
  message: string;
  section: 'busInterfaces';
  entityName: string;
  field: string;
}

/**
 * The schema documents `bus_interfaces` as a snake_case alias for `busInterfaces`
 * (ip_core.schema.json). Unlike the Memory Map domain layer, the IP Core webview
 * reads the parsed YAML object directly without going through domain/parse.ts, so
 * that alias must be resolved here or bus interfaces silently vanish from the canvas.
 */
function aliasBusInterfaces(data: Record<string, unknown>): Record<string, unknown> {
  if (data.busInterfaces === undefined && Array.isArray(data.bus_interfaces)) {
    return { ...data, busInterfaces: data.bus_interfaces };
  }
  return data;
}

type BusInterfaceRoot = 'busInterfaces' | 'bus_interfaces';

function getBusInterfaceRoot(data: Record<string, unknown>): BusInterfaceRoot {
  return data.busInterfaces === undefined && Array.isArray(data.bus_interfaces)
    ? 'bus_interfaces'
    : 'busInterfaces';
}

function getAuthoredBusInterfaceRoot(text: string): BusInterfaceRoot {
  const parsed = yaml.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'busInterfaces';
  }
  return getBusInterfaceRoot(parsed as Record<string, unknown>);
}

function remapBusInterfacePath(
  path: readonly (string | number)[],
  root: BusInterfaceRoot
): Array<string | number> {
  return path[0] === 'busInterfaces' ? [root, ...path.slice(1)] : [...path];
}

function canonicalizeParsedIpCore(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary | undefined
): {
  ipCore: Record<string, unknown>;
  mutations: readonly BusInterfacePortMutation[];
} {
  const busInterfaceRoot = getBusInterfaceRoot(data);
  const aliased = aliasBusInterfaces(data);
  if (!library || !Array.isArray(aliased.busInterfaces)) {
    return { ipCore: aliased, mutations: [] };
  }

  const parsedBusInterfaces = aliased.busInterfaces as unknown[];
  const mutations: BusInterfacePortMutation[] = [];
  const busInterfaces = parsedBusInterfaces.map((rawBus, index) => {
    if (!rawBus || typeof rawBus !== 'object' || Array.isArray(rawBus)) {
      return rawBus;
    }

    const busInterface = rawBus as BusInterface;
    const match = canonicalizeBusType(String(busInterface.type ?? ''), library);
    if (!match) {
      return rawBus;
    }

    const canonicalized = canonicalizeBusInterfacePorts(match.contract, busInterface, index);
    mutations.push(
      ...canonicalized.mutations.map<BusInterfacePortMutation>(([path, value]) => [
        remapBusInterfacePath(path, busInterfaceRoot),
        value,
      ])
    );
    return canonicalized.busInterface;
  });

  return {
    ipCore: { ...aliased, busInterfaces },
    mutations,
  };
}

function applyYamlMutation(
  text: string,
  [path, value]: readonly [readonly (string | number)[], unknown]
): string {
  return value === undefined
    ? applyPathDeletes(text, [[...path]])
    : applyPathEdits(text, [{ path: [...path], value }]);
}

/**
 * Hook for managing IP Core state
 *
 * Handles:
 * - YAML parsing
 * - State updates from extension
 * - Import resolution data
 * - Reference validation
 */
export function useIpCoreState() {
  const [state, setState] = useState<InternalIpCoreState>({
    ipCore: null,
    rawYaml: '',
    parseError: null,
    fileName: '',
    imports: {},
    pendingBusCanonicalization: [],
  });

  /**
   * Update state from YAML text
   * Called when extension sends new document content
   */
  const updateFromYaml = useCallback((text: string, fileName: string, imports?: IpCoreImports) => {
    try {
      const parsed = yaml.parse(text) as unknown;

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML: must be an object');
      }

      const { ipCore, mutations } = canonicalizeParsedIpCore(
        parsed as Record<string, unknown>,
        imports?.busLibrary
      );

      setState({
        ipCore,
        rawYaml: text,
        parseError: null,
        fileName,
        imports: imports ?? {},
        pendingBusCanonicalization: mutations,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        rawYaml: text,
        parseError: (error as Error).message,
        fileName,
      }));
    }
  }, []);

  /**
   * Update IP core data at a specific path
   *
   * @param path Path to update (e.g., ['clocks', 0, 'name'])
   * @param value New value
   */
  const updateIpCore = useCallback((path: Array<string | number>, value: unknown) => {
    setState((prev) => {
      if (!prev.ipCore) {
        return prev;
      }

      try {
        let newYaml = prev.rawYaml;
        const busInterfaceRoot = getAuthoredBusInterfaceRoot(newYaml);
        for (const mutation of prev.pendingBusCanonicalization) {
          newYaml = applyYamlMutation(newYaml, mutation);
        }
        newYaml = applyYamlMutation(newYaml, [
          remapBusInterfacePath(path, busInterfaceRoot),
          value,
        ]);

        const { ipCore } = canonicalizeParsedIpCore(
          yaml.parse(newYaml) as Record<string, unknown>,
          prev.imports.busLibrary
        );

        return {
          ...prev,
          ipCore,
          rawYaml: newYaml,
          pendingBusCanonicalization: [],
        };
      } catch (error) {
        console.error('Failed to update YAML:', error);
        return prev;
      }
    });
  }, []);

  /**
   * Apply several path edits/deletes as a single state transition.
   *
   * Applied in the same sequence as calling `updateIpCore` once per mutation,
   * but inside one `setState` updater instead of N separate calls, so it's
   * guaranteed to be one state transition (and therefore one undo checkpoint
   * and one debounced outbound YAML message) regardless of whether the
   * caller runs inside a React event handler.
   */
  const updateIpCoreBatch = useCallback((mutations: Array<[Array<string | number>, unknown]>) => {
    setState((prev) => {
      if (!prev.ipCore) {
        return prev;
      }

      try {
        let currentYaml = prev.rawYaml;
        const busInterfaceRoot = getAuthoredBusInterfaceRoot(currentYaml);
        for (const mutation of prev.pendingBusCanonicalization) {
          currentYaml = applyYamlMutation(currentYaml, mutation);
        }
        for (const [path, value] of mutations) {
          currentYaml = applyYamlMutation(currentYaml, [
            remapBusInterfacePath(path, busInterfaceRoot),
            value,
          ]);
        }

        const { ipCore } = canonicalizeParsedIpCore(
          yaml.parse(currentYaml) as Record<string, unknown>,
          prev.imports.busLibrary
        );

        return {
          ...prev,
          ipCore,
          rawYaml: currentYaml,
          pendingBusCanonicalization: [],
        };
      } catch (error) {
        console.error('Failed to apply batch YAML update:', error);
        return prev;
      }
    });
  }, []);

  /**
   * Get validation errors for cross-references
   */
  const getValidationErrors = useCallback((): ValidationError[] => {
    if (!state.ipCore) {
      return [];
    }

    const errors: ValidationError[] = [];
    const { ipCore } = state;

    // Validate bus interface references
    if (ipCore.busInterfaces && Array.isArray(ipCore.busInterfaces)) {
      for (const bus of ipCore.busInterfaces as Array<Record<string, unknown>>) {
        // Check associated clock
        if (bus.associatedClock && typeof bus.associatedClock === 'string') {
          const clockExists =
            Array.isArray(ipCore.clocks) &&
            ipCore.clocks.some((c: Record<string, unknown>) => c.name === bus.associatedClock);
          if (!clockExists) {
            errors.push({
              message: `Bus interface '${String(bus.name)}' references unknown clock '${String(bus.associatedClock)}'`,
              section: 'busInterfaces',
              entityName: String(bus.name),
              field: 'associatedClock',
            });
          }
        }

        // Check associated reset
        if (bus.associatedReset && typeof bus.associatedReset === 'string') {
          const resetExists =
            Array.isArray(ipCore.resets) &&
            ipCore.resets.some((r: Record<string, unknown>) => r.name === bus.associatedReset);
          if (!resetExists) {
            errors.push({
              message: `Bus interface '${String(bus.name)}' references unknown reset '${String(bus.associatedReset)}'`,
              section: 'busInterfaces',
              entityName: String(bus.name),
              field: 'associatedReset',
            });
          }
        }

        // Check memory map reference
        if (bus.memoryMapRef && typeof bus.memoryMapRef === 'string') {
          const busArray = bus.array as { count?: number } | undefined | null;
          const isArray = (busArray?.count ?? 0) > 1;

          if (isArray) {
            errors.push({
              message: `Bus interface '${String(bus.name)}' is an array and cannot have a memory map reference`,
              section: 'busInterfaces',
              entityName: String(bus.name),
              field: 'memoryMapRef',
            });
          } else if (
            state.imports.busLibrary &&
            !busSupportsMemoryMap(
              String(bus.type ?? ''),
              String(bus.mode ?? ''),
              state.imports.busLibrary
            )
          ) {
            errors.push({
              message: `Bus interface '${String(bus.name)}' of type '${String(bus.type)}' in '${String(bus.mode)}' mode does not support memory map references`,
              section: 'busInterfaces',
              entityName: String(bus.name),
              field: 'memoryMapRef',
            });
          } else {
            // Check both inline array and imported library for the referenced map name.
            // Entries created by the UI may have an `import` field, but they still have a `name`.
            const memMapExists =
              (Array.isArray(ipCore.memoryMaps) &&
                ipCore.memoryMaps.some(
                  (m: Record<string, unknown>) => m.name === bus.memoryMapRef
                )) ||
              (Array.isArray(state.imports.memoryMaps) &&
                state.imports.memoryMaps.some(
                  (m: Record<string, unknown>) => m.name === bus.memoryMapRef
                ));
            if (!memMapExists) {
              errors.push({
                message: `Bus interface '${String(bus.name)}' references unknown memory map '${String(bus.memoryMapRef)}'`,
                section: 'busInterfaces',
                entityName: String(bus.name),
                field: 'memoryMapRef',
              });
            }
          }
        }
      }
    }

    return errors;
  }, [state.ipCore, state.imports]);

  const { pendingBusCanonicalization: _pendingBusCanonicalization, ...publicState } = state;

  return {
    ...publicState,
    updateFromYaml,
    updateIpCore,
    updateIpCoreBatch,
    getValidationErrors,
  };
}
