import { checkPackApiVersion, CONTRACT_VERSION } from '../../../generator/contract';
import type { ScaffoldPack } from '../../../generator/types';

function makePack(apiVersion?: string): ScaffoldPack {
  return { name: 'test-pack', packDir: '/tmp/test-pack', files: [], apiVersion };
}

describe('checkPackApiVersion', () => {
  it('passes when apiVersion is absent', () => {
    expect(() => checkPackApiVersion(makePack())).not.toThrow();
  });

  it('passes when contract version satisfies caret range', () => {
    expect(() => checkPackApiVersion(makePack('^1.0'))).not.toThrow();
  });

  it('passes when contract version satisfies tilde range', () => {
    expect(() => checkPackApiVersion(makePack('~1.1'))).not.toThrow();
  });

  it('passes for exact match', () => {
    expect(() => checkPackApiVersion(makePack(CONTRACT_VERSION))).not.toThrow();
  });

  it('throws when major version is incompatible', () => {
    expect(() => checkPackApiVersion(makePack('^2.0'))).toThrow(
      /targets apiVersion '\^2\.0' but this IPCraft provides contract 1\.1\.0/
    );
  });

  it('throws when minor floor exceeds contract minor', () => {
    expect(() => checkPackApiVersion(makePack('^1.2'))).toThrow(/apiVersion/);
  });

  it('includes pack name in error message', () => {
    const pack = makePack('^2.0');
    expect(() => checkPackApiVersion(pack)).toThrow(/test-pack/);
  });
});

describe('satisfiesRange edge cases', () => {
  it('1.1.0 satisfies ^1.0.0', () => {
    const pack = makePack('^1.0.0');
    expect(() => checkPackApiVersion(pack)).not.toThrow();
  });

  it('1.1.0 does not satisfy ^1.1.1 (patch floor not met)', () => {
    expect(() => checkPackApiVersion(makePack('^1.1.1'))).toThrow(/apiVersion/);
  });

  it('1.1.0 does not satisfy ~1.0 (minor mismatch for tilde)', () => {
    expect(() => checkPackApiVersion(makePack('~1.0'))).toThrow(/apiVersion/);
  });

  it('1.1.0 satisfies ~1.1', () => {
    expect(() => checkPackApiVersion(makePack('~1.1'))).not.toThrow();
  });
});
