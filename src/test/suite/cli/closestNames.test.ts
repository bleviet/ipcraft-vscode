import { closestNames } from '../../../cli/closestNames';

describe('closestNames', () => {
  const names = ['/axi_dma_0', '/axi_gpio_0', '/dsp_pipeline', '/xlconcat_0'];

  it('ranks prefix and substring matches first', () => {
    expect(closestNames('/axi', names, 2)).toEqual(['/axi_dma_0', '/axi_gpio_0']);
    expect(closestNames('pipeline', names, 1)).toEqual(['/dsp_pipeline']);
  });

  it('falls back to edit distance and caps the list', () => {
    expect(closestNames('/xlconcatt_0', names)).toHaveLength(3);
    expect(closestNames('/xlconcatt_0', names)[0]).toBe('/xlconcat_0');
  });
});
