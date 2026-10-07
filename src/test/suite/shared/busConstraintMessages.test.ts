import { describeConstraint } from '../../../shared/busContracts/constraintMessages';
import type { NormalizedBusConstraint } from '../../../shared/busContracts/types';

const base = { ruleId: 'R', code: 'C', severity: 'error' } as const;
const warn = { ...base, severity: 'warning' } as const;
const WARN_SUFFIX = ' This is a recommendation; generation is not blocked.';

describe('describeConstraint', () => {
  const cases: [string, NormalizedBusConstraint, string][] = [
    [
      'range both',
      { ...base, kind: 'range', port: 'A', minimum: 1, maximum: 4 },
      "Interface 'i': A width must be between 1 and 4.",
    ],
    [
      'range min',
      { ...base, kind: 'range', port: 'A', minimum: 1 },
      "Interface 'i': A width must be at least 1.",
    ],
    [
      'range max',
      { ...base, kind: 'range', property: 'p', maximum: 4 },
      "Interface 'i': interface property 'p' must be at most 4.",
    ],
    [
      'allowedValues',
      { ...base, kind: 'allowedValues', property: 'p', values: [1, 'x', true] },
      "Interface 'i': interface property 'p' must be one of 1, x, true.",
    ],
    [
      'multipleOf',
      { ...base, kind: 'multipleOf', port: 'A', value: 8 },
      "Interface 'i': A width must be a multiple of 8.",
    ],
    [
      'powerOfTwo plain',
      { ...base, kind: 'powerOfTwo', port: 'A' },
      "Interface 'i': A width must be a power of two.",
    ],
    [
      'powerOfTwo range',
      { ...base, kind: 'powerOfTwo', port: 'A', minimum: 8, maximum: 64 },
      "Interface 'i': A width must be a power of two from 8 to 64.",
    ],
    [
      'powerOfTwo min',
      { ...base, kind: 'powerOfTwo', port: 'A', minimum: 8 },
      "Interface 'i': A width must be a power of two of at least 8.",
    ],
    [
      'powerOfTwo max',
      { ...base, kind: 'powerOfTwo', port: 'A', maximum: 64 },
      "Interface 'i': A width must be a power of two of at most 64.",
    ],
    [
      'portWidthsEqual',
      { ...base, kind: 'portWidthsEqual', ports: ['A', 'B', 'C'] },
      "Interface 'i': ports A, B, C must have the same width.",
    ],
    [
      'portWidthQuotient',
      { ...base, kind: 'portWidthQuotient', port: 'S', dividendPort: 'D', divisor: 8 },
      "Interface 'i': S width must equal D width / 8.",
    ],
    [
      'productEqualsPort',
      { ...base, kind: 'productEqualsPort', port: 'P', properties: ['x', 'y'] },
      "Interface 'i': P width must equal x * y.",
    ],
    [
      'portPresenceRequires',
      { ...base, kind: 'portPresenceRequires', port: 'P', requires: ['A', 'B'] },
      "Interface 'i': port P must be accompanied by A, B.",
    ],
    [
      'propertyRequiredWhenPortPresent',
      { ...base, kind: 'propertyRequiredWhenPortPresent', port: 'P', property: 'p' },
      "Interface 'i': interface property 'p' must be set when port P is present.",
    ],
    [
      'propertyFitsPort',
      { ...base, kind: 'propertyFitsPort', port: 'P', property: 'p' },
      "Interface 'i': interface property 'p' must fit in the P port width.",
    ],
  ];

  it.each(cases)('describes %s', (_name, constraint, expected) => {
    expect(describeConstraint(constraint, 'i')).toBe(expected);
  });

  it('uses should and a recommendation note for warnings', () => {
    const text = describeConstraint({ ...warn, kind: 'multipleOf', port: 'A', value: 8 }, 'i');
    expect(text).toBe(`Interface 'i': A width should be a multiple of 8.${WARN_SUFFIX}`);
  });

  it('appends detail in parentheses', () => {
    const text = describeConstraint(
      { ...warn, kind: 'powerOfTwo', port: 'TDATA', minimum: 8, maximum: 1024 },
      's_axis',
      'currently 112'
    );
    expect(text).toBe(
      `Interface 's_axis': TDATA width should be a power of two from 8 to 1024 (currently 112).${WARN_SUFFIX}`
    );
  });
});
