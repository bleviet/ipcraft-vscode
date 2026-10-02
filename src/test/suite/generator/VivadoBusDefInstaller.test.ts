import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
});
