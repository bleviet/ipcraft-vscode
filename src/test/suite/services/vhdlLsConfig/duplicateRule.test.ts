import {
  compareCopies,
  selectCopies,
  type Copy,
} from '../../../../services/vhdlLsConfig/duplicateRule';
import { scanVhdl } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

const AVAILABLE = new Set(['ieee', 'osvvm_common']);
const copy = (file: string, text: string, duplicateRank = 5): Copy => ({
  file,
  duplicateRank,
  scan: scanVhdl(text),
});
const pkg = (name: string, extra = ''): string => `${extra}package ${name} is\nend;\n`;
const order = (copies: Copy[]): string[] =>
  [...copies].sort((a, b) => compareCopies(a, b, AVAILABLE)).map((c) => c.file);

describe('compareCopies', () => {
  it('puts a manifest-named copy first even with unknown libraries', () => {
    const listed = copy('long/path/x.vhd', pkg('x', 'library nvc;\n'), 1);
    expect(order([copy('x.vhd', pkg('x')), listed])).toEqual(['long/path/x.vhd', 'x.vhd']);
  });

  it('prefers fewer library clauses naming an unavailable library', () => {
    const a = copy('a_long.vhd', pkg('x', 'library ieee, osvvm_common;\n'));
    const b = copy('b.vhd', pkg('x', 'library nvc;\n'));
    const c = copy('c.vhd', pkg('x', 'library nvc, unisim;\n'));
    expect(order([c, b, a])).toEqual(['a_long.vhd', 'b.vhd', 'c.vhd']);
  });

  it('then prefers the shorter path, then string order', () => {
    expect(order([copy('bb.vhd', pkg('x')), copy('a/b.vhd', pkg('x'))])).toEqual([
      'bb.vhd',
      'a/b.vhd',
    ]);
    expect(order([copy('b.vhd', pkg('x')), copy('a.vhd', pkg('x'))])).toEqual(['a.vhd', 'b.vhd']);
  });
});

describe('selectCopies', () => {
  it('keeps a file that adds a unit and excludes one whose units are all taken', () => {
    const result = selectCopies(
      [
        copy('a.vhd', `${pkg('p')}${pkg('q')}`),
        copy('bb.vhd', `${pkg('q')}${pkg('r')}`),
        copy('ccc.vhd', pkg('q')),
      ],
      AVAILABLE
    );
    expect(result.kept.map((c) => c.file)).toEqual(['a.vhd', 'bb.vhd']);
    expect(result.excluded).toEqual([
      { file: 'ccc.vhd', reason: 'duplicate of package q in a.vhd' },
    ]);
  });

  it('names the first taken unit and its owner kind', () => {
    const result = selectCopies(
      [copy('a.vhd', 'entity e is\nend;\n'), copy('bb.vhd', 'package e is\nend;\n')],
      AVAILABLE
    );
    expect(result.excluded).toEqual([{ file: 'bb.vhd', reason: 'duplicate of entity e in a.vhd' }]);
  });

  it('keeps files without units and is independent of input order', () => {
    const copies = [
      copy('a.vhd', pkg('p')),
      copy('b.vhd', pkg('p')),
      { file: 'big.vhd', duplicateRank: 5, scan: undefined } as Copy,
    ];
    const forward = selectCopies(copies, AVAILABLE);
    const backward = selectCopies([...copies].reverse(), AVAILABLE);
    expect(forward).toEqual(backward);
    expect(forward.kept.map((c) => c.file)).toEqual(['a.vhd', 'big.vhd']);
  });
});
