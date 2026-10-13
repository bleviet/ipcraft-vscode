import * as path from 'path';
import { resolveVersionContext } from '../../../../services/versioning/OwningIpCoreResolver';

const ROOT = path.resolve('/ws');

const core = (relPath: string, text: string) => ({
  fsPath: path.join(ROOT, relPath),
  relPath,
  text,
});

const importCore = (relPath: string, importPath: string, vlnv = 'version: 1.4.2') =>
  core(
    relPath,
    `vlnv: { vendor: acme, library: ip, name: uart, ${vlnv} }\nmemoryMaps:\n  import: ${importPath}\n`
  );

describe('resolveVersionContext', () => {
  const mm = path.join(ROOT, 'ip/uart/uart.mm.yml');

  it('resolves a sibling import', () => {
    expect(
      resolveVersionContext(mm, [
        importCore(
          'ip/uart/uart.ip.yml',
          './uart.mm.yml',
          "version: '1.4.2', versionScheme: major.minor.patch"
        ),
      ])
    ).toEqual({
      status: 'resolved',
      versionScheme: 'major.minor.patch',
      version: '1.4.2',
      ipCorePath: 'ip/uart/uart.ip.yml',
    });
  });

  it('resolves a parent-relative import', () => {
    const map = path.join(ROOT, 'maps/x.mm.yml');
    const context = resolveVersionContext(map, [
      importCore(
        'ip/x/x.ip.yml',
        '../../maps/x.mm.yml',
        "version: '2.0', versionScheme: major.minor"
      ),
    ]);
    expect(context).toMatchObject({
      status: 'resolved',
      versionScheme: 'major.minor',
      version: '2.0',
      ipCorePath: 'ip/x/x.ip.yml',
    });
  });

  it('resolves a bare relative import (no ./)', () => {
    expect(
      resolveVersionContext(mm, [
        importCore('ip/uart/uart.ip.yml', 'uart.mm.yml', "version: '1.0.0'"),
      ])
    ).toMatchObject({ status: 'resolved' });
  });

  it('resolves an import inside a memoryMaps array entry', () => {
    const text = `vlnv: { vendor: a, library: b, name: c, version: '1.0.0' }\nmemoryMaps:\n  - name: CSR\n    import: ./uart.mm.yml\n`;
    expect(resolveVersionContext(mm, [core('ip/uart/uart.ip.yml', text)])).toMatchObject({
      status: 'resolved',
      ipCorePath: 'ip/uart/uart.ip.yml',
    });
  });

  it('is none when no core imports the map', () => {
    expect(
      resolveVersionContext(mm, [importCore('ip/uart/uart.ip.yml', './other.mm.yml')])
    ).toEqual({ status: 'none' });
    expect(resolveVersionContext(mm, [])).toEqual({ status: 'none' });
  });

  it('does not match a same-named file in a different directory', () => {
    expect(
      resolveVersionContext(mm, [importCore('ip/other/other.ip.yml', './uart.mm.yml')])
    ).toEqual({ status: 'none' });
  });

  it('is ambiguous with two owners, listing sorted workspace-relative candidates', () => {
    expect(
      resolveVersionContext(mm, [
        importCore('ip/uart/z.ip.yml', './uart.mm.yml'),
        importCore('ip/uart/a.ip.yml', './uart.mm.yml'),
        importCore('ip/uart/unrelated.ip.yml', './other.mm.yml'),
      ])
    ).toEqual({ status: 'ambiguous', candidates: ['ip/uart/a.ip.yml', 'ip/uart/z.ip.yml'] });
  });

  it('ignores an inline memoryMaps array', () => {
    const text = `vlnv: { vendor: a, library: b, name: c, version: '1.0.0' }\nmemoryMaps:\n  - name: CSR\n    addressBlocks: []\n`;
    expect(resolveVersionContext(mm, [core('ip/uart/uart.ip.yml', text)])).toEqual({
      status: 'none',
    });
  });

  it('ignores files that fail to parse or are not mappings', () => {
    expect(
      resolveVersionContext(mm, [
        core('ip/uart/bad.ip.yml', 'vlnv: [unclosed\n  memoryMaps: {'),
        core('ip/uart/list.ip.yml', '- a\n- b\n'),
        core('ip/uart/empty.ip.yml', ''),
        importCore('ip/uart/uart.ip.yml', './uart.mm.yml'),
      ])
    ).toMatchObject({ status: 'resolved', ipCorePath: 'ip/uart/uart.ip.yml' });
  });

  it('treats an absent versionScheme as free and keeps the raw version text', () => {
    expect(
      resolveVersionContext(mm, [
        importCore('ip/uart/uart.ip.yml', './uart.mm.yml', "version: 'v1.4-rc'"),
      ])
    ).toEqual({
      status: 'resolved',
      versionScheme: 'free',
      version: 'v1.4-rc',
      ipCorePath: 'ip/uart/uart.ip.yml',
    });
  });

  it('treats an unknown versionScheme as free and a missing version as empty text', () => {
    const text = `vlnv: { vendor: a, library: b, name: c, versionScheme: semver }\nmemoryMaps:\n  import: ./uart.mm.yml\n`;
    expect(resolveVersionContext(mm, [core('ip/uart/uart.ip.yml', text)])).toMatchObject({
      status: 'resolved',
      versionScheme: 'free',
      version: '',
    });
  });
});
