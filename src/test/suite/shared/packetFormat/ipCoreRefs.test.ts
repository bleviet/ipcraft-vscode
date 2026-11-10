import * as path from 'path';
import { builtinBusLibrary } from '../../../helpers/busLibrary';
import {
  candidatesOfFile,
  checkPacketFormatRefs,
  filterCandidates,
  buildLanes,
  laneOf,
  wrapLane,
  resolve,
  type PacketFormatRefInfo,
} from '../../../../shared/packetFormat';
import { resolvePacketFormatRef, readFromDisk } from '../../../../services/packetFormat/refInfo';
import type { IpCore } from '../../../../domain/ipcore.types';

const SPEC = path.resolve(__dirname, '../../../../../ipcraft-spec/examples/packet_formats');
const IP_FILE = path.join(SPEC, 'sub', 'core.ip.yml').split(path.sep).join('/');
const library = builtinBusLibrary();

function core(busInterfaces: unknown[], extra: Record<string, unknown> = {}): IpCore {
  return { apiVersion: '1.3', busInterfaces, ...extra } as unknown as IpCore;
}
const lookup = (ref: string): PacketFormatRefInfo => resolvePacketFormatRef(ref, IP_FILE);
const codes = (c: IpCore): string[] => checkPacketFormatRefs(c, library, lookup).map((i) => i.code);

describe('checkPacketFormatRefs', () => {
  const axis = (extra: Record<string, unknown>) => ({
    name: 's_axis',
    type: 'ipcraft:busif:axi_stream:1.0',
    mode: 'slave',
    ...extra,
  });

  it('accepts a resolvable ref on a streaming interface', () => {
    expect(codes(core([axis({ packetFormatRef: '../telegram.pkt.yml#telegram' })]))).toEqual([]);
  });

  it('rejects a non-streaming bus', () => {
    const c = core([
      {
        name: 's_axi',
        type: 'ipcraft:busif:axi4_lite:1.0',
        mode: 'slave',
        packetFormatRef: '../link.pkt.yml#link_event',
      },
    ]);
    expect(codes(c)).toContain('PACKET_FORMAT_BUS_KIND');
  });

  it('reports a missing file and an unknown format', () => {
    expect(codes(core([axis({ packetFormatRef: '../nope.pkt.yml#x' })]))).toContain(
      'PACKET_FORMAT_UNRESOLVED'
    );
    expect(codes(core([axis({ packetFormatRef: '../link.pkt.yml#nope' })]))).toContain(
      'PACKET_FORMAT_UNRESOLVED'
    );
    expect(codes(core([axis({ packetFormatRef: 'broken' })]))).toContain('PACKET_FORMAT_REF');
  });

  it('reports a dataWidth different from the interface TDATA width', () => {
    const ok = core([axis({ packetFormatRef: '../telegram.pkt.yml#telegram' })]);
    expect(codes(ok)).toEqual([]);
    const bad = core([
      axis({
        packetFormatRef: '../telegram.pkt.yml#telegram',
        portWidthOverrides: { TDATA: 64 },
      }),
    ]);
    expect(codes(bad)).toEqual(['PACKET_FORMAT_WIDTH']);
    const wide = core([axis({ packetFormatRef: '../link.pkt.yml#link_event' })]);
    expect(codes(wide)).toEqual(['PACKET_FORMAT_WIDTH']);
  });

  it('warns when portFields and packetFormatRef are both set', () => {
    const c = core([
      axis({ packetFormatRef: '../link.pkt.yml#link_event', portFields: { tdata: [] } }),
    ]);
    expect(
      checkPacketFormatRefs(c, library, lookup).find((i) => i.code === 'PACKET_FORMAT_PORT_FIELDS')
        ?.severity
    ).toBe('warning');
  });

  it('stays silent until the host has answered', () => {
    const c = core([axis({ packetFormatRef: '../link.pkt.yml#link_event' })]);
    expect(checkPacketFormatRefs(c, library, () => undefined)).toEqual([]);
  });
});

describe('candidates and lanes', () => {
  const file = `${SPEC.split(path.sep).join('/')}/telegram.pkt.yml`;
  const cands = candidatesOfFile(IP_FILE, file, readFromDisk);

  it('lists the formats of a file as refs relative to the ip.yml', () => {
    expect(cands.map((c) => c.ref)).toEqual(
      expect.arrayContaining(['../telegram.pkt.yml#telegram', '../telegram.pkt.yml#blob'])
    );
  });

  it('filters by data width and bus type, and never by unknown facts', () => {
    expect(filterCandidates(cands, { dataWidth: 64 }).map((c) => c.name)).toEqual(['blob']);
    expect(filterCandidates(cands, {})).toHaveLength(cands.length);
    expect(
      filterCandidates(cands, { dataWidth: 32, busTypeNames: ['axi_stream'] }).map((c) => c.name)
    ).toContain('telegram');
  });

  it('computes proportional lanes with the MSB at the left', () => {
    const fmt = resolve(`${SPEC.split(path.sep).join('/')}/event.pkt.yml`, readFromDisk).formats
      .event;
    const lanes = buildLanes(fmt);
    expect(lanes.length).toBeGreaterThan(0);
    const lane = laneOf(
      'data',
      [
        { name: 'hi', path: 'hi', lsb: 24, width: 8, type: 'uint', description: '' },
        { name: 'lo', path: 'lo', lsb: 0, width: 8, type: 'uint', description: '' },
      ],
      32
    );
    expect(lane.segments.map((s) => [s.name, s.leftPct, s.widthPct])).toEqual([
      ['hi', 0, 25],
      ['lo', 75, 25],
    ]);
  });

  it('wraps a wide lane into rows of equal scale, lowest row first', () => {
    const lane = laneOf(
      'TDATA',
      [
        { name: 'payload', path: 'payload', lsb: 16, width: 15, type: 'uint', description: '' },
        { name: 'data1', path: 'data1', lsb: 32, width: 32, type: 'uint', description: '' },
        { name: 'wide', path: 'wide', lsb: 80, width: 32, type: 'uint', description: '' },
      ],
      160
    );
    const rows = wrapLane(lane, 32);
    expect(rows.map((r) => [r.lsb, r.width])).toEqual([
      [0, 32],
      [32, 32],
      [64, 32],
      [96, 32],
      [128, 32],
    ]);
    expect(rows[0].segments.map((s) => [s.name, s.leftPct, s.widthPct, s.partial])).toEqual([
      ['payload', 3.125, 46.875, false],
    ]);
    expect(rows[1].segments.map((s) => [s.name, s.partial])).toEqual([['data1', false]]);
    const split = [rows[2], rows[3]].map((r) => r.segments[0]);
    expect(split.map((s) => [s.name, s.msb, s.lsb, s.partial])).toEqual([
      ['wide', 95, 80, true],
      ['wide', 111, 96, true],
    ]);
    expect(split[0].colorIndex).toBe(split[1].colorIndex);
    expect(rows[4].segments).toEqual([]);
    expect(wrapLane(lane, 0)).toEqual([lane]);
  });
});
