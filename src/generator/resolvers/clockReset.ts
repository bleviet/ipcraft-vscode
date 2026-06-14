import type { ContextResolver, ResolverInput } from './types';

function parseClockPeriodNs(frequency: string | null | undefined): string | null {
  if (!frequency) {
    return null;
  }
  const m = /^(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)$/i.exec(frequency.trim());
  if (!m) {
    return null;
  }
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  let hz: number;
  if (unit === 'ghz') {
    hz = value * 1e9;
  } else if (unit === 'mhz') {
    hz = value * 1e6;
  } else if (unit === 'khz') {
    hz = value * 1e3;
  } else {
    hz = value;
  }
  return (1e9 / hz).toFixed(3);
}

export const clockResetResolver: ContextResolver = {
  name: 'clockReset',

  resolve({ ipCore }: ResolverInput): Record<string, unknown> {
    const clocks = ipCore?.clocks ?? [];
    const resets = ipCore?.resets ?? [];

    const clockPort = clocks[0]?.name ?? 'clk';
    const resetPort = resets[0]?.name ?? 'rst';
    const resetPolarity = String(resets[0]?.polarity ?? 'activeHigh');
    const resetActiveHigh = resetPolarity.toLowerCase().includes('high');

    const clocksWithPeriod = clocks.map((clock) => ({
      name: clock.name ?? '',
      frequency: clock.frequency ?? null,
      period_ns: parseClockPeriodNs(clock.frequency),
    }));

    return {
      clock_port: clockPort,
      reset_port: resetPort,
      reset_active_high: resetActiveHigh,
      clocks_with_period: clocksWithPeriod,
    };
  },
};
