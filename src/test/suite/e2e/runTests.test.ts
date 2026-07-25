import { downloadVscodeWithRetry } from '../../e2e/runTests';

describe('downloadVscodeWithRetry', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('retries an isolated VS Code download without retrying the smoke test', async () => {
    const runDownload = jest
      .fn<Promise<void>, [string]>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce();

    await expect(downloadVscodeWithRetry('1.80.0', runDownload)).resolves.toBeUndefined();

    expect(runDownload).toHaveBeenCalledTimes(3);
    expect(runDownload).toHaveBeenCalledWith('1.80.0');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('surfaces the final download failure after three attempts', async () => {
    const finalError = new Error('download unavailable');
    const runDownload = jest.fn<Promise<void>, [string]>().mockRejectedValue(finalError);

    await expect(downloadVscodeWithRetry('stable', runDownload)).rejects.toBe(finalError);

    expect(runDownload).toHaveBeenCalledTimes(3);
  });
});
