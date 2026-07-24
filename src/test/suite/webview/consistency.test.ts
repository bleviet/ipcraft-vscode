import {
  formatFindingsForClipboard,
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

describe('formatFindingsForClipboard', () => {
  // issue #161: the ambiguous count must be visible and distinct from "changed" in the
  // copy-to-clipboard summary line, matching the extension-side output channel.
  it('includes the ambiguous count in the summary line', () => {
    const text = formatFindingsForClipboard(
      [finding({ kind: 'top-level-ambiguity', severity: 'amber' })],
      { added: 0, removed: 0, changed: 0, ambiguous: 1 }
    );
    expect(text).toContain('1 ambiguous');
    expect(text).not.toContain('1 changed');
  });
});
