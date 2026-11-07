import {
  formatHz,
  nameWithFrequency,
  parseFrequency,
} from '../../../../webview/systemDiagram/clocks/frequency';

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
  ])('formats %s as %s', (hz, text) => {
    expect(formatHz(hz)).toBe(text);
  });

  it('round-trips what it prints', () => {
    for (const text of ['100 MHz', '1.5 GHz', '32.768 kHz', '50 Hz']) {
      expect(formatHz(parseFrequency(text)!)).toBe(text);
    }
  });
});

describe('nameWithFrequency', () => {
  it('appends the frequency when the script sets one', () => {
    expect(nameWithFrequency({ name: 'FCLK_CLK0', hz: 100e6 })).toBe('FCLK_CLK0 · 100 MHz');
    expect(nameWithFrequency({ name: 'FCLK_CLK0', hz: 100e6 }, ' ')).toBe('FCLK_CLK0 100 MHz');
  });

  it('is the name alone, with no word for a missing frequency', () => {
    expect(nameWithFrequency({ name: 'clk_out1' })).toBe('clk_out1');
    expect(nameWithFrequency({ name: 'clk_out1' }, ' ')).toBe('clk_out1');
  });
});
