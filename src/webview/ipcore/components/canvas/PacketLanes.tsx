import React from 'react';
import { bitRange, PALETTE_SIZE, type BeatLanes } from '../../../../shared/packetFormat';

/** Theme-driven chart colors (VS Code tokens with fixed fallbacks), cycled per segment. */
const COLORS = [
  'var(--vscode-charts-blue, #4b8bd8)',
  'var(--vscode-charts-green, #3fa564)',
  'var(--vscode-charts-orange, #d18a2e)',
  'var(--vscode-charts-purple, #8c41de)',
  'var(--vscode-charts-red, #cc4f4f)',
  'var(--vscode-charts-yellow, #b8a02e)',
];

/** Read-only beat view: per section, one row per signal (or per wrapped row of a wide signal), MSB left. */
export const PacketLanes: React.FC<{ lanes: readonly BeatLanes[] }> = ({ lanes }) => (
  <div className="packet-lanes" data-testid="packet-lanes">
    {lanes.map((beat) => (
      <div key={beat.section} className="packet-lanes__beat">
        <div className="ci-field__label">
          {beat.section} · {beat.count}
        </div>
        {beat.lanes.map((lane) => {
          const lsb = lane.lsb ?? 0;
          const rows = `${lane.signal} ${bitRange(lsb + lane.width - 1, lsb)}`;
          return (
            <div
              key={`${lane.signal}:${lsb}`}
              className="packet-lanes__lane"
              role="group"
              aria-label={rows}
            >
              <div className="packet-lanes__signal ci-field__hint">{rows}</div>
              <div
                className="packet-lanes__track"
                data-testid={`lane-${beat.section}-${lane.signal}${lsb ? `-${lsb}` : ''}`}
              >
                {lane.segments.map((s) => {
                  const range = bitRange(s.msb, s.lsb);
                  const part = s.partial ? `, bits ${range} in this row` : '';
                  return (
                    <div
                      key={`${s.path}:${s.lsb}`}
                      className="packet-lanes__segment"
                      // Focusable so the full text is reachable by keyboard when the segment is too narrow to show it.
                      tabIndex={0}
                      title={`${s.label}${s.type ? ` · ${s.type}` : ''}${part}`}
                      aria-label={`${s.label}${s.type ? `, ${s.type}` : ''}${part}`}
                      style={
                        {
                          left: `${s.leftPct}%`,
                          width: `${s.widthPct}%`,
                          '--packet-seg-color': COLORS[s.colorIndex % PALETTE_SIZE],
                        } as React.CSSProperties
                      }
                    >
                      <span className="packet-lanes__name">{s.name}</span>
                      <span className="packet-lanes__range"> {range}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    ))}
  </div>
);
