import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateCustomBusDefs } from '../../../generator/VivadoCustomBusDefinitions';
import type { IpCoreData } from '../../../generator/types';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import { installGlobalBusDefinitions } from '../../../generator/VivadoBusDefInstaller';

jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => mockConfigDir,
}));
let mockConfigDir = '';

describe('installGlobalBusDefinitions', () => {
  beforeEach(() => {
    mockConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-busdefs-'));
  });
  afterEach(() => fs.rmSync(mockConfigDir, { recursive: true, force: true }));

  it('declares every polarity role, matching the per-IP bus definition', async () => {
    const dir = await installGlobalBusDefinitions(
      path.resolve(__dirname, '../../../../ipcraft-spec/bus_definitions')
    );
    const abstraction = fs.readFileSync(path.join(dir, 'avalon_mm_rtl.xml'), 'utf8');

    expect(abstraction).toContain('<spirit:logicalName>read</spirit:logicalName>');
    expect(abstraction).toContain('<spirit:logicalName>read_n</spirit:logicalName>');
    expect(abstraction).toContain('<spirit:logicalName>byteenable_n</spirit:logicalName>');
  });

  it('writes the same abstraction as the per-IP bundle and omits widths that vary per interface', async () => {
    const dir = await installGlobalBusDefinitions(
      path.resolve(__dirname, '../../../../ipcraft-spec/bus_definitions')
    );
    const installed = fs.readFileSync(path.join(dir, 'avalon_mm_rtl.xml'), 'utf8');
    const files = generateCustomBusDefs(
      {
        ...{ name: 'x', vlnv: { vendor: 'v', library: 'l', name: 'x', version: '1.0' } },
        busInterfaces: [
          {
            name: 'avs',
            type: 'ipcraft:busif:avalon_mm:1.0',
            mode: 'slave',
            physicalPrefix: 'avs_',
            useOptionalPorts: ['read'],
            portPolarityOverrides: { read: 'activeLow' },
            portWidthOverrides: { writedata: 64 },
          },
        ],
      } as unknown as IpCoreData,
      builtinBusLibrary()
    );

    expect(files['busdef/avalon_mm_rtl.xml']).toBe(installed);
    for (const logical of ['writedata', 'readdata', 'byteenable', 'address']) {
      const start = installed.indexOf(`<spirit:logicalName>${logical}</spirit:logicalName>`);
      const block = installed.slice(start, installed.indexOf('</spirit:port>', start));
      expect(start).toBeGreaterThan(-1);
      expect(block).not.toContain('<spirit:width>');
    }
    const start = installed.indexOf('<spirit:logicalName>waitrequest</spirit:logicalName>');
    expect(installed.slice(start, installed.indexOf('</spirit:port>', start))).toContain(
      '<spirit:width>1</spirit:width>'
    );
  });
});
