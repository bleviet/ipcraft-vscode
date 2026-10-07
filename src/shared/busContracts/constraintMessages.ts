import type { NormalizedBusConstraint } from './types';

function subjectOf(constraint: { port?: string; property?: string }): string {
  return constraint.port !== undefined
    ? `${constraint.port} width`
    : `interface property '${constraint.property}'`;
}

function ruleText(constraint: NormalizedBusConstraint, verb: string): string {
  switch (constraint.kind) {
    case 'range': {
      const subject = subjectOf(constraint);
      const { minimum, maximum } = constraint;
      if (minimum !== undefined && maximum !== undefined) {
        return `${subject} ${verb} be between ${minimum} and ${maximum}`;
      }
      return minimum !== undefined
        ? `${subject} ${verb} be at least ${minimum}`
        : `${subject} ${verb} be at most ${maximum}`;
    }
    case 'allowedValues':
      return `${subjectOf(constraint)} ${verb} be one of ${constraint.values.join(', ')}`;
    case 'multipleOf':
      return `${subjectOf(constraint)} ${verb} be a multiple of ${constraint.value}`;
    case 'powerOfTwo': {
      const { minimum, maximum } = constraint;
      let bounds = '';
      if (minimum !== undefined && maximum !== undefined) {
        bounds = ` from ${minimum} to ${maximum}`;
      } else if (minimum !== undefined) {
        bounds = ` of at least ${minimum}`;
      } else if (maximum !== undefined) {
        bounds = ` of at most ${maximum}`;
      }
      return `${subjectOf(constraint)} ${verb} be a power of two${bounds}`;
    }
    case 'portWidthsEqual':
      return `ports ${constraint.ports.join(', ')} ${verb} have the same width`;
    case 'portWidthQuotient':
      return `${constraint.port} width ${verb} equal ${constraint.dividendPort} width / ${constraint.divisor}`;
    case 'productEqualsPort':
      return `${constraint.port} width ${verb} equal ${constraint.properties.join(' * ')}`;
    case 'portPresenceRequires':
      return `port ${constraint.port} ${verb} be accompanied by ${constraint.requires.join(', ')}`;
    case 'propertyRequiredWhenPortPresent':
      return `interface property '${constraint.property}' ${verb} be set when port ${constraint.port} is present`;
    case 'propertyFitsPort':
      return `interface property '${constraint.property}' ${verb} fit in the ${constraint.port} port width`;
  }
}

/** Human-readable text for a constraint that does not declare its own `message`. */
export function describeConstraint(
  constraint: NormalizedBusConstraint,
  interfaceName: string,
  detail?: string
): string {
  const isWarning = constraint.severity === 'warning';
  const rule = ruleText(constraint, isWarning ? 'should' : 'must');
  const suffix = isWarning ? ' This is a recommendation; generation is not blocked.' : '';
  return `Interface '${interfaceName}': ${rule}${detail ? ` (${detail})` : ''}.${suffix}`;
}
