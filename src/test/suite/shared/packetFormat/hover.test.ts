import * as fs from 'fs';
import * as path from 'path';
import {
  hoverKindOf,
  packetFileDiagnostics,
  packetHover,
  findSites,
  locatePath,
} from '../../../../shared/packetFormat';

const SPEC = path.resolve(__dirname, '../../../../../ipcraft-spec/examples/packet_formats');
const p = (f: string): string => `${SPEC.split(path.sep).join('/')}/${f}`;
const read = (f: string): string | undefined =>
  fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined;
const lineOf = (text: string, needle: string): number =>
  text.split('\n').findIndex((l) => l.includes(needle));

describe('packet format hovers', () => {
  it('recognizes the files', () => {
    expect(hoverKindOf('a/x.ip.yml')).toBe('ip');
    expect(hoverKindOf('a/x.pkt.yml')).toBe('pkt');
    expect(hoverKindOf('a/x.pktmap.yml')).toBe('pktmap');
    expect(hoverKindOf('a/x.yml')).toBeUndefined();
  });

  it('describes a refined flow-style field of link.pkt.yml', () => {
    const file = p('link.pkt.yml');
    const text = fs.readFileSync(file, 'utf8');
    const hover = packetHover(
      'pkt',
      file,
      text,
      lineOf(text, 'name: link_id, bits: "[7:0]"'),
      read
    );
    expect(hover?.markdown).toContain('`payload.link_id`');
    expect(hover?.markdown).toContain('TDATA / data');
    expect(hover?.markdown).toContain('[23:16]');
    expect(hover?.markdown).toContain('`link_event`');
    expect(hover?.markdown).toContain('Refines the base format `event`');
  });

  it('describes a declared field with its enum and the formats it belongs to', () => {
    const file = p('event.pkt.yml');
    const text = fs.readFileSync(file, 'utf8');
    const hover = packetHover('pkt', file, text, lineOf(text, 'name: prio'), read);
    expect(hover?.markdown).toContain('TUSER');
    expect(hover?.markdown).toContain('0=HIGH, 1=NORMAL');
    expect(hover?.markdown).toContain('Belongs to: `event`');
  });

  it('shows the format table for an ip.yml packetFormatRef', () => {
    const file = p('sub/core.ip.yml');
    const text = [
      'busInterfaces:',
      '  - name: m_axis',
      '    type: ipcraft:busif:axi_stream:1.0',
      '    packetFormatRef: ../link.pkt.yml#link_event',
      '',
    ].join('\n');
    const hover = packetHover('ip', file, text, 3, read);
    expect(hover?.markdown).toContain('Packet format `link_event`');
    expect(hover?.markdown).toContain('Extends: `event`');
    expect(hover?.markdown).toContain('| signal | bits | field path | type / enum | description |');
    expect(hover?.markdown).toContain('[23:16] | &nbsp;&nbsp;link_id');
    expect(packetHover('ip', file, text, 2, read)).toBeUndefined();
    expect(packetHover('ip', file, text, 1, read)?.markdown).toContain('link_event');
  });

  it('shows the payload mapping of a pktmap source', () => {
    const file = p('capture.pktmap.yml');
    const text = fs.readFileSync(file, 'utf8');
    const hover = packetHover('pktmap', file, text, lineOf(text, 'link_tx'), read);
    expect(hover?.markdown).toContain('Source `link_tx`');
    expect(hover?.markdown).toContain('Added vs `event`');
    expect(hover?.markdown).toContain('`payload.link_id`');
    expect(hover?.markdown).toContain('`timestamp.qualifier`');
    const base = packetHover('pktmap', file, text, lineOf(text, 'generator'), read);
    expect(base?.markdown).toContain('unchanged');
  });
});

describe('packet file diagnostics', () => {
  it('is empty for valid files', () => {
    const file = p('link.pkt.yml');
    expect(packetFileDiagnostics(file, fs.readFileSync(file, 'utf8'), read)).toEqual([]);
  });

  it('places the resolver error on the offending field', () => {
    const file = p('invalid/overlap.pkt.yml');
    const text = fs.readFileSync(file, 'utf8');
    const [d] = packetFileDiagnostics(file, text, read);
    expect(d.code).toBe('FIELD_OVERLAP');
    expect(d.startLine).toBeGreaterThan(0);
  });

  it('locates error paths in the sites of a file', () => {
    const file = p('link.pkt.yml');
    const sites = findSites(fs.readFileSync(file, 'utf8'));
    const span = locatePath(sites, 'packetFormats.link_event.refine.timestamp.qualifier');
    expect(span).toBeDefined();
    expect(sites.formats.map((f) => f.name)).toEqual(['link_event']);
  });
});
