import type { AddressSegment, SystemGraph } from '../../domain/systemGraph';

export interface LevelSource {
  fileName: string;
  /** Absent for the graph's own document. */
  uri?: string;
}

/** The file a level's line numbers refer to. */
export function levelSource(graph: SystemGraph, level: string): LevelSource {
  return graph.levels[level]?.source ?? { fileName: graph.source.fileName };
}

/** The level whose file an address segment's line refers to: the master instance's parent. */
export function segmentLevel(graph: SystemGraph, segment: AddressSegment): string {
  return graph.instances[segment.masterInstance]?.parent ?? '/';
}
