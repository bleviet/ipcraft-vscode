import React from 'react';
import type { BusInterface, Clock, IpCore, Reset } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import { validateUniqueName, validateVhdlIdentifier } from '../../../../../shared/utils/validation';
import { busSupportsMemoryMap } from '../../../../../../shared/busVlnv';
import { isConduitType, lookupBusDef } from '../../../../data/busDefinitions';
import { PropField, PropSelect, Section } from '../controls/InspectorFields';
import { BusTypeField, MemoryMapField } from '../controls/BusTypeFields';
import { BUS_ENDIANNESS_OPTS, BUS_MODE_OPTS, normalizeBusMode } from '../inspectorMetadata';
import { ArraySection, PortWidthOverridesSection } from './ConduitFields';
import { ConduitPanel } from './ConduitPanel';

export interface BusPanelProps {
  bus: BusInterface;
  index: number;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
}

/** Returns true if the bus interface is a custom (user-defined) interface that should
 *  be edited via the ConduitPanel rather than the standard BusPanel. This covers:
 *  - Mode explicitly set to 'conduit'
 *  - Type name includes 'conduit'
 *  - Inline conduit ports are defined
 *  - Bus type is not a built-in protocol (e.g. user:busif:xcvr:1.0)
 */
function isCustomBusInterface(bus: BusInterface): boolean {
  return (
    bus.mode === 'conduit' ||
    isConduitType(bus.type) ||
    (bus.conduitPorts?.length ?? 0) > 0 ||
    lookupBusDef(bus.type) === null
  );
}

export const BusPanel: React.FC<BusPanelProps> = ({ bus, index, ipCore, imports, onUpdate }) => {
  if (isCustomBusInterface(bus)) {
    return (
      <ConduitPanel bus={bus} index={index} ipCore={ipCore} imports={imports} onUpdate={onUpdate} />
    );
  }

  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const existingNames = buses.map((b) => b.name).filter((_, i) => i !== index);

  // Detect if this interface's physicalPrefix collides with any sibling
  const currentPrefix = bus.physicalPrefix ?? '';
  const hasDuplicatePrefix =
    currentPrefix.length > 0 &&
    buses.some(
      (b, i) =>
        i !== index && (b.physicalPrefix ?? '').toLowerCase() === currentPrefix.toLowerCase()
    );

  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));

  // Memory map options: inline maps + imported maps (deduplicated)
  const inlineMaps = Array.isArray(ipCore.memoryMaps)
    ? (ipCore.memoryMaps as unknown as Array<{ name?: unknown; import?: unknown }>)
    : [];
  const inlineMapNames = inlineMaps.map((m) => String(m.name ?? ''));
  const importedMapNames = Array.isArray(imports?.memoryMaps)
    ? (imports.memoryMaps as Array<Record<string, unknown>>).map((m) => String(m.name ?? ''))
    : [];
  const allMapNames = [...new Set([...inlineMapNames, ...importedMapNames])].filter(Boolean);
  const mapOpts = allMapNames.map((m) => ({ value: m, label: m }));

  // Only single, slave memory-mapped interfaces (AXI4-Lite/Full, Avalon-MM) may have a memory map
  const arrayDef = bus.array as
    | { count?: number; physicalPrefixPattern?: string }
    | undefined
    | null;
  const isArray = (arrayDef?.count ?? 0) > 1;
  const hasPrefixPattern = isArray && !!arrayDef?.physicalPrefixPattern;
  const canHaveMemoryMap = !isArray && busSupportsMemoryMap(bus.type, bus.mode);

  // The import path shown for this interface's map entry (per-interface, not global).
  const currentMapImportPath: string | null = (() => {
    if (!bus.memoryMapRef) {
      return null;
    }
    const entry = inlineMaps.find((m) => String(m.name ?? '') === bus.memoryMapRef);
    return entry?.import ? String(entry.import) : null;
  })();

  /**
   * Called when the user browses and selects a .mm.yml file for THIS interface.
   * Creates or updates a named entry in ipCore.memoryMaps, and sets memoryMapRef
   * on this interface to that name — so two interfaces never share the same entry.
   * `canonicalName` is the map `name` field read from inside the file by the extension.
   */
  const handleMemoryMapFileChange = (filePath: string | null, canonicalName?: string) => {
    const currentMaps = Array.isArray(ipCore.memoryMaps)
      ? ([...(ipCore.memoryMaps as unknown as Array<Record<string, unknown>>)] as Array<
          Record<string, unknown>
        >)
      : [];

    if (!filePath) {
      // Clear: remove memoryMapRef from this interface.
      // If the referenced map entry has an import and is not used by any other interface,
      // remove it from the array to keep the YAML clean.
      const refName = bus.memoryMapRef;
      if (refName) {
        const usedByOthers = buses.some(
          (b, i) => i !== index && (b as { memoryMapRef?: string }).memoryMapRef === refName
        );
        if (!usedByOthers) {
          const entry = inlineMaps.find((m) => String(m.name ?? '') === refName);
          if (entry?.import) {
            // This was a file-backed entry created by this UI — safe to remove.
            const updated = currentMaps.filter((m) => String(m.name ?? '') !== refName);
            onUpdate(['memoryMaps'], updated.length ? updated : undefined);
          }
        }
      }
      onUpdate(['busInterfaces', index, 'memoryMapRef'], null);
      return;
    }

    // Prefer the canonical name from inside the file (sent by the extension host).
    // Fall back to deriving a name from the filename only when the file couldn't be read.
    const baseName =
      canonicalName ??
      filePath
        .split(/[/\\]/)
        .pop()!
        .replace(/\.(mm\.yml|mm\.yaml|yml|yaml)$/i, '');

    // Ensure uniqueness: if another interface already owns an entry with this name,
    // append the interface's own logical name to disambiguate.
    let mapName = baseName;
    const takenByOther = buses.some(
      (b, i) => i !== index && (b as { memoryMapRef?: string }).memoryMapRef === baseName
    );
    if (takenByOther) {
      mapName = `${baseName}_${String(bus.name ?? index)}`;
    }

    // Add or update the entry in the memoryMaps array.
    const existingIdx = currentMaps.findIndex((m) => String(m.name ?? '') === mapName);
    const newEntry: Record<string, unknown> = { name: mapName, import: filePath };
    if (existingIdx >= 0) {
      currentMaps[existingIdx] = newEntry;
    } else {
      currentMaps.push(newEntry);
    }

    onUpdate(['memoryMaps'], currentMaps);
    onUpdate(['busInterfaces', index, 'memoryMapRef'], mapName);
  };

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={bus.name}
          onSave={(v) => onUpdate(['busInterfaces', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="s_axi_lite"
          mono
        />
        <BusTypeField
          value={bus.type}
          busLibrary={imports?.busLibrary}
          onSave={(v) => onUpdate(['busInterfaces', index, 'type'], v)}
        />
      </Section>
      <Section title="Configuration">
        <PropSelect
          label="Mode"
          value={normalizeBusMode(bus.mode)}
          options={BUS_MODE_OPTS}
          onSave={(v) => onUpdate(['busInterfaces', index, 'mode'], v)}
        />
        <PropSelect
          label="Endianness"
          value={bus.endianness === 'big' ? 'big' : 'little'}
          options={BUS_ENDIANNESS_OPTS}
          onSave={(v) => onUpdate(['busInterfaces', index, 'endianness'], v)}
        />
        {!hasPrefixPattern && (
          <PropField
            label="Physical Prefix"
            value={bus.physicalPrefix ?? ''}
            onSave={(v) => onUpdate(['busInterfaces', index, 'physicalPrefix'], v || null)}
            hint={
              !bus.physicalPrefix && !isArray
                ? 'Defaults to s_axi_ at generation'
                : isArray
                  ? `Auto-pattern: ${bus.physicalPrefix ?? 's_axi_'}{index}_`
                  : undefined
            }
            mono
          />
        )}
        {hasDuplicatePrefix && !hasPrefixPattern && (
          <div
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs"
            role="alert"
            style={{
              background: 'var(--vscode-inputValidation-warningBackground)',
              border: '1px solid var(--vscode-inputValidation-warningBorder)',
              color:
                'var(--vscode-inputValidation-warningForeground, var(--vscode-editor-foreground))',
            }}
          >
            <span className="codicon codicon-warning" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              Duplicate prefix — another interface uses <code>{currentPrefix}</code>. Generated port
              names will conflict.
            </span>
          </div>
        )}
      </Section>
      <Section title="Associations">
        <PropSelect
          label="Clock"
          value={bus.associatedClock ?? ''}
          options={clockOpts}
          onSave={(v) => onUpdate(['busInterfaces', index, 'associatedClock'], v || null)}
          emptyOption="— None —"
        />
        <PropSelect
          label="Reset"
          value={bus.associatedReset ?? ''}
          options={resetOpts}
          onSave={(v) => onUpdate(['busInterfaces', index, 'associatedReset'], v || null)}
          emptyOption="— None —"
        />
        {canHaveMemoryMap && (
          <MemoryMapField importPath={currentMapImportPath} onSave={handleMemoryMapFileChange} />
        )}
        {canHaveMemoryMap && mapOpts.length > 0 && (
          <PropSelect
            label="Map Name"
            value={bus.memoryMapRef ?? ''}
            options={mapOpts}
            onSave={(v) => onUpdate(['busInterfaces', index, 'memoryMapRef'], v || null)}
            emptyOption="— None —"
          />
        )}
      </Section>
      <ArraySection bus={bus} busIndex={index} onUpdate={onUpdate} />
      <PortWidthOverridesSection
        bus={bus}
        busIndex={index}
        paramNames={((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
          (p) => p.name
        )}
        paramValues={(
          (ipCore.parameters ?? []) as unknown as Array<{
            name: string;
            defaultValue?: unknown;
            value?: unknown;
          }>
        ).reduce<Record<string, number>>((acc, p) => {
          const raw = p.defaultValue ?? p.value;
          const n = Number(raw);
          if (p.name && Number.isFinite(n)) {
            acc[p.name] = n;
          }
          return acc;
        }, {})}
        onUpdate={onUpdate}
      />
    </>
  );
};
