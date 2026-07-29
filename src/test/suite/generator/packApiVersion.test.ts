import { checkPackApiVersion, CONTRACT_VERSION } from '../../../generator/contract';
import type { ScaffoldPack } from '../../../generator/types';

function makePack(apiVersion?: string): ScaffoldPack {
  return { name: 'test-pack', packDir: '/tmp/test-pack', files: [], apiVersion };
}

// Ranges are derived from CONTRACT_VERSION rather than hard-coded, so a contract
// bump exercises the same semantics instead of failing these tests.
const [MAJOR, MINOR, PATCH] = CONTRACT_VERSION.split('.').map(Number);

describe('checkPackApiVersion', () => {
  it('passes when apiVersion is absent', () => {
    expect(() => checkPackApiVersion(makePack())).not.toThrow();
  });

  it('passes when contract version satisfies caret range', () => {
    expect(() => checkPackApiVersion(makePack(`^${MAJOR}.0`))).not.toThrow();
  });

  it('passes when contract version satisfies tilde range', () => {
    expect(() => checkPackApiVersion(makePack(`~${MAJOR}.${MINOR}`))).not.toThrow();
  });

  it('passes for exact match', () => {
    expect(() => checkPackApiVersion(makePack(CONTRACT_VERSION))).not.toThrow();
  });

  it('throws when major version is incompatible', () => {
    const range = `^${MAJOR + 1}.0`;
    expect(() => checkPackApiVersion(makePack(range))).toThrow(
      new RegExp(
        `targets apiVersion '\\^${MAJOR + 1}\\.0' but this IPCraft provides contract ` +
          CONTRACT_VERSION.replace(/\./g, '\\.')
      )
    );
  });

  it('throws when minor floor exceeds contract minor', () => {
    expect(() => checkPackApiVersion(makePack(`^${MAJOR}.${MINOR + 1}`))).toThrow(/apiVersion/);
  });

  it('includes pack name in error message', () => {
    const pack = makePack(`^${MAJOR + 1}.0`);
    expect(() => checkPackApiVersion(pack)).toThrow(/test-pack/);
  });
});

describe('satisfiesRange edge cases', () => {
  it('satisfies a caret range at the major floor', () => {
    expect(() => checkPackApiVersion(makePack(`^${MAJOR}.0.0`))).not.toThrow();
  });

  it('does not satisfy a caret range whose patch floor is not met', () => {
    expect(() => checkPackApiVersion(makePack(`^${MAJOR}.${MINOR}.${PATCH + 1}`))).toThrow(
      /apiVersion/
    );
  });

  it('does not satisfy a tilde range with a mismatched minor', () => {
    expect(() => checkPackApiVersion(makePack(`~${MAJOR}.${MINOR + 1}`))).toThrow(/apiVersion/);
  });

  it('satisfies a tilde range on the matching minor', () => {
    expect(() => checkPackApiVersion(makePack(`~${MAJOR}.${MINOR}`))).not.toThrow();
  });
});
