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
      'Use $version, $version.major, $version.minor, $version.patch, $version.crc8 or $version.crc16'
    );
    expect(unknownVersionRefError({ ...resolved, versionScheme: 'major.minor' })).toBe(
      'Use $version, $version.major, $version.minor, $version.crc8 or $version.crc16'
    );
  });

  it('names the general form without a scheme', () => {
    const general =
      'Unknown version reference. Use $version, $version.<component>, $version.crc8 or $version.crc16';
    expect(unknownVersionRefError({ status: 'none' })).toBe(general);
  });

  it('lists only the CRC references for a free version', () => {
    expect(
      unknownVersionRefError({ status: 'resolved', versionScheme: 'free', version: 'x' })
    ).toBe('Use $version.crc8 or $version.crc16');
  });
});

describe('versionRefHint', () => {
  it('shows the resolved value padded to the field width', () => {
    expect(versionRefHint(resolved, '$version.major', 8)).toBe('= 0x01');
    expect(versionRefHint(resolved, '$version', 24)).toBe('= 0x010402');
  });

  it('shows the resolved CRCs, also for a free version', () => {
    expect(versionRefHint(resolved, '$version.crc8', 8)).toBe('= 0x64');
    expect(versionRefHint(resolved, '$version.crc16', 16)).toBe('= 0x172A');
    expect(
      versionRefHint(
        { status: 'resolved', versionScheme: 'free', version: '1.0-rc1' },
        '$version.crc8',
        8
      )
    ).toBe('= 0xF0');
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
