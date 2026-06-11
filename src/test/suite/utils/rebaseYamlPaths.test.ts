import * as path from 'path';
import { rebaseIpYamlPaths } from '../../../utils/rebaseYamlPaths';

function makeIpYaml(filePaths: string[]): string {
  const lines = [
    'vlnv:',
    '  vendor: acme.com',
    '  library: ip',
    '  name: my_core',
    '  version: 1.0',
    'fileSets:',
    '  - name: RTL_Sources',
    '    files:',
    ...filePaths.map((p) => `      - path: ${p}\n        type: vhdl`),
  ];
  return lines.join('\n') + '\n';
}

function getPaths(yaml: string): string[] {
  const matches = [...yaml.matchAll(/path:\s*(.+)/g)];
  return matches.map((m) => m[1].trim());
}

const SEP = path.sep;

describe('rebaseIpYamlPaths', () => {
  it('returns original text unchanged when fromDir === toDir', () => {
    const yaml = makeIpYaml(['../rtl/foo.vhd']);
    expect(rebaseIpYamlPaths(yaml, '/ip/xilinx', '/ip/xilinx')).toBe(yaml);
  });

  it('strips one ../ when component.xml is in xilinx/ and ip.yml goes to parent', () => {
    const yaml = makeIpYaml(['../rtl/foo_pkg.vhd', '../rtl/foo.vhd']);
    const result = rebaseIpYamlPaths(yaml, SEP + path.join('ip', 'xilinx'), SEP + 'ip');
    const paths = getPaths(result);
    expect(paths[0]).toBe('rtl/foo_pkg.vhd');
    expect(paths[1]).toBe('rtl/foo.vhd');
  });

  it('prefixes with vendor subdir for files local to xilinx/', () => {
    const yaml = makeIpYaml(['hdl/foo.vhd']);
    const result = rebaseIpYamlPaths(yaml, SEP + path.join('ip', 'xilinx'), SEP + 'ip');
    const paths = getPaths(result);
    expect(paths[0]).toBe('xilinx/hdl/foo.vhd');
  });

  it('handles paths with no change needed (already relative to parent)', () => {
    const yaml = makeIpYaml(['rtl/foo.vhd']);
    // fromDir and toDir are the same — should return unchanged
    const result = rebaseIpYamlPaths(yaml, SEP + 'ip', SEP + 'ip');
    expect(result).toBe(yaml);
  });

  it('returns unchanged when fileSets is absent', () => {
    const yaml = 'vlnv:\n  name: foo\n';
    expect(rebaseIpYamlPaths(yaml, '/a', '/b')).toBe(yaml);
  });
});
