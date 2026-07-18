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

  it('does not silently extend or truncate sized digit literals', () => {
    expect(() => parseLiteral("8'h1")).toThrow('4 bits but width is 8');
    expect(() => parseLiteral("4'b00101")).toThrow('5 bits but width is 4');
    expect(() => parseLiteral("4'h12")).toThrow('8 bits but width is 4');
  });

  it('enforces the deliberate width ceiling', () => {
    expect(() => parseLiteral("0'b0")).toThrow('1 to 4096');
    expect(() => parseLiteral(`${4097}'b${'0'.repeat(4097)}`)).toThrow('1 to 4096');
  });
});
