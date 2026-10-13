import {
  formatResolvedHex,
  unknownVersionRefError,
  versionRefHint,
} from '../../../webview/shared/utils/versionRefDisplay';
import type { VersionContext } from '../../../shared/versioning/versionContext';

const resolved: VersionContext = {
  status: 'resolved',
  versionScheme: 'major.minor.patch',
  version: '1.4.2',
};

describe('formatResolvedHex', () => {
  it('pads to the digits the width needs', () => {
    expect(formatResolvedHex(1, 8)).toBe('0x01');
    expect(formatResolvedHex(0x010402, 24)).toBe('0x010402');
    expect(formatResolvedHex(0xab, 16)).toBe('0x00AB');
  });
});

describe('unknownVersionRefError', () => {
  it('lists the references of a resolved scheme', () => {
    expect(unknownVersionRefError(resolved)).toBe(
      'Use $version, $version.major, $version.minor or $version.patch'
    );
    expect(unknownVersionRefError({ ...resolved, versionScheme: 'major.minor' })).toBe(
      'Use $version, $version.major or $version.minor'
    );
  });

  it('names the general form without a scheme', () => {
    const general = 'Unknown version reference. Use $version or $version.<component>';
    expect(unknownVersionRefError({ status: 'none' })).toBe(general);
    expect(
      unknownVersionRefError({ status: 'resolved', versionScheme: 'free', version: 'x' })
    ).toBe(general);
  });
});

describe('versionRefHint', () => {
  it('shows the resolved value padded to the field width', () => {
    expect(versionRefHint(resolved, '$version.major', 8)).toBe('= 0x01');
    expect(versionRefHint(resolved, '$version', 24)).toBe('= 0x010402');
  });

  it('says why there is no value', () => {
    expect(versionRefHint({ status: 'none' }, '$version', 8)).toBe('version unresolved');
    expect(versionRefHint({ status: 'ambiguous', candidates: ['a', 'b'] }, '$version', 8)).toBe(
      'several IP cores import this map'
    );
  });

  it('shows nothing for a reference the resolved scheme does not have', () => {
    expect(versionRefHint(resolved, '$version.feature', 8)).toBeNull();
  });
});
