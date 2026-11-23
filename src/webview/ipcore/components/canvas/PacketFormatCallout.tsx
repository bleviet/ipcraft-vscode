import React, { useMemo } from 'react';
import { buildLanes, type PacketFormatRefInfo } from '../../../../shared/packetFormat';
import { PacketLanes } from './PacketLanes';

/** Wide signals wrap into rows of this many bits, so every field gets a readable share of a row. */
const LANE_ROW_BITS = 32;

export interface PacketFormatCalloutProps {
  busName: string;
  packetRef: string;
  info: PacketFormatRefInfo | undefined;
  onOpen: (relativeFile: string) => void;
}

/**
 * Packet format of a streaming bus interface, shown in the canvas details row next to the bus info box, at screen
 * size and independent of canvas zoom.
 */
export const PacketFormatCallout: React.FC<PacketFormatCalloutProps> = ({
  busName,
  packetRef,
  info,
  onOpen,
}) => {
  const lanes = useMemo(() => (info?.format ? buildLanes(info.format, LANE_ROW_BITS) : []), [info]);
  const format = info?.format;
  const file = packetRef.split('#')[0];

  return (
    <div
      className="packet-callout"
      data-testid="packet-callout"
      role="region"
      aria-label={`Packet format of ${busName}`}
      // The card can overflow (max-height); a focus stop lets keyboard users scroll it.
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="packet-callout__header">
        <span className="packet-callout__title">{format ? format.name : packetRef}</span>
        {format && <span className="ci-field__hint">{format.dataWidth} bit</span>}
        <button
          type="button"
          className="ci-section__action-btn packet-callout__open"
          title="Open the packet format file"
          onClick={() => onOpen(file)}
        >
          <span className="codicon codicon-go-to-file" aria-hidden="true" /> Open format
        </button>
      </div>
      {!info && <div className="ci-field__hint">Resolving {packetRef}…</div>}
      {info?.error && (
        <div className="packet-format__error" role="alert">
          {info.error.message}
        </div>
      )}
      {format && (
        <>
          <div className="ci-field__hint">
            {busName}
            {format.description ? ` · ${format.description}` : ''}
            {format.extends.length > 0 ? ` · extends ${format.extends.join(' → ')}` : ''}
          </div>
          <PacketLanes lanes={lanes} />
        </>
      )}
    </div>
  );
};
