import { useCallback, useEffect, useRef } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { levelOf } from '../model';

/**
 * Up and forward through hierarchy levels, for the mouse back and forward
 * buttons. `up` goes to the parent level and remembers the level it left;
 * `forward` returns to the last level `up` left, one step at a time. Like a
 * browser, any other change of level (breadcrumb, entering a block, an outline
 * or search jump, a level that vanished from the design) clears what `forward`
 * can return to. `forward` skips levels an edit removed since `up` left them.
 */
export function useLevelHistory(
  graph: SystemGraph,
  levelPath: string,
  navigate: (path: string) => void
) {
  const forwardStack = useRef<string[]>([]);
  // The level `up` or `forward` went to; any other level is a new navigation.
  const expectedLevel = useRef(levelPath);

  useEffect(() => {
    if (levelPath !== expectedLevel.current) {
      forwardStack.current = [];
      expectedLevel.current = levelPath;
    }
  }, [levelPath]);

  const up = useCallback(() => {
    if (levelPath === '/') {
      return;
    }
    forwardStack.current.push(levelPath);
    expectedLevel.current = levelOf(levelPath);
    navigate(expectedLevel.current);
  }, [levelPath, navigate]);

  const forward = useCallback(() => {
    let next = forwardStack.current.pop();
    while (next !== undefined && !graph.levels[next]) {
      next = forwardStack.current.pop();
    }
    if (next === undefined) {
      return;
    }
    expectedLevel.current = next;
    navigate(next);
  }, [graph, navigate]);

  return { up, forward };
}
