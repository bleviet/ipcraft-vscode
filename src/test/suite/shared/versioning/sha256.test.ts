import { createHash } from 'crypto';
import { sha256Hex } from '../../../../shared/versioning/sha256';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the FIPS 180-4 vector for %p', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('matches Node crypto for multi-byte UTF-8 text', () => {
    const text = 'Registersatz \u00e4\u00f6\u00fc \u00df \u20ac \u4e2d\u6587 \ud83d\ude80 end';
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });

  it('matches Node crypto across the padding boundaries', () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('matches Node crypto for a long input (one million a)', () => {
    const text = 'a'.repeat(1_000_000);
    expect(sha256Hex(text)).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    );
  });

  it('returns 64 lowercase hex digits', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
