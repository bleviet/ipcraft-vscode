import type { SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import type { InstanceChange } from '../../../domain/systemGraphDiff';
import { connectedPins, diffInsidePins, diffPins, type PinContext } from './diffPins';
import { compareText } from './compareText';
import { diffPinAttributes } from './pinAttributes';
import { diffValues } from './valueChanges';

/** The type as shown to the user: VLNV, Platform Designer `kind:version`, module reference, or the instance kind. */
function instanceType(instance: SystemInstance): string {
  if (instance.kind === 'hier') {
    return 'Hierarchy';
  }
  if (instance.vlnv) {
    return instance.vlnv;
  }
  if (instance.component) {
    return instance.version ? `${instance.component}:${instance.version}` : instance.component;
  }
  return instance.moduleRef ?? instance.kind;
}

/** Whether the types of two instances of the same kind differ in the version only. */
function differInVersionOnly(base: SystemInstance, current: SystemInstance): boolean {
  if (base.vlnv !== undefined && current.vlnv !== undefined) {
    const [b, c] = [base.vlnv.split(':'), current.vlnv.split(':')];
    return b.length === 4 && c.length === 4 && b.slice(0, 3).join(':') === c.slice(0, 3).join(':');
  }
  return (
    base.vlnv === undefined &&
    current.vlnv === undefined &&
    base.component !== undefined &&
    base.component === current.component
  );
}

function wholeInstance(
  status: 'added' | 'removed',
  instance: SystemInstance,
  ctx: PinContext
): InstanceChange {
  return {
    path: instance.path,
    level: instance.parent,
    status,
    ...(status === 'added'
      ? { currentType: instanceType(instance) }
      : { baseType: instanceType(instance) }),
    parameters:
      status === 'added'
        ? diffValues({}, instance.parameters)
        : diffValues(instance.parameters, {}),
    pins: connectedPins(
      status === 'added' ? ctx.current : ctx.base,
      status,
      instance.path,
      instance.pins.map((p) => p.name)
    ),
  };
}

/** Hierarchy pins have declared attributes, compared like those of external ports. */
function hierPinAttributes(base: SystemInstance, current: SystemInstance) {
  const [b, c] = [pinsByName(base), pinsByName(current)];
  return (pin: string) => diffPinAttributes(b.get(pin), c.get(pin));
}

const pinsByName = (instance: SystemInstance) => new Map(instance.pins.map((p) => [p.name, p]));

function changedInstance(
  base: SystemInstance,
  current: SystemInstance,
  ctx: PinContext
): InstanceChange | undefined {
  const [baseType, currentType] = [instanceType(base), instanceType(current)];
  const parameters = diffValues(base.parameters, current.parameters);
  const names = (instance: SystemInstance) => instance.pins.map((p) => p.name);
  const insideNames = (instance: SystemInstance) =>
    instance.kind === 'hier' ? names(instance) : [];
  const pins = [
    ...diffPins(
      ctx,
      current.path,
      names(base),
      names(current),
      base.kind === 'hier' && current.kind === 'hier' ? hierPinAttributes(base, current) : undefined
    ),
    ...diffInsidePins(ctx, current.path, insideNames(base), insideNames(current)),
  ].sort(
    (x, y) => compareText(x.pin, y.pin) || Number(x.inside === true) - Number(y.inside === true)
  );
  const typeDiffers = baseType !== currentType;
  const versionOnly =
    typeDiffers && base.kind === current.kind && differInVersionOnly(base, current);
  const changed =
    base.kind !== current.kind ||
    (typeDiffers && !versionOnly) ||
    parameters.length > 0 ||
    pins.length > 0;
  if (!changed && !versionOnly) {
    return undefined;
  }
  return {
    path: current.path,
    level: current.parent,
    status: changed ? 'changed' : 'version',
    baseType,
    currentType,
    parameters,
    pins,
  };
}

/** Instance changes between two graphs, sorted by path. */
export function diffInstances(
  base: SystemGraph,
  current: SystemGraph,
  ctx: PinContext
): InstanceChange[] {
  const changes: InstanceChange[] = [];
  for (const path of new Set([...Object.keys(base.instances), ...Object.keys(current.instances)])) {
    const [b, c] = [base.instances[path], current.instances[path]];
    const change =
      b && c ? changedInstance(b, c, ctx) : wholeInstance(c ? 'added' : 'removed', c ?? b, ctx);
    if (change) {
      changes.push(change);
    }
  }
  return changes.sort((x, y) => compareText(x.path, y.path));
}
