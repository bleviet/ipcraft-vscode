import { nameDifference } from '../../../../../services/systemDiagram/diff/nameDifference';

const marked = (text: string) => ({ text, mark: true });

describe('nameDifference', () => {
  it('marks the middle of each name between the common prefix and suffix', () => {
    expect(nameDifference('axi_gpio_0', 'axi_gpio_main')).toEqual({
      base: [{ text: 'axi_gpio_' }, marked('0')],
      current: [{ text: 'axi_gpio_' }, marked('main')],
    });
    expect(nameDifference('dma_a_fifo', 'dma_b_fifo')).toEqual({
      base: [{ text: 'dma_' }, marked('a'), { text: '_fifo' }],
      current: [{ text: 'dma_' }, marked('b'), { text: '_fifo' }],
    });
  });

  it('marks nothing on the side where the middle is empty (an insertion)', () => {
    expect(nameDifference('frambuffer_reader', 'framebuffer_reader')).toEqual({
      base: [{ text: 'fram' }, { text: 'buffer_reader' }],
      current: [{ text: 'fram' }, marked('e'), { text: 'buffer_reader' }],
    });
  });

  it('marks nothing on the current side for a deletion', () => {
    expect(nameDifference('framebuffer', 'frambuffer')).toEqual({
      base: [{ text: 'fram' }, marked('e'), { text: 'buffer' }],
      current: [{ text: 'fram' }, { text: 'buffer' }],
    });
  });

  it('handles a difference at the start and at the end', () => {
    expect(nameDifference('a_core', 'b_core')).toEqual({
      base: [marked('a'), { text: '_core' }],
      current: [marked('b'), { text: '_core' }],
    });
    expect(nameDifference('core_0', 'core_1')).toEqual({
      base: [{ text: 'core_' }, marked('0')],
      current: [{ text: 'core_' }, marked('1')],
    });
  });

  it('marks the whole name on both sides when the names share nothing', () => {
    expect(nameDifference('abc', 'xyz')).toEqual({
      base: [marked('abc')],
      current: [marked('xyz')],
    });
  });

  it('marks the extra characters when one name is a prefix or a suffix of the other', () => {
    expect(nameDifference('dma', 'dma_0')).toEqual({
      base: [{ text: 'dma' }],
      current: [{ text: 'dma' }, marked('_0')],
    });
    expect(nameDifference('dma_0', 'dma')).toEqual({
      base: [{ text: 'dma' }, marked('_0')],
      current: [{ text: 'dma' }],
    });
    expect(nameDifference('core', 'my_core')).toEqual({
      base: [{ text: 'core' }],
      current: [marked('my_'), { text: 'core' }],
    });
  });

  it('does not let the prefix and the suffix overlap', () => {
    expect(nameDifference('aa', 'aaa')).toEqual({
      base: [{ text: 'aa' }],
      current: [{ text: 'aa' }, marked('a')],
    });
  });
});
