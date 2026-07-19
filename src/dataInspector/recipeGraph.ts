import type { IPCraftDataInspectorRecipe, Step } from '../domain/dataInspector.types';

export type RecipeGraphNode =
  | { id: string; kind: 'source' }
  | { id: string; kind: 'step'; step: Step };

export type RecipeGraphEdge = {
  id: string;
  source: string;
  target: string;
  targetHandle: 'input' | 'operand';
};

export interface RecipeGraph {
  nodes: RecipeGraphNode[];
  edges: RecipeGraphEdge[];
}

export type GraphEdit =
  | {
      type: 'connect';
      sourceId: string;
      targetId: string;
      targetHandle: RecipeGraphEdge['targetHandle'];
    }
  | { type: 'addSteps'; steps: Step[] }
  | { type: 'deleteSteps'; stepIds: string[] }
  | { type: 'deleteNodes'; nodeIds: string[] };

export function recipeToGraph(recipe: IPCraftDataInspectorRecipe): RecipeGraph {
  const nodes: RecipeGraphNode[] = [
    ...recipe.sources.map((source) => ({ id: source.id, kind: 'source' as const })),
    ...recipe.steps.map((step) => ({ id: step.id, kind: 'step' as const, step })),
  ];
  const valueIds = new Set([
    ...recipe.sources.map((source) => source.id),
    ...recipe.steps.map((step) => step.id),
  ]);
  const edges: RecipeGraphEdge[] = [];

  for (const step of recipe.steps) {
    if (valueIds.has(step.inputId)) {
      edges.push({
        id: `${step.id}.input`,
        source: step.inputId,
        target: step.id,
        targetHandle: 'input',
      });
    }
    if (step.operandId !== undefined && valueIds.has(step.operandId)) {
      edges.push({
        id: `${step.id}.operand`,
        source: step.operandId,
        target: step.id,
        targetHandle: 'operand',
      });
    }
  }
  return { nodes, edges };
}

function stepDependencies(step: Step, stepIds: ReadonlySet<string>): string[] {
  return [step.inputId, step.operandId].filter(
    (id): id is string => id !== undefined && stepIds.has(id)
  );
}

export function stableTopologicalSteps(steps: readonly Step[]): Step[] {
  const stepIds = new Set(steps.map((step) => step.id));
  const byId = new Map(steps.map((step) => [step.id, step]));
  const indegree = new Map(steps.map((step) => [step.id, 0]));
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    for (const dependency of stepDependencies(step, stepIds)) {
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id]);
    }
  }

  const ready = steps.filter((step) => indegree.get(step.id) === 0).map((step) => step.id);
  const sorted: Step[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    sorted.push(byId.get(id)!);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        const previousIndex = steps.findIndex((step) => step.id === dependent);
        const insertAt = ready.findIndex(
          (readyId) => steps.findIndex((step) => step.id === readyId) > previousIndex
        );
        ready.splice(insertAt === -1 ? ready.length : insertAt, 0, dependent);
      }
    }
  }

  if (sorted.length !== steps.length) {
    throw new Error('This connection would create a cycle');
  }
  return sorted;
}

export function wouldCreateCycle(
  recipe: IPCraftDataInspectorRecipe,
  sourceId: string,
  targetId: string
): boolean {
  if (sourceId === targetId) {
    return true;
  }
  const stepIds = new Set(recipe.steps.map((step) => step.id));
  if (!stepIds.has(sourceId) || !stepIds.has(targetId)) {
    return false;
  }
  const dependents = new Map<string, string[]>();
  for (const step of recipe.steps) {
    for (const dependency of stepDependencies(step, stepIds)) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id]);
    }
  }

  const pending = [targetId];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === sourceId) {
      return true;
    }
    if (!seen.has(id)) {
      seen.add(id);
      pending.push(...(dependents.get(id) ?? []));
    }
  }
  return false;
}

function connect(
  recipe: IPCraftDataInspectorRecipe,
  edit: Extract<GraphEdit, { type: 'connect' }>
): IPCraftDataInspectorRecipe {
  const valueIds = new Set([
    ...recipe.sources.map((source) => source.id),
    ...recipe.steps.map((step) => step.id),
  ]);
  if (!valueIds.has(edit.sourceId)) {
    throw new Error(`Unknown value ${edit.sourceId}`);
  }
  if (wouldCreateCycle(recipe, edit.sourceId, edit.targetId)) {
    throw new Error('This connection would create a cycle');
  }

  const target = recipe.steps.find((step) => step.id === edit.targetId);
  if (!target) {
    throw new Error(`Unknown step ${edit.targetId}`);
  }
  const steps = recipe.steps.map((step) => {
    if (step.id !== edit.targetId) {
      return step;
    }
    return edit.targetHandle === 'input'
      ? { ...step, inputId: edit.sourceId }
      : { ...step, operandId: edit.sourceId };
  });
  return { ...recipe, steps: stableTopologicalSteps(steps) };
}

function deleteNodes(
  recipe: IPCraftDataInspectorRecipe,
  nodeIds: readonly string[]
): IPCraftDataInspectorRecipe {
  const selected = new Set(nodeIds);
  const selectedSourceIds = new Set(
    recipe.sources.filter((source) => selected.has(source.id)).map((source) => source.id)
  );
  const selectedStepIds = new Set(
    recipe.steps.filter((step) => selected.has(step.id)).map((step) => step.id)
  );
  if (selectedSourceIds.size === recipe.sources.length && selectedSourceIds.size > 0) {
    throw new Error('A recipe must keep at least one input');
  }
  const sources = recipe.sources.filter((source) => !selectedSourceIds.has(source.id));
  const steps = recipe.steps.filter((step) => !selectedStepIds.has(step.id));
  const existingNodeIds = new Set([
    ...sources.map((source) => source.id),
    ...steps.map((step) => step.id),
  ]);
  return {
    ...recipe,
    sources,
    steps,
    fields: recipe.fields.filter((field) => !selectedSourceIds.has(field.sourceId)),
    view: {
      ...recipe.view,
      ...(recipe.view.canvas
        ? {
            canvas: {
              nodes: recipe.view.canvas.nodes.filter((position) =>
                existingNodeIds.has(position.id)
              ),
            },
          }
        : {}),
    },
  };
}

export function applyGraphEdit(
  recipe: IPCraftDataInspectorRecipe,
  edit: GraphEdit
): IPCraftDataInspectorRecipe {
  if (edit.type === 'connect') {
    return connect(recipe, edit);
  }
  if (edit.type === 'deleteSteps') {
    return deleteNodes(recipe, edit.stepIds);
  }
  if (edit.type === 'deleteNodes') {
    return deleteNodes(recipe, edit.nodeIds);
  }
  const existingIds = new Set([
    ...recipe.sources.map((source) => source.id),
    ...recipe.steps.map((step) => step.id),
  ]);
  const duplicate = edit.steps.find((step) => existingIds.has(step.id));
  if (duplicate) {
    throw new Error(`Duplicate stable ID ${duplicate.id}`);
  }
  return { ...recipe, steps: stableTopologicalSteps([...recipe.steps, ...edit.steps]) };
}
