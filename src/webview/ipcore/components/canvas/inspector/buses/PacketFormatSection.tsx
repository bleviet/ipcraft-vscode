import React, { useEffect, useMemo } from 'react';
import {
  filterCandidates,
  type PacketFormatCandidate,
  type PacketFormatRefInfo,
} from '../../../../../../shared/packetFormat';
import { PropSelect, Section } from '../controls/InspectorFields';

export interface PacketFormatSectionProps {
  currentRef: string | undefined;
  info: PacketFormatRefInfo | undefined;
  candidates: readonly PacketFormatCandidate[];
  /** The interface's data width and bus type names, when known; narrows the picker. */
  dataWidth?: number;
  busTypeNames?: readonly string[];
  onRequestCandidates: () => void;
  onChange: (ref: string | null) => void;
  /** Path as written in the ref (relative to the `.ip.yml`). */
  onOpen: (relativeFile: string) => void;
}

/** "Packet format" part of the streaming bus inspector: picker and open action. The bit layout is drawn on the canvas. */
export const PacketFormatSection: React.FC<PacketFormatSectionProps> = ({
  currentRef,
  info,
  candidates,
  dataWidth,
  busTypeNames,
  onRequestCandidates,
  onChange,
  onOpen,
}) => {
  useEffect(() => {
    onRequestCandidates();
    // Ask once per mounted inspector; the host answers with the workspace list.
  }, [onRequestCandidates]);

  const options = useMemo(() => {
    const matching = filterCandidates(candidates, { dataWidth, busTypeNames });
    const refs = matching.map((c) => ({
      value: c.ref,
      label: `${c.file}#${c.name} (${c.dataWidth} bit)`,
    }));
    if (currentRef && !refs.some((o) => o.value === currentRef)) {
      refs.unshift({ value: currentRef, label: currentRef });
    }
    return refs;
  }, [candidates, dataWidth, busTypeNames, currentRef]);

  const file = currentRef?.split('#')[0];

  return (
    <Section
      title="Packet format"
      actions={
        file ? (
          <button
            type="button"
            className="ci-section__action-btn"
            title="Open the packet format file"
            onClick={() => onOpen(file)}
          >
            <span className="codicon codicon-go-to-file" aria-hidden="true" /> Open format
          </button>
        ) : undefined
      }
    >
      <PropSelect
        label="Format"
        value={currentRef ?? ''}
        options={options}
        onSave={(v) => onChange(v || null)}
        emptyOption="— None —"
      />
      {info?.error && (
        <div className="packet-format__error" role="alert">
          {info.error.message}
        </div>
      )}
      {info?.format && (
        <div className="ci-field__hint">
          {info.format.dataWidth} bit · bit layout shown below the canvas
        </div>
      )}
    </Section>
  );
};
