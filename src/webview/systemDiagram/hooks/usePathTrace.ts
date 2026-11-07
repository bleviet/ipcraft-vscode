import { useEffect, useMemo, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { nodeName, traceEndpoints, traceNote, type PathTrace } from '../pathTrace';

interface TraceBarState {
  levelPath: string;
  from: string;
  to: string;
  /** The search for a path between `from` and `to` found one. */
  found: boolean;
}

interface PathTraceView {
  /** Isolates the path between two nodes; returns whether there was one (otherwise the view stays). */
  trace: (from: string, to: string) => boolean;
  endTrace: () => void;
  /** The traced path on show, if any. */
  shownTrace?: PathTrace & { from: string; to: string };
}

/**
 * The trace bar: whether it is open and its From / To choices, on the level it
 * was opened on (leaving the level closes it). Choosing both ends runs the
 * trace through `view`; `onTraceStart` fires when a path was found. The status
 * describes what is on screen.
 */
export function usePathTrace(
  graph: SystemGraph,
  levelPath: string,
  view: PathTraceView,
  onTraceStart: () => void
) {
  const [state, setState] = useState<TraceBarState | null>(null);
  useEffect(() => setState(null), [levelPath]);
  const bar = state?.levelPath === levelPath ? state : null;
  const from = bar?.from ?? '';
  const to = bar?.to ?? '';
  const endpoints = useMemo(() => traceEndpoints(graph, levelPath), [graph, levelPath]);

  const choose = (next: { from: string; to: string }) => {
    const both = next.from !== '' && next.to !== '';
    const found = both && view.trace(next.from, next.to);
    setState({ levelPath, ...next, found });
    if (found) {
      onTraceStart();
    }
  };
  const close = () => {
    setState(null);
    view.endTrace();
  };
  const shown = view.shownTrace;
  const noPath = bar !== null && from !== '' && to !== '' && !bar.found;
  let status = '';
  if (from === '' || to === '') {
    status = 'Choose a From and a To';
  } else if (noPath) {
    status = `No path from ${nodeName(graph, from)} to ${nodeName(graph, to)}`;
  } else if (shown?.from === from && shown.to === to) {
    status = traceNote(shown);
  }

  return {
    open: bar !== null,
    from,
    to,
    status,
    noPath,
    endpoints,
    setFrom: (id: string) => choose({ from: id, to }),
    setTo: (id: string) => choose({ from, to: id }),
    swap: () => choose({ from: to, to: from }),
    toggle: () => (bar ? close() : setState({ levelPath, from: '', to: '', found: false })),
    close,
  };
}
