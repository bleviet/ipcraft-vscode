import * as fs from 'fs';
import * as path from 'path';
import {
  IP_CORE_FORMAT_VERSION,
  IP_CORE_FORMAT_VERSIONS,
  readIpCoreFormatVersion,
} from '../../../shared/ipCoreFormat';

describe('readIpCoreFormatVersion', () => {
  it('treats an absent apiVersion as 1.0', () => {
    expect(readIpCoreFormatVersion({})).toEqual({ ok: true, version: '1.0' });
  });

  it.each(['1.0', '1.1'])('accepts supported version %s', (version) => {
    expect(readIpCoreFormatVersion({ apiVersion: version })).toEqual({ ok: true, version });
  });

  it('rejects a newer version, naming it and the supported maximum', () => {
    const result = readIpCoreFormatVersion({ apiVersion: '1.2' });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/apiVersion 1\.2.*up to 1\.1.*Upgrade IPCraft/),
    });
  });

  it.each([1.1, 1, 2])('asks for a quoted string when apiVersion is the number %s', (value) => {
    const result = readIpCoreFormatVersion({ apiVersion: value });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/must be a quoted string such as '1\.1'/),
    });
    expect((result as { message: string }).message).not.toMatch(/Upgrade IPCraft/);
  });
});

describe('pinned spec schema', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../../ipcraft-spec/schemas/ip_core.schema.json'),
      'utf-8'
    )
  ) as { properties: { apiVersion: { enum: string[] } } };
  const specVersions = schema.properties.apiVersion.enum;

  it('supports exactly the versions the schema enumerates', () => {
    expect([...IP_CORE_FORMAT_VERSIONS]).toEqual(specVersions);
  });

  it('pins the latest version to the last schema enum value', () => {
    expect(IP_CORE_FORMAT_VERSION).toBe(specVersions[specVersions.length - 1]);
  });
});
