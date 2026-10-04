import { useState, useCallback } from 'react';
import * as yaml from 'yaml';
import { busSupportsMemoryMap } from '../../../shared/busVlnv';
import type { BusInterfacePortMutation, NormalizedBusLibrary } from '../../../shared/busContracts';
import {
  applyYamlMutation,
  canonicalizeParsedIpCore,
  getAuthoredBusInterfaceRoot,
  remapBusInterfacePath,
} from '../../../shared/busContracts/ipCoreCanonicalize';
import {
  isBehindLatestFormat,
  migrateIpCoreYaml,
  readIpCoreFormatVersion,
} from '../../../shared/ipCoreFormat';

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
  /** Legacy-content canonicalization of a file already at the latest format version. */
  pendingBusCanonicalization: readonly BusInterfacePortMutation[];
  /** The file is behind the latest format version: the next edit upgrades it as a whole. */
  pendingFormatUpgrade: boolean;
}

/** Reads the parsed document into editor data, rejecting a format version this IPCraft cannot read. */
function deriveIpCoreState(
  parsed: Record<string, unknown>,
  library: NormalizedBusLibrary | undefined
): Pick<InternalIpCoreState, 'ipCore' | 'pendingBusCanonicalization' | 'pendingFormatUpgrade'> {
  const version = readIpCoreFormatVersion(parsed);
  if (!version.ok) {
    throw new Error(version.message);
  }
  const { ipCore, mutations } = canonicalizeParsedIpCore(parsed, library);
  // Without a bus library the upgrade cannot canonicalize, so it is not offered either.
  const pendingFormatUpgrade = isBehindLatestFormat(version.version) && library !== undefined;
  return {
    ipCore,
    pendingBusCanonicalization: pendingFormatUpgrade ? [] : mutations,
    pendingFormatUpgrade,
  };
}

/**
 * The document text an edit starts from: a file behind the latest format version is upgraded
 * by the same migration `ipcraft migrate` runs; otherwise the pending canonicalization applies.
 * Either way the edit and its prerequisite land in one document update.
 */
function textBeforeEdit(prev: InternalIpCoreState): string {
  if (prev.pendingFormatUpgrade && prev.imports.busLibrary) {
    return migrateIpCoreYaml(prev.rawYaml, prev.imports.busLibrary).text;
  }
  return prev.pendingBusCanonicalization.reduce(applyYamlMutation, prev.rawYaml);
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
    pendingFormatUpgrade: false,
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

      const derived = deriveIpCoreState(parsed as Record<string, unknown>, imports?.busLibrary);

      setState({
        ...derived,
        rawYaml: text,
        parseError: null,
        fileName,
        imports: imports ?? {},
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
        let newYaml = textBeforeEdit(prev);
        const busInterfaceRoot = getAuthoredBusInterfaceRoot(newYaml);
        newYaml = applyYamlMutation(newYaml, [
          remapBusInterfacePath(path, busInterfaceRoot),
          value,
        ]);

        // Keep any canonicalization the edit introduced pending, so the next
        // index-based edit applies it first and the raw YAML matches ipCore.
        const derived = deriveIpCoreState(
          yaml.parse(newYaml) as Record<string, unknown>,
          prev.imports.busLibrary
        );

        return {
          ...prev,
          ...derived,
          rawYaml: newYaml,
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
        let currentYaml = textBeforeEdit(prev);
        const busInterfaceRoot = getAuthoredBusInterfaceRoot(currentYaml);
        for (const [path, value] of mutations) {
          currentYaml = applyYamlMutation(currentYaml, [
            remapBusInterfacePath(path, busInterfaceRoot),
            value,
          ]);
        }

        // Keep any canonicalization the edit introduced pending, so the next
        // index-based edit applies it first and the raw YAML matches ipCore.
        const derived = deriveIpCoreState(
          yaml.parse(currentYaml) as Record<string, unknown>,
          prev.imports.busLibrary
        );

        return {
          ...prev,
          ...derived,
          rawYaml: currentYaml,
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

  const {
    pendingBusCanonicalization: _pendingBusCanonicalization,
    pendingFormatUpgrade: _pendingFormatUpgrade,
    ...publicState
  } = state;

  return {
    ...publicState,
    updateFromYaml,
    updateIpCore,
    updateIpCoreBatch,
    getValidationErrors,
  };
}
