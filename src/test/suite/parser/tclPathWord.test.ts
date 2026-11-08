import * as path from 'path';
import { resolveTclPathWord } from '../../../parser/tclPathWord';

describe('resolveTclPathWord', () => {
  it('returns a plain path unchanged', () => {
    expect(resolveTclPathWord('rtl/top.vhd')).toBe('rtl/top.vhd');
  });

  it('joins a [file join ...] word', () => {
    expect(resolveTclPathWord('[file join a b c.vhd]')).toBe(path.join('a', 'b', 'c.vhd'));
    expect(resolveTclPathWord('[file join a "b c" {d.vhd}]')).toBe(path.join('a', 'b c', 'd.vhd'));
  });

  it('substitutes items that exactly equal a key', () => {
    const subs = new Map([['$::quartus(qip_path)', '/ip/core']]);
    expect(resolveTclPathWord('[file join $::quartus(qip_path) "x.vhd"]', subs)).toBe(
      path.join('/ip/core', 'x.vhd')
    );
    expect(resolveTclPathWord('$::quartus(qip_path)', subs)).toBe('/ip/core');
  });

  it('returns null when Tcl syntax remains', () => {
    expect(resolveTclPathWord('$dir/x.vhd')).toBeNull();
    expect(resolveTclPathWord('[file join $dir x.vhd]')).toBeNull();
    expect(
      resolveTclPathWord('$::quartus(qip_path)/x.vhd', new Map([['$::quartus(qip_path)', '/a']]))
    ).toBeNull();
  });
});
