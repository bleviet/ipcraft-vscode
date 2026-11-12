import { isSystemDesignScript } from '../../../../services/systemDiagram/systemDesignDetection';

describe('isSystemDesignScript', () => {
  it('accepts a .tcl file that creates a block design or cell', () => {
    expect(isSystemDesignScript('/p/system.tcl', 'create_bd_design foo')).toBe(true);
    expect(isSystemDesignScript('/p/system.tcl', 'set c [create_bd_cell -type ip x]')).toBe(true);
  });

  it('accepts a .tcl file that creates a Platform Designer system or instance', () => {
    expect(isSystemDesignScript('/p/system.tcl', 'create_system nios2_system')).toBe(true);
    expect(isSystemDesignScript('/p/system.tcl', 'add_instance clk_0 clock_source')).toBe(true);
    expect(isSystemDesignScript('/p/system.tcl', 'add_instance_x foo')).toBe(false);
  });

  it('accepts a script that matches both patterns', () => {
    expect(isSystemDesignScript('/p/s.tcl', 'create_system x\ncreate_bd_design y')).toBe(true);
  });

  it('rejects _hw.tcl files', () => {
    expect(isSystemDesignScript('/p/core_hw.tcl', 'create_bd_cell')).toBe(false);
    expect(isSystemDesignScript('/p/core_hw.tcl', 'add_instance x y')).toBe(false);
  });

  it('accepts a .qsys file that contains a <system> element', () => {
    expect(isSystemDesignScript('/p/sys.qsys', '<?xml version="1.0"?>\n<system name="s">')).toBe(
      true
    );
    expect(isSystemDesignScript('/p/sys.qsys', '<system>')).toBe(true);
  });

  it('rejects .qsys files without a <system> element', () => {
    expect(isSystemDesignScript('/p/sys.qsys', '<project name="s"/>')).toBe(false);
    expect(isSystemDesignScript('/p/sys.qsys', '<systems/>')).toBe(false);
    expect(isSystemDesignScript('/p/sys.tcl', '<system name="s">')).toBe(false);
  });

  it('accepts a .bd file with a design object', () => {
    expect(isSystemDesignScript('/p/s.bd', '{\n  "design": {\n  }\n}')).toBe(true);
    expect(isSystemDesignScript('/p/s.bd', '{"design":{}}')).toBe(true);
  });

  it('accepts an XML .bd file so the reader can explain it is unsupported', () => {
    expect(isSystemDesignScript('/p/s.bd', '\n  <?xml version="1.0"?>')).toBe(true);
  });

  it('rejects a .bd file that is neither', () => {
    expect(isSystemDesignScript('/p/s.bd', '{"other": {}}')).toBe(false);
    expect(isSystemDesignScript('/p/s.json', '{"design": {}}')).toBe(false);
  });

  it('rejects non-tcl files', () => {
    expect(isSystemDesignScript('/p/system.yml', 'create_bd_design foo')).toBe(false);
  });

  it('rejects Tcl without block design commands', () => {
    expect(isSystemDesignScript('/p/build.tcl', 'create_project p .')).toBe(false);
    expect(isSystemDesignScript('/p/build.tcl', 'create_bd_cells_x')).toBe(false);
  });
});
