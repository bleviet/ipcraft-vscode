import {
  snakecase,
  constcase,
  camelcase,
  pascalcase,
  log2,
  ljust,
  latexescape,
} from '../../../generator/templateFilters';

describe('templateFilters', () => {
  describe('snakecase', () => {
    it('splits camelCase', () => {
      expect(snakecase('genIrqHandler')).toBe('gen_irq_handler');
    });

    it('splits ACRONYM_CASE', () => {
      expect(snakecase('IRQ_EN')).toBe('irq_en');
    });

    it('splits PascalCase with an acronym run', () => {
      expect(snakecase('IRQHandler')).toBe('irq_handler');
    });

    it('splits -/./space separated input', () => {
      expect(snakecase('foo-bar.baz qux')).toBe('foo_bar_baz_qux');
    });
  });

  describe('constcase', () => {
    it('uppercases and joins with underscore', () => {
      expect(constcase('genIrqHandler')).toBe('GEN_IRQ_HANDLER');
      expect(constcase('IRQ_EN')).toBe('IRQ_EN');
    });
  });

  describe('camelcase', () => {
    it('is idempotent on camelCase input', () => {
      expect(camelcase('genIrqHandler')).toBe('genIrqHandler');
    });

    it('converts ACRONYM_CASE', () => {
      expect(camelcase('IRQ_EN')).toBe('irqEn');
    });

    it('converts snake_case', () => {
      expect(camelcase('gen_irq_handler')).toBe('genIrqHandler');
    });

    it('returns empty string for empty input', () => {
      expect(camelcase('')).toBe('');
    });
  });

  describe('pascalcase', () => {
    it('converts camelCase', () => {
      expect(pascalcase('genIrqHandler')).toBe('GenIrqHandler');
    });

    it('converts ACRONYM_CASE', () => {
      expect(pascalcase('IRQ_EN')).toBe('IrqEn');
    });
  });

  describe('log2', () => {
    it('returns ceiling log2 for positive values', () => {
      expect(log2(1)).toBe(0);
      expect(log2(2)).toBe(1);
      expect(log2(3)).toBe(2);
      expect(log2(4)).toBe(2);
      expect(log2(5)).toBe(3);
      expect(log2(1024)).toBe(10);
    });

    it('returns 0 for non-positive or non-finite input', () => {
      expect(log2(0)).toBe(0);
      expect(log2(-5)).toBe(0);
      expect(log2(NaN)).toBe(0);
      expect(log2(Infinity)).toBe(0);
    });
  });

  describe('ljust', () => {
    it('pads with spaces by default', () => {
      expect(ljust('ab', 5)).toBe('ab   ');
    });

    it('pads with a custom fill character', () => {
      expect(ljust('ab', 5, '0')).toBe('ab000');
    });

    it('leaves value unchanged when already at or above width', () => {
      expect(ljust('abcdef', 4)).toBe('abcdef');
    });
  });

  describe('latexescape', () => {
    it('escapes special characters', () => {
      expect(latexescape('50% & $5 #1 {a}_b ~x ^y \\z')).toBe(
        '50\\% \\& \\$5 \\#1 \\{a\\}\\_b \\textasciitilde{}x \\textasciicircum{}y \\textbackslash{}z'
      );
    });

    it('leaves plain text unchanged', () => {
      expect(latexescape('plain text')).toBe('plain text');
    });
  });
});
