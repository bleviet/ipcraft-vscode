import * as toml from 'toml';
import type {
  GeneratedLibrary,
  MissingLibrary,
} from '../../../../services/vhdlLsConfig/buildLibraryMap';
import {
  GENERATED_END,
  GENERATED_START,
  USER_MARKER,
  appendProposals,
  renderVhdlLsToml,
} from '../../../../services/vhdlLsConfig/renderVhdlLsToml';

const UNISIM_FILES = new Map([
  [
    'unisim',
    {
      files: ['/opt/vivado/2024.2/data/unisim_VCOMP.vhd'],
      setting: 'ipcraft.vivado.installDirs',
      version: '2024.2',
    },
  ],
]);

const missing = (over: Partial<MissingLibrary> & { name: string }): MissingLibrary => ({
  firstUse: { file: 'a/top.vhd', line: 3 },
  otherFiles: 0,
  candidates: [],
  exclude: [],
  ...over,
});

describe('renderVhdlLsToml', () => {
  const libraries: GeneratedLibrary[] = [
    {
      name: 'defaultlib',
      files: [
        { path: "a/it's.vhd", provenance: 'x.xpr' },
        { path: 'b.vhd', provenance: 'unlisted' },
      ],
      excluded: [{ path: 'c.vhd', reason: 'duplicate of entity b in b.vhd' }],
    },
    {
      name: 'my.lib',
      files: [],
      excluded: [{ path: 'd.vhd', reason: 'duplicate of package p in e.vhd' }],
    },
  ];

  it('renders markers, quoted keys and literal or basic path strings', () => {
    const text = renderVhdlLsToml(libraries, '');
    expect(text).toContain(`${GENERATED_START}\nlibraries.defaultlib.files = [`);
    expect(text).toContain(`  "a/it's.vhd",  # x.xpr`);
    expect(text).toContain(`  'b.vhd',  # unlisted`);
    expect(text).toContain('  # excluded: c.vhd, duplicate of entity b in b.vhd');
    expect(text).toContain('libraries."my.lib".files = [\n  # excluded: d.vhd');
    expect(text.endsWith(`${GENERATED_END}\n\n${USER_MARKER}\n`)).toBe(true);
  });

  it('produces valid TOML with the listed files', () => {
    const parsed = toml.parse(renderVhdlLsToml(libraries, '[lint]\nunused = false\n')) as {
      libraries: Record<string, { files: string[] }>;
    };
    expect(parsed.libraries.defaultlib.files).toEqual(["a/it's.vhd", 'b.vhd']);
    expect(parsed.libraries['my.lib'].files).toEqual([]);
  });
});

describe('control characters', () => {
  it('escapes paths per TOML and keeps comments on one line', () => {
    const text = renderVhdlLsToml(
      [
        {
          name: 'lib',
          files: [{ path: 'a\tb\u0001\nc.vhd', provenance: 'x\ny' }],
          excluded: [{ path: 'd\re.vhd', reason: 'dup\nof f' }],
        },
      ],
      ''
    );
    expect(text).toContain('  "a\\tb\\u0001\\nc.vhd",  # x\\ny');
    expect(text).toContain('  # excluded: d\\re.vhd, dup\\nof f');
    const parsed = toml.parse(text) as { libraries: { lib: { files: string[] } } };
    expect(parsed.libraries.lib.files).toEqual(['a\tb\u0001\nc.vhd']);
  });
});

describe('appendProposals', () => {
  it('keeps every proposal line a comment when paths contain control characters', () => {
    const text = appendProposals(
      '',
      [
        missing({
          name: 'osvvm',
          firstUse: { file: 'tb/a\nb.vhd', line: 5 },
          candidates: ['ext/o\nsv/*.vhd'],
        }),
      ],
      new Set(),
      new Map()
    );
    expect(text).toContain('# Missing library osvvm, used by tb/a\\nb.vhd:5.');
    expect(text).toContain('# Packages it should provide were found in: ext/o\\nsv/');
    expect(
      text
        .split('\n')
        .filter((line) => line !== '')
        .every((line) => line.startsWith('#'))
    ).toBe(true);
    expect(() => {
      toml.parse(text);
    }).not.toThrow();
  });

  it('writes the placeholder proposal for an unknown library', () => {
    expect(
      appendProposals('', [missing({ name: 'osvvm', otherFiles: 2 })], new Set(), new Map())
    ).toBe(
      [
        '# Missing library osvvm, used by a/top.vhd:3 and 2 other files.',
        '# [libraries.osvvm]',
        "# files = ['<path to osvvm sources>/*.vhd']",
        '# is_third_party = true',
        '',
      ].join('\n')
    );
  });

  it('proposes candidate directories', () => {
    const text = appendProposals(
      '',
      [missing({ name: 'dsp_lib', candidates: ['libs/dsp/*.vhd', '*.vhd'] })],
      new Set(),
      new Map()
    );
    expect(text).toContain('# Packages it should provide were found in: libs/dsp/, ./');
    expect(text).toContain("# files = ['libs/dsp/*.vhd', '*.vhd']");
    expect(text).not.toContain('is_third_party');
  });

  it('renders an exclude hint only when there is something to exclude', () => {
    const withExclude = appendProposals(
      '',
      [
        missing({
          name: 'dsp_lib',
          candidates: ['libs/*.vhd'],
          exclude: ["libs/o'k.vhd", 'libs/a.vhd'],
        }),
      ],
      new Set(),
      new Map()
    );
    expect(withExclude).toContain(
      "# files = ['libs/*.vhd']\n# exclude = [\"libs/o'k.vhd\", 'libs/a.vhd']"
    );
    const without = appendProposals(
      '',
      [missing({ name: 'dsp_lib', candidates: ['libs/*.vhd'] })],
      new Set(),
      new Map()
    );
    expect(without).not.toContain('# exclude');
  });

  it('never adds an exclude hint to a vendor-install proposal', () => {
    const text = appendProposals(
      '',
      [missing({ name: 'unisim', exclude: ['x.vhd'] })],
      new Set(),
      UNISIM_FILES
    );
    expect(text).not.toContain('# exclude');
  });

  it('prefers vendor install files and names their setting', () => {
    const text = appendProposals('', [missing({ name: 'unisim' })], new Set(), UNISIM_FILES);
    expect(text).toContain('# Path from ipcraft.vivado.installDirs (2024.2):');
    expect(text).toContain("# files = ['/opt/vivado/2024.2/data/unisim_VCOMP.vhd']");
    expect(text).toContain('# is_third_party = true');
  });

  it('adds the VUnit note for vunit_lib only', () => {
    expect(appendProposals('', [missing({ name: 'vunit_lib' })], new Set(), new Map())).toContain(
      '# VUnit ships files for several VHDL standards'
    );
    expect(appendProposals('', [missing({ name: 'osvvm' })], new Set(), new Map())).not.toContain(
      'VUnit'
    );
  });

  it('appends once: skips libraries already proposed and separates blocks with a blank line', () => {
    const first = appendProposals(
      '[lint]\nunused = false',
      [missing({ name: 'osvvm' }), missing({ name: 'uvvm_util' })],
      new Set(),
      new Map()
    );
    expect(first).toContain('unused = false\n\n# Missing library osvvm');
    expect(first).toContain('\n\n# Missing library uvvm_util');
    const again = appendProposals(
      first,
      [missing({ name: 'osvvm' })],
      new Set(['osvvm']),
      new Map()
    );
    expect(again).toBe(first);
  });

  describe('library without kept files', () => {
    it('renders an empty array with the excluded comment as valid TOML', () => {
      const text = renderVhdlLsToml(
        [
          {
            name: 'defaultlib',
            files: [],
            excluded: [{ path: 'wb/m.vhd', reason: 'excluded by libraries.wb' }],
          },
        ],
        ''
      );
      expect(text).toContain(
        'libraries.defaultlib.files = [\n  # excluded: wb/m.vhd, excluded by libraries.wb\n]'
      );
      const parsed = toml.parse(text) as { libraries: { defaultlib: { files: string[] } } };
      expect(parsed.libraries.defaultlib.files).toEqual([]);
    });
  });
});
