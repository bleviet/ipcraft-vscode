import type { SystemPin } from '../../../domain/systemGraph';
import type { ValueChange } from '../../../domain/systemGraphDiff';
import { diffValues } from './valueChanges';

/** The declared attributes compared for external ports and hierarchy pins; the pin's parameters follow them. */
export const FIXED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'direction',
  'signalType',
  'vlnv',
  'interfaceType',
  'width',
]);

function fixedAttributes(
  pin: SystemPin | undefined,
  withDirection: boolean
): Record<string, string | undefined> {
  return {
    direction: withDirection ? pin?.direction : undefined,
    signalType: pin?.signalType,
    vlnv: pin?.vlnv,
    interfaceType: pin?.interfaceType,
    width: pin?.width && `${pin.width.from}:${pin.width.to}`,
  };
}

/** Attributes that differ (or exist on one side only), then differing parameters by key. */
export function diffPinAttributes(
  base: SystemPin | undefined,
  current: SystemPin | undefined
): ValueChange[] {
  // A direction that a reader inferred from the connections is not a property of the pin,
  // so it is compared only when both revisions declare it.
  const declared = (pin: SystemPin | undefined) => pin?.directionSource === 'declared';
  const withDirection =
    base && current ? declared(base) && declared(current) : declared(base ?? current);
  return [
    ...diffValues(fixedAttributes(base, withDirection), fixedAttributes(current, withDirection)),
    ...diffValues(base?.parameters ?? {}, current?.parameters ?? {}),
  ];
}
