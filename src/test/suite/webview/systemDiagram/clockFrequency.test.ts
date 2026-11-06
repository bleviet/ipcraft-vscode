import { formatHz, parseFrequency } from '../../../../webview/systemDiagram/clocks/frequency';

describe('parseFrequency', () => {
  it.each([
    ['100MHz', 100e6],
    ['100 MHz', 100e6],
    ['1.5GHz', 1.5e9],
    ['50kHz', 50e3],
    ['32.768 kHz', 32768],
    ['100000000', 100e6],
    ['100e6', 100e6],
    ['100 hz', 100],
    ['  125MHZ  ', 125e6],
    ['.5MHz', 5e5],
    ['100.', 100],
  ])('parses %s as %s Hz', (text, hz) => {
    expect(parseFrequency(text)).toBe(hz);
  });

  it.each(['', 'fast', '100 MB', 'MHz', '1,5GHz', '$freq', '1e', '1.2.3MHz'])(
    'returns undefined for %j',
    (text) => {
      expect(parseFrequency(text)).toBeUndefined();
    }
  );
});

describe('formatHz', () => {
  it.each([
    [100e6, '100 MHz'],
    [1.5e9, '1.5 GHz'],
    [32768, '32.768 kHz'],
    [50, '50 Hz'],
    [125e6, '125 MHz'],
    [33.333333e6, '33.333 MHz'],
    [200e6, '200 MHz'],
    [undefined, 'unknown'],
  ])('formats %s as %s', (hz, text) => {
    expect(formatHz(hz)).toBe(text);
  });

  it('round-trips what it prints', () => {
    for (const text of ['100 MHz', '1.5 GHz', '32.768 kHz', '50 Hz']) {
      expect(formatHz(parseFrequency(text))).toBe(text);
    }
  });
});
