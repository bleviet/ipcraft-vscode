import { parseLiteral } from '../../../dataInspector/parseLiteral';

describe('parseLiteral', () => {
  it.each([
    ["8'b0011_1010", '00111010'],
    ['b"0011_1010"', '00111010'],
    ["8'h3_A", '00111010'],
    ['x"3_A"', '00111010'],
    ['0b0011_1010', '00111010'],
    ['0x3_A', '00111010'],
  ])('parses %s', (literal, binary) => {
    expect(parseLiteral(literal).vector.toBinary()).toBe(binary);
  });

  it('retains original text and warns when weak states are normalized', () => {
    const original = 'b"LHUW-"';
    const parsed = parseLiteral(original);

    expect(parsed.originalText).toBe(original);
    expect(parsed.vector.toBinary()).toBe('01XXX');
    expect(parsed.warnings).toEqual([
      'Weak L/H states were normalized to 0/1',
      'Weak U/W/- states were normalized to X',
    ]);
  });

  it('requires explicit decimal width and signed negative interpretation', () => {
    expect(() => parseLiteral('42')).toThrow('explicit width');
    expect(() => parseLiteral('-1', { width: 8 })).toThrow('signed interpretation');
    expect(parseLiteral('-1', { width: 8, signed: true }).vector.toLiteral()).toBe("8'hFF");
    expect(parseLiteral('42', { width: 8 }).vector.toLiteral()).toBe("8'h2A");
  });

  it.each([
    ['0x1', "32'h00000001"],
    ['0xFF', "32'h000000FF"],
    ['0b101', "32'h00000005"],
    ['1', "32'h00000001"],
  ])('zero-extends unsized %s input to the requested width', (literal, expected) => {
    expect(parseLiteral(literal, { width: 32 }).vector.toLiteral()).toBe(expected);
  });

  it.each([
    ["32'h12", "32'h00000012"],
    ["8'b101", "8'h05"],
  ])('zero-extends sized %s input to its declared width', (literal, expected) => {
    expect(parseLiteral(literal).vector.toLiteral()).toBe(expected);
  });

  it('does not truncate unsized input that exceeds the requested width', () => {
    expect(() => parseLiteral('0x1FF', { width: 8 })).toThrow('12 bits but width is 8');
    expect(() => parseLiteral('0b100000000', { width: 8 })).toThrow('9 bits but width is 8');
  });

  it('does not truncate sized digit literals that exceed their declared width', () => {
    expect(() => parseLiteral("4'b00101")).toThrow('5 bits but width is 4');
    expect(() => parseLiteral("4'h12")).toThrow('8 bits but width is 4');
  });

  it('enforces the deliberate width ceiling', () => {
    expect(() => parseLiteral("0'b0")).toThrow('1 to 4096');
    expect(() => parseLiteral(`${4097}'b${'0'.repeat(4097)}`)).toThrow('1 to 4096');
  });
});
