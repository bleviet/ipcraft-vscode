/**
 * CRCs over the version bytes, for the `$version.crc8` / `$version.crc16` references: a driver
 * recomputes the CRC over the bytes of the version it reads to check the version register.
 *
 * Pure and dependency free (a leaf: `versionScheme.ts` builds the version bytes and imports this):
 * shared by the extension host, the generator and the webview.
 */

/** CRC-8/I-432-1: poly 0x07, init 0x00, no reflection, xorout 0x55 (check "123456789" = 0xA1). */
export function crc8(bytes: readonly number[]): number {
  let crc = 0x00;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc ^ 0x55;
}

/** CRC-16/IBM-3740 (CCITT-FALSE): poly 0x1021, init 0xFFFF, no reflection, xorout 0 (check 0x29B1). */
export function crc16(bytes: readonly number[]): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** UTF-8 encoding that works in every bundle (no TextEncoder dependency). */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}
