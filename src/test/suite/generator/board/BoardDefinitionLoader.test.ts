import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { devResourceRoots } from '../../../../services/ResourceRoots';
import {
  loadBoardDefinition,
  builtinBoardPath,
} from '../../../../generator/board/BoardDefinitionLoader';

const repoRoot = path.resolve(__dirname, '../../../../..');
const resourceRoots = devResourceRoots(repoRoot);

describe('BoardDefinitionLoader', () => {
  it('loads the bundled DE10-Nano board definition with the verified pin facts', async () => {
    const board = await loadBoardDefinition(
      builtinBoardPath(resourceRoots, 'de10_nano.board.yml'),
      resourceRoots
    );

    expect(board.device).toBe('5CSEBA6U23I7');
    expect(board.family).toBe('Cyclone V SoC');

    const clock = board.clocks.find((c) => c.name === 'FPGA_CLK1_50');
    expect(clock).toEqual(
      expect.objectContaining({
        pin: 'PIN_V11',
        frequencyHz: 50_000_000,
        ioStandard: '3.3-V LVTTL',
      })
    );

    const led0 = board.ios.find((io) => io.name === 'LED0');
    expect(led0).toEqual(
      expect.objectContaining({
        pin: 'PIN_W15',
        ioStandard: '3.3-V LVTTL',
        direction: 'out',
        polarity: 'activeHigh',
      })
    );
  });

  it('rejects a board definition missing the required `device` field with a clear error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-board-'));
    const invalidPath = path.join(tmpDir, 'invalid.board.yml');
    await fs.writeFile(
      invalidPath,
      'name: Bad Board\nfamily: Cyclone V\nvendor: Terasic\n',
      'utf8'
    );

    await expect(loadBoardDefinition(invalidPath, resourceRoots)).rejects.toThrow(/device/);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
