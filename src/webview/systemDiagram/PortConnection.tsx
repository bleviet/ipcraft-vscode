/** Where a port of a hierarchy block is connected, through the levels above and below it. */

import React from 'react';
import type { SystemGraph, SystemPin } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { levelName } from './clocks/netTree';
import { ConnectionTree } from './ClockTreeDetails';
import { openNetsByEndpoint } from './layout/unionGraph';
import { endpointKey, type Selection } from './model';

export function PortConnection({
  graph,
  clocks,
  level,
  pin,
  removedNets,
  onSelect,
}: {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  level: string;
  pin: SystemPin;
  removedNets: ReadonlySet<string>;
  onSelect: (selection: Selection) => void;
}) {
  const physical = clocks.physicalOfPin(level, { instance: null, pin: pin.name });
  const parent = graph.instances[level]?.parent ?? '/';
  const outside = openNetsByEndpoint(graph, parent, removedNets).has(
    endpointKey({ instance: level, pin: pin.name })
  );
  return (
    <>
      {physical && (
        <ConnectionTree
          graph={graph}
          physical={physical}
          port={{ level, pin: pin.name }}
          ghostNets={removedNets}
          onSelect={onSelect}
        />
      )}
      {!outside && <p className="sd-note">Not connected in {levelName(graph, parent)}.</p>}
    </>
  );
}
