/** WOFF 1.0 to sfnt (TrueType/OpenType) conversion, so one shipped font file serves both SVG embedding and rasterizing. Pure: the caller supplies zlib inflate. */

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const HEADER_BYTES = 44;
const TABLE_ENTRY_BYTES = 20;
const SFNT_HEADER_BYTES = 12;
const SFNT_ENTRY_BYTES = 16;
const HEAD_TAG = 0x68656164; // 'head'
const CHECKSUM_MAGIC = 0xb1b0afba;

/** Sum of the file's big-endian 32-bit words, modulo 2^32 (the length is a multiple of 4). */
function checksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + view.getUint32(i)) >>> 0;
  }
  return sum;
}

export type Inflate = (data: Uint8Array) => Uint8Array;

interface WoffTable {
  tag: number;
  offset: number;
  compLength: number;
  origLength: number;
  checksum: number;
}

/**
 * Rebuilds the sfnt file inside a WOFF 1.0 file: the table directory is rewritten with new offsets
 * (tables 4-byte aligned, zero padded), table data is inflated when stored compressed, and the
 * table checksums are copied and `head.checkSumAdjustment` is recomputed for the whole file.
 */
export function woffToSfnt(bytes: Uint8Array, inflate: Inflate): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_BYTES || view.getUint32(0) !== WOFF_SIGNATURE) {
    throw new Error('Not a WOFF 1.0 font file');
  }
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);

  const tables: WoffTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const entry = HEADER_BYTES + i * TABLE_ENTRY_BYTES;
    tables.push({
      tag: view.getUint32(entry),
      offset: view.getUint32(entry + 4),
      compLength: view.getUint32(entry + 8),
      origLength: view.getUint32(entry + 12),
      checksum: view.getUint32(entry + 16),
    });
  }

  const dataStart = SFNT_HEADER_BYTES + numTables * SFNT_ENTRY_BYTES;
  const data = tables.map((table) => {
    const stored = bytes.subarray(table.offset, table.offset + table.compLength);
    const raw = table.compLength < table.origLength ? inflate(stored) : stored;
    if (raw.length !== table.origLength) {
      throw new Error('Corrupt WOFF table length');
    }
    return raw;
  });
  const total = data.reduce((end, raw) => end + ((raw.length + 3) & ~3), dataStart);

  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 16 * 2 ** entrySelector;
  outView.setUint32(0, flavor);
  outView.setUint16(4, numTables);
  outView.setUint16(6, searchRange);
  outView.setUint16(8, entrySelector);
  outView.setUint16(10, numTables * 16 - searchRange);

  let offset = dataStart;
  let headOffset = -1;
  tables.forEach((table, i) => {
    const entry = SFNT_HEADER_BYTES + i * SFNT_ENTRY_BYTES;
    outView.setUint32(entry, table.tag);
    outView.setUint32(entry + 4, table.checksum);
    outView.setUint32(entry + 8, offset);
    outView.setUint32(entry + 12, table.origLength);
    out.set(data[i], offset);
    if (table.tag === HEAD_TAG && data[i].length >= 12) {
      headOffset = offset;
    }
    offset += (data[i].length + 3) & ~3;
  });
  if (headOffset >= 0) {
    outView.setUint32(headOffset + 8, 0);
    outView.setUint32(headOffset + 8, (CHECKSUM_MAGIC - checksum(out)) >>> 0);
  }
  return out;
}
