import { peerLabel } from '../../../../../services/systemDiagram/diff/pinPeers';

describe('peerLabel', () => {
  it('writes peers on the viewed level relative to it', () => {
    expect(peerLabel({ instance: '/h/g1', level: '/h', pin: 'z' }, '/h')).toBe('g1/z');
    expect(peerLabel({ instance: null, level: '/h', pin: 'clk' }, '/h')).toBe('clk');
  });

  it('writes peers of another level in an absolute form that cannot be mistaken', () => {
    expect(peerLabel({ instance: '/h/g1', level: '/h', pin: 'z' }, '/')).toBe('/h/g1/z');
    expect(peerLabel({ instance: null, level: '/h/g1', pin: 'z' }, '/')).toBe('/h/g1:z');
    expect(peerLabel({ instance: null, level: '/', pin: 'sys_clk' }, '/h')).toBe('/sys_clk');
  });

  it('writes a peer below a renamed hierarchy with the name the base gave it', () => {
    const baseName = (path: string) => path.replace('/h_new', '/h_old');
    expect(peerLabel({ instance: null, level: '/h_new/g1', pin: 'z' }, '/', baseName)).toBe(
      '/h_old/g1:z'
    );
    expect(peerLabel({ instance: '/h_new/g1', level: '/h_new', pin: 'z' }, '/', baseName)).toBe(
      '/h_old/g1/z'
    );
    expect(
      peerLabel({ instance: '/h_new/g1', level: '/h_new', pin: 'z' }, '/h_new', baseName)
    ).toBe('g1/z');
  });
});
