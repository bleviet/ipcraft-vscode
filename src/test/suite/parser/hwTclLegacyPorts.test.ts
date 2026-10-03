import { hasLegacyPortDeclarations, sliceVerilogModule } from '../../../parser/hwTclLegacyPorts';

const SOURCE = `module first (input a);
endmodule
module top (
  input clk,
  output [7:0] q
);
endmodule
module last (input z);
endmodule`;

describe('sliceVerilogModule', () => {
  it('slices from the named module to its endmodule', () => {
    const sliced = sliceVerilogModule(SOURCE, 'top');
    expect(sliced.startsWith('module top')).toBe(true);
    expect(sliced.endsWith('endmodule')).toBe(true);
    expect(sliced).not.toContain('first');
    expect(sliced).not.toContain('last');
  });

  it('returns the whole source without a name or when the name is not found', () => {
    expect(sliceVerilogModule(SOURCE)).toBe(SOURCE);
    expect(sliceVerilogModule(SOURCE, 'missing')).toBe(SOURCE);
  });

  it('does not match a module whose name merely starts with the given name', () => {
    expect(sliceVerilogModule('module top_x (input a);\nendmodule', 'top')).toContain('top_x');
  });
});

describe('hasLegacyPortDeclarations', () => {
  it('detects an add_port_to_interface line', () => {
    expect(hasLegacyPortDeclarations('a\n  add_port_to_interface "i" "p" "clk"')).toBe(true);
    expect(hasLegacyPortDeclarations('add_interface_port i p clk Input 1')).toBe(false);
  });
});
