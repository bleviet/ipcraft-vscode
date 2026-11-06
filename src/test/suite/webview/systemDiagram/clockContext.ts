import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { ClockContext } from '../../../../webview/systemDiagram/clockDecor';

/** The canvas clock props of `graph` at `levelPath`, with the Clock domains mode off unless asked for. */
export function clockContextOf(
  graph: SystemGraph,
  domainMode = false,
  levelPath = '/'
): ClockContext {
  return { graph, analysis: analyzeClocks(graph), levelPath, domainMode };
}
