import { classifyExisting, splitUserSection } from '../../../../services/vhdlLsConfig/ownership';
import {
  HEADER_HASH_PREFIX,
  USER_MARKER,
  renderVhdlLsToml,
} from '../../../../services/vhdlLsConfig/renderVhdlLsToml';

const libraries = [
  { name: 'defaultlib', files: [{ path: 'a.vhd', provenance: 'unlisted' }], excluded: [] },
];

describe('classifyExisting', () => {
  it('returns none for a missing file', () => {
    expect(classifyExisting(undefined)).toBe('none');
  });

  it('returns user for a file without the IPCraft header', () => {
    expect(classifyExisting("[libraries.x]\nfiles = ['a.vhd']\n")).toBe('user');
  });

  it('returns owned for untouched output, regardless of the user section', () => {
    expect(classifyExisting(renderVhdlLsToml(libraries, ''))).toBe('owned');
    expect(classifyExisting(renderVhdlLsToml(libraries, '[lint]\nunused = false\n'))).toBe('owned');
  });

  it('returns edited when the generated section changed or lost a marker', () => {
    const text = renderVhdlLsToml(libraries, '');
    expect(classifyExisting(text.replace("'a.vhd'", "'b.vhd'"))).toBe('edited');
    expect(classifyExisting(text.replace(USER_MARKER, '# gone'))).toBe('edited');
    expect(classifyExisting(text.replace(/sha256=[0-9a-f]+/, 'sha256=00'))).toBe('edited');
  });

  it('writes the hash header in the documented form', () => {
    expect(renderVhdlLsToml(libraries, '')).toMatch(
      new RegExp(`^${HEADER_HASH_PREFIX}[0-9a-f]{64}$`, 'm')
    );
  });
});

describe('splitUserSection', () => {
  it('returns the text after the marker line verbatim', () => {
    const user = '[lint]\nunused = false\n\n# note\n';
    expect(splitUserSection(renderVhdlLsToml(libraries, user))).toBe(user);
    expect(splitUserSection(renderVhdlLsToml(libraries, ''))).toBe('');
  });

  describe('CRLF files', () => {
    it('classifies an owned CRLF file as owned and splits its user section with LF', () => {
      const user = '[lint]\nunused = false\n';
      const crlf = renderVhdlLsToml(libraries, user).replace(/\n/g, '\r\n');
      expect(classifyExisting(crlf)).toBe('owned');
      expect(splitUserSection(crlf)).toBe(user);
    });
  });
});
