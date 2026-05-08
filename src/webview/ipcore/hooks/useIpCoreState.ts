import { useState, useCallback } from 'react';
import * as yaml from 'yaml';

export interface IpCoreState {
  ipCore: Record<string, unknown> | null;
  rawYaml: string;
  parseError: string | null;
  fileName: string;
  imports: {
    memoryMaps?: Record<string, unknown>[];
    fileSets?: Record<string, unknown>[];
    busLibrary?: Record<string, unknown>;
  };
}

export interface UpdateMessage {
  type: 'update';
  text: string;
  fileName: string;
  imports?: {
    memoryMaps?: Record<string, unknown>[];
    fileSets?: Record<string, unknown>[];
    busLibrary?: Record<string, unknown>;
  };
}

export interface ValidationError {
  message: string;
  section: 'busInterfaces';
  entityName: string;
  field: string;
}

function busSupportsMemoryMap(busType: string, mode: string): boolean {
  if (mode !== 'slave') {
    return false;
  }
  const lower = busType.toLowerCase();
  if (
    lower.includes('stream') ||
    lower.includes('axi4s') ||
    lower.includes('avalon_st') ||
    lower.includes('avalon-st')
  ) {
    return false;
  }
  return lower.includes('axi4') || lower.includes('avalon_mm') || lower.includes('avalon-mm');
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
  const [state, setState] = useState<IpCoreState>({
    ipCore: null,
    rawYaml: '',
    parseError: null,
    fileName: '',
    imports: {},
  });

  /**
   * Update state from YAML text
   * Called when extension sends new document content
   */
  const updateFromYaml = useCallback(
    (text: string, fileName: string, imports?: Record<string, unknown>) => {
      try {
        const parsed = yaml.parse(text) as unknown;

        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid YAML: must be an object');
        }

        const data = parsed as Record<string, unknown>;

        setState({
          ipCore: data,
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
    },
    []
  );

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
        // Parse the existing YAML into a Document to preserve comments/structure
        const doc = yaml.parseDocument(prev.rawYaml);

        // Update or delete the value at the specified path
        if (value === undefined) {
          doc.deleteIn(path);
        } else {
          doc.setIn(path, value);
        }

        // Convert back to string (preserves format and comments)
        const newYaml = doc.toString({ indent: 2 });

        // Get new JS object for the state
        const newIpCore = doc.toJSON() as Record<string, unknown>;

        return {
          ...prev,
          ipCore: newIpCore,
          rawYaml: newYaml,
        };
      } catch (error) {
        console.error('Failed to update YAML:', error);
        return prev;
      }
    });
  }, []);

  /**
   * Get validation errors for cross-references
   */
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
          } else if (!busSupportsMemoryMap(String(bus.type ?? ''), String(bus.mode ?? ''))) {
            errors.push({
              message: `Bus interface '${String(bus.name)}' of type '${String(bus.type)}' in '${String(bus.mode)}' mode does not support memory map references`,
              section: 'busInterfaces',
              entityName: String(bus.name),
              field: 'memoryMapRef',
            });
          } else {
            const isFilePath =
              bus.memoryMapRef.toLowerCase().endsWith('.yml') ||
              bus.memoryMapRef.toLowerCase().endsWith('.yaml');
            const memMapExists =
              isFilePath ||
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

  return {
    ...state,
    updateFromYaml,
    updateIpCore,
    getValidationErrors,
  };
}
