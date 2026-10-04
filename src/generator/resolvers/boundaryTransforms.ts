import type { BoundaryTransformPort, ProjectedBusPort } from '../types';

export function buildBoundaryTransforms(
  ports: readonly ProjectedBusPort[],
  reservedNames: ReadonlySet<string>
): {
  ports: readonly BoundaryTransformPort[];
  internalNames: ReadonlySet<string>;
} {
  const allocatedNames = new Set<string>();
  const unavailableNames = new Set([...reservedNames].map((name) => name.toLowerCase()));
  const transforms: BoundaryTransformPort[] = [];

  for (const port of ports) {
    if (!port.needsSwap && !port.needsPolarityInversion) {
      continue;
    }

    const baseName = `${port.name}_${port.needsSwap ? 'be' : 'inv'}`;
    let internalName = baseName;
    let suffix = 2;
    while (unavailableNames.has(internalName.toLowerCase())) {
      internalName = `${baseName}_${suffix}`;
      suffix += 1;
    }

    unavailableNames.add(internalName.toLowerCase());
    allocatedNames.add(internalName);
    transforms.push({
      name: port.name,
      internalName,
      direction: port.direction,
      type: port.type,
      svType: port.svType,
      width: port.width,
      widthExpr: port.widthExpr,
      isParameterized: port.isParameterized,
      invert: port.needsPolarityInversion,
      ...(port.needsSwap && port.swapKind ? { swapKind: port.swapKind } : {}),
      ...(port.needsSwap && port.laneWidth !== undefined ? { laneWidth: port.laneWidth } : {}),
      ...(port.needsSwap && port.laneKind ? { laneKind: port.laneKind } : {}),
    });
  }

  return { ports: transforms, internalNames: allocatedNames };
}
