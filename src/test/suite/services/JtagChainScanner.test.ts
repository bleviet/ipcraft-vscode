import {
  parseJtagConfigOutput,
  findFpgaNode,
  describeDeviceFamily,
} from '../../../services/JtagChainScanner';

const DE10_NANO_OUTPUT = [
  '1) USB-Blaster [1-6]',
  '  02D020DD   5CSEBA6(.|ES)/5CSEMA6/..',
  '  020F30DD   SOCVHPS',
].join('\n');

const MULTI_CABLE_OUTPUT = [
  '1) USB-Blaster [1-6]',
  '  02D020DD   5CSEBA6(.|ES)/5CSEMA6/..',
  '  020F30DD   SOCVHPS',
  '2) USB-Blaster II [2-3]',
  '  020A10DD   EP4CE22/EP4CE15',
].join('\n');

describe('parseJtagConfigOutput', () => {
  it('parses a single cable with an FPGA fabric node and an HPS node (DE10-Nano)', () => {
    const cables = parseJtagConfigOutput(DE10_NANO_OUTPUT);
    expect(cables).toHaveLength(1);
    expect(cables[0].index).toBe(1);
    expect(cables[0].name).toBe('USB-Blaster [1-6]');
    expect(cables[0].devices).toHaveLength(2);
    expect(cables[0].devices[0]).toEqual({
      position: 1,
      idcode: '02D020DD',
      namePattern: '5CSEBA6(.|ES)/5CSEMA6/..',
    });
    expect(cables[0].devices[1]).toEqual({
      position: 2,
      idcode: '020F30DD',
      namePattern: 'SOCVHPS',
    });
  });

  it('parses multiple cables independently', () => {
    const cables = parseJtagConfigOutput(MULTI_CABLE_OUTPUT);
    expect(cables).toHaveLength(2);
    expect(cables[0].devices).toHaveLength(2);
    expect(cables[1].index).toBe(2);
    expect(cables[1].devices).toHaveLength(1);
    expect(cables[1].devices[0].namePattern).toBe('EP4CE22/EP4CE15');
  });

  it('returns no cables for empty output (no board connected)', () => {
    expect(parseJtagConfigOutput('')).toEqual([]);
    expect(parseJtagConfigOutput('No JTAG hardware available')).toEqual([]);
  });
});

describe('findFpgaNode', () => {
  it('matches the DE10-Nano Cyclone V fabric node by full device part number, not the HPS node', () => {
    const cables = parseJtagConfigOutput(DE10_NANO_OUTPUT);
    const match = findFpgaNode(cables, '5CSEBA6U23I7');
    expect(match).toBeDefined();
    expect(match?.device.position).toBe(1);
    expect(match?.device.idcode).toBe('02D020DD');
    expect(match?.cable.index).toBe(1);
  });

  it('matches case-insensitively', () => {
    const cables = parseJtagConfigOutput(DE10_NANO_OUTPUT);
    const match = findFpgaNode(cables, '5csEba6u23i7');
    expect(match).toBeDefined();
  });

  it('returns undefined when no device in the chain matches the board part (issue #79 AC2)', () => {
    const cables = parseJtagConfigOutput(DE10_NANO_OUTPUT);
    const match = findFpgaNode(cables, 'XC7Z020CLG484');
    expect(match).toBeUndefined();
  });

  it('returns undefined for an empty chain', () => {
    expect(findFpgaNode([], '5CSEBA6U23I7')).toBeUndefined();
  });

  it('finds the right cable across multiple detected cables', () => {
    const cables = parseJtagConfigOutput(MULTI_CABLE_OUTPUT);
    const match = findFpgaNode(cables, 'EP4CE22F17C6');
    expect(match?.cable.index).toBe(2);
    expect(match?.device.position).toBe(1);
  });
});

describe('describeDeviceFamily', () => {
  it('maps a Cyclone V DE10-Nano device to "Cyclone V"', () => {
    expect(describeDeviceFamily('5CSEBA6U23I7')).toBe('Cyclone V');
  });

  it('maps a MAX 10 device to "MAX 10"', () => {
    expect(describeDeviceFamily('10M50DAF484C7G')).toBe('MAX 10');
  });

  it('falls back to the raw device string for an unrecognized prefix', () => {
    expect(describeDeviceFamily('xc7z020clg484-1')).toBe('xc7z020clg484-1');
  });
});
