import { isIgnoredWorkspacePath } from '../../../../../services/systemDiagram/enrichment/workspaceFilter';

describe('isIgnoredWorkspacePath', () => {
  it.each([
    '/ws/node_modules/pkg/core.ip.yml',
    '/ws/.git/hooks/x.vhd',
    '/ws/proj/.Xil/x.v',
    '/ws/proj/proj.gen/sources_1/ip/x.v',
    '/ws/proj/proj.cache/x.vhd',
    '/ws/proj/proj.ip_user_files/x.sv',
    '/ws/proj/proj.runs/synth_1/x.v',
    '/ws/proj/proj.sim/sim_1/x.v',
    'C:\\ws\\proj.gen\\x.v',
  ])('ignores %s', (path) => {
    expect(isIgnoredWorkspacePath(path)).toBe(true);
  });

  it.each(['/ws/rtl/core.vhd', '/ws/ip/my.gen.ip.yml', '/ws/generated/x.v', '/ws/gen/x.v'])(
    'keeps %s',
    (path) => {
      expect(isIgnoredWorkspacePath(path)).toBe(false);
    }
  );
});
