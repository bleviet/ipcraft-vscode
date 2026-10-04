import * as path from 'path';
import { checkImportedIpCore } from '../../../services/importedIpCoreCheck';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { blocksImportWrite } from '../../../shared/busConformance';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const resourceRoots = devResourceRoots(path.resolve(__dirname, '../../../..'));

describe('checkImportedIpCore', () => {
  // Shape produced by the _hw.tcl importer for Intel IP such as sdi_ii_ed_reconfig_mgmt.
  it('reports schema problems as issues instead of throwing, and allows the write', async () => {
    const report = await checkImportedIpCore({
      sourcePath: '/project/core_hw.tcl',
      yamlText: `
vlnv: {vendor: acme, library: ip, name: core, version: 1.0.0}
ports:
  - {name: dbg, direction: $port_dir, width: 1}
`,
      resourceRoots,
      loadBusLibrary: () => Promise.resolve(builtinBusLibrary()),
    });

    expect(report.issues).toContainEqual(expect.objectContaining({ source: 'schema' }));
    expect(blocksImportWrite(report)).toBe(false);
  });

  it('still blocks the write on a known protocol error', async () => {
    const report = await checkImportedIpCore({
      sourcePath: '/project/core_hw.tcl',
      yamlText: `
vlnv: {vendor: acme, library: ip, name: core, version: 1.0.0}
busInterfaces:
  - {name: stream, type: AXIS, mode: master, portWidthOverrides: {TDATA: 20}}
`,
      resourceRoots,
      loadBusLibrary: () => Promise.resolve(builtinBusLibrary()),
    });

    expect(blocksImportWrite(report)).toBe(true);
  });

  it('reports but does not block errors on interfaces the importer could not read statically', async () => {
    const check = (staticallyIncompleteInterfaces?: string[]) =>
      checkImportedIpCore({
        sourcePath: '/project/core_hw.tcl',
        yamlText: `
vlnv: {vendor: acme, library: ip, name: core, version: 1.0.0}
busInterfaces:
  - {name: computed, type: AXIS, mode: master, portWidthOverrides: {TDATA: 20}}
`,
        resourceRoots,
        loadBusLibrary: () => Promise.resolve(builtinBusLibrary()),
        staticallyIncompleteInterfaces,
      });

    const unmarked = await check();
    const marked = await check(['computed']);

    expect(blocksImportWrite(unmarked)).toBe(true);
    expect(blocksImportWrite(marked)).toBe(false);
    expect(marked.issues).toEqual(unmarked.issues);
  });
});
