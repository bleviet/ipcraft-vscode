import {
  isAmbiguousFinding,
  type ConsistencyFinding,
} from '../../../webview/ipcore/types/consistency';

function finding(overrides: Partial<ConsistencyFinding> = {}): ConsistencyFinding {
  return {
    kind: 'missing-port',
    message: 'test',
    ipYmlPath: ['ports', 0],
    hdlFile: 'rtl/core.sv',
    hdlEntity: 'core',
    severity: 'red',
    source: 'hdl',
    ...overrides,
  };
}

describe('isAmbiguousFinding', () => {
  it('is true only for top-level-ambiguity', () => {
    expect(isAmbiguousFinding(finding({ kind: 'top-level-ambiguity', severity: 'amber' }))).toBe(
      true
    );
    expect(isAmbiguousFinding(finding({ kind: 'missing-port' }))).toBe(false);
  });
});
