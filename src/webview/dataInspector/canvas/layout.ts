import type { CanvasNodePosition } from '../../../domain/dataInspector.types';
import type { RecipeGraph } from '../../../dataInspector/recipeGraph';

const COLUMN_GAP = 280;
const ROW_GAP = 164;
const ORIGIN_X = 36;
const ORIGIN_Y = 36;

export function layoutRecipeGraph(graph: RecipeGraph): CanvasNodePosition[] {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const ranks = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === 'source') {
      ranks.set(node.id, 0);
    }
  }
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    for (const node of graph.nodes) {
      if (node.kind === 'source') {
        continue;
      }
      const parentRanks = (incoming.get(node.id) ?? [])
        .map((id) => ranks.get(id))
        .filter((rank): rank is number => rank !== undefined);
      if (parentRanks.length > 0) {
        ranks.set(node.id, Math.max(...parentRanks) + 1);
      }
    }
  }

  const layerCounts = new Map<number, number>();
  return graph.nodes.map((node) => {
    const rank = ranks.get(node.id) ?? 1;
    const row = layerCounts.get(rank) ?? 0;
    layerCounts.set(rank, row + 1);
    return {
      id: node.id,
      x: ORIGIN_X + rank * COLUMN_GAP,
      y: ORIGIN_Y + row * ROW_GAP,
    };
  });
}

export function resolveCanvasPositions(
  graph: RecipeGraph,
  saved: readonly CanvasNodePosition[] | undefined
): CanvasNodePosition[] {
  const automatic = layoutRecipeGraph(graph);
  const validIds = new Set(graph.nodes.map((node) => node.id));
  const savedById = new Map(
    (saved ?? [])
      .filter((position) => validIds.has(position.id))
      .map((position) => [position.id, position])
  );
  return automatic.map((position) => savedById.get(position.id) ?? position);
}
