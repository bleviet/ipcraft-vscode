import { isSystemDesignScript } from '../../../../services/systemDiagram/systemDesignDetection';

describe('isSystemDesignScript', () => {
  it('accepts a .tcl file that creates a block design or cell', () => {
    expect(isSystemDesignScript('/p/system.tcl', 'create_bd_design foo')).toBe(true);
    expect(isSystemDesignScript('/p/system.tcl', 'set c [create_bd_cell -type ip x]')).toBe(true);
  });

  it('rejects _hw.tcl files', () => {
    expect(isSystemDesignScript('/p/core_hw.tcl', 'create_bd_cell')).toBe(false);
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

  it('rejects non-tcl files', () => {
    expect(isSystemDesignScript('/p/system.yml', 'create_bd_design foo')).toBe(false);
  });

  it('rejects Tcl without block design commands', () => {
    expect(isSystemDesignScript('/p/build.tcl', 'create_project p .')).toBe(false);
    expect(isSystemDesignScript('/p/build.tcl', 'create_bd_cells_x')).toBe(false);
  });
});
