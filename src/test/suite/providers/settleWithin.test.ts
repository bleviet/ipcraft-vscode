import { settleWithin, STILL_PENDING } from '../../../providers/settleWithin';

describe('settleWithin', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the promise settles first and clears the timer', async () => {
    await expect(settleWithin(Promise.resolve('done'), 100)).resolves.toBe('done');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves STILL_PENDING when the timer fires first', async () => {
    const result = settleWithin(new Promise<string>(() => undefined), 100);
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe(STILL_PENDING);
  });

  it('rejects when the promise rejects first and clears the timer', async () => {
    await expect(settleWithin(Promise.reject(new Error('boom')), 100)).rejects.toThrow('boom');
    expect(jest.getTimerCount()).toBe(0);
  });
});
