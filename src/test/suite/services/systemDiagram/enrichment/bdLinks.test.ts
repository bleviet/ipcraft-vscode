import * as path from 'path';
import {
  BD_LINKS_FILE,
  formatBdLinks,
  linksForDesign,
  parseBdLinks,
  setBdLink,
} from '../../../../../services/systemDiagram/enrichment/bdLinks';

const root = path.resolve('/ws');
const text = JSON.stringify({
  version: 1,
  links: { 'fpga/b/src/tcl/top.tcl': { part: 'fpga/common/src/tcl/part.tcl' } },
});

describe('bdLinks', () => {
  it('parses the links file', () => {
    expect(parseBdLinks(text).version).toBe(1);
    expect(BD_LINKS_FILE).toBe('.ipcraft/bd-links.json');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBdLinks('{')).toThrow();
  });

  it.each([
    '[]',
    'null',
    '{"version":2,"links":{}}',
    '{"version":1}',
    '{"version":1,"links":[]}',
    '{"version":1,"links":{"a":{"b":1}}}',
    '{"version":1,"links":{"a":"b"}}',
  ])('throws on the wrong shape %s', (bad) => {
    expect(() => parseBdLinks(bad)).toThrow(/bd-links.json/);
  });

  it('gives the links of one design with absolute values', () => {
    const file = parseBdLinks(text);
    expect(linksForDesign(file, root, path.join(root, 'fpga/b/src/tcl/top.tcl'))).toEqual({
      links: { part: path.join(root, 'fpga/common/src/tcl/part.tcl') },
      rejected: {},
    });
    expect(linksForDesign(file, root, path.join(root, 'other.tcl'))).toEqual({
      links: {},
      rejected: {},
    });
  });

  it('rejects targets outside the folder or that are not Tcl files', () => {
    const outside = path.resolve('/elsewhere/x.tcl');
    const file = parseBdLinks(
      JSON.stringify({
        version: 1,
        links: {
          'top.tcl': {
            up: '../x.tcl',
            abs: outside,
            bd: 'a/part.bd',
            ok: 'a/part.tcl',
          },
        },
      })
    );
    expect(linksForDesign(file, root, path.join(root, 'top.tcl'))).toEqual({
      links: { ok: path.join(root, 'a/part.tcl') },
      rejected: { up: '../x.tcl', abs: outside, bd: 'a/part.bd' },
    });
  });
});

describe('setBdLink', () => {
  const design = path.join(root, 'fpga/b/src/tcl/top.tcl');
  const tcl = (name: string) => path.join(root, 'fpga/common/src/tcl', `${name}.tcl`);

  it('adds a link to a missing file, with POSIX relative paths', () => {
    expect(setBdLink(undefined, root, design, 'part', tcl('part'))).toEqual({
      version: 1,
      links: { 'fpga/b/src/tcl/top.tcl': { part: 'fpga/common/src/tcl/part.tcl' } },
    });
  });

  it('replaces a link and keeps the others, without mutating the input', () => {
    const file = parseBdLinks(text);
    const added = setBdLink(file, root, design, 'other', tcl('other'));
    const replaced = setBdLink(added, root, design, 'part', tcl('new'));
    expect(replaced.links['fpga/b/src/tcl/top.tcl']).toEqual({
      part: 'fpga/common/src/tcl/new.tcl',
      other: 'fpga/common/src/tcl/other.tcl',
    });
    expect(file).toEqual(parseBdLinks(text));
  });

  it('removes a link, and the design key with the last one', () => {
    const two = setBdLink(parseBdLinks(text), root, design, 'other', tcl('other'));
    expect(setBdLink(two, root, design, 'part', undefined).links).toEqual({
      'fpga/b/src/tcl/top.tcl': { other: 'fpga/common/src/tcl/other.tcl' },
    });
    expect(setBdLink(parseBdLinks(text), root, design, 'part', undefined).links).toEqual({});
  });
});

describe('formatBdLinks', () => {
  it('writes 2-space JSON with sorted keys and a trailing newline', () => {
    const file = { version: 1 as const, links: { b: { z: 'z', a: 'a' }, a: { x: 'x' } } };
    expect(formatBdLinks(file)).toBe(
      `{\n  "version": 1,\n  "links": {\n    "a": {\n      "x": "x"\n    },\n    "b": {\n      "a": "a",\n      "z": "z"\n    }\n  }\n}\n`
    );
    expect(formatBdLinks(parseBdLinks(formatBdLinks(file)))).toBe(formatBdLinks(file));
  });
});
