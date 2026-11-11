import { vivadoProjectDesigns } from '../../../../../services/systemDiagram/enrichment/cmakeProjects';

const FILE = '/fpga/vek385/CMakeLists.txt';

describe('vivadoProjectDesigns', () => {
  it('resolves relative items, including ../, against the CMake folder', () => {
    const text = `add_vivado_project(\${PROJECT_NAME}
  TOP        top_wrapper
  RTL        src/hdl/a.vhd;src/hdl/b.vhd
  DESIGN     src/tcl/rm_aie_test.tcl;../common/src/tcl/base_partition.tcl;src/tcl/top.tcl
  PDI   TRUE
)`;
    expect(vivadoProjectDesigns(text, FILE)).toEqual([
      [
        '/fpga/vek385/src/tcl/rm_aie_test.tcl',
        '/fpga/common/src/tcl/base_partition.tcl',
        '/fpga/vek385/src/tcl/top.tcl',
      ],
    ]);
  });

  it('expands the folder variables and drops other variables', () => {
    const text = `add_vivado_project(p DESIGN "\${CMAKE_CURRENT_LIST_DIR}/a.tcl;\${CMAKE_CURRENT_SOURCE_DIR}/b.tcl;\${OTHER}/c.tcl" TOP t)`;
    expect(vivadoProjectDesigns(text, FILE)).toEqual([
      ['/fpga/vek385/a.tcl', '/fpga/vek385/b.tcl'],
    ]);
  });

  it('reads every call and the last keyword value', () => {
    const text = `add_vivado_project(a DESIGN x.tcl)
add_vivado_project(b DESIGN y.tcl z.tcl TOP t)`;
    expect(vivadoProjectDesigns(text, FILE)).toEqual([
      ['/fpga/vek385/x.tcl'],
      ['/fpga/vek385/y.tcl', '/fpga/vek385/z.tcl'],
    ]);
  });

  it('ignores comments', () => {
    const text = `# add_vivado_project(a DESIGN no.tcl)
add_vivado_project(a
  # DESIGN hidden.tcl
  DESIGN yes.tcl # trailing
)`;
    expect(vivadoProjectDesigns(text, FILE)).toEqual([['/fpga/vek385/yes.tcl']]);
  });

  it('is empty without a call', () => {
    expect(vivadoProjectDesigns('project(x)\nadd_executable(y)', FILE)).toEqual([]);
  });
});
