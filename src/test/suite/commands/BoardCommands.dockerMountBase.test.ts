import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { registerBoardCommands } from '../../../commands/BoardCommands';
import { runProcess } from '../../../services/BuildRunner';
import { parseQuartusReports } from '../../../services/ReportParser';
import { devResourceRoots } from '../../../services/ResourceRoots';

jest.mock('../../../services/BuildRunner', () => ({
  runProcess: jest.fn(),
}));

jest.mock('../../../services/ReportParser', () => ({
  parseQuartusReports: jest.fn(),
}));

const repoRoot = path.resolve(__dirname, '../../../..');
const resourceRoots = devResourceRoots(repoRoot);
const fakeContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;

/**
 * Regression for the PR #82 review finding: BoardCommands' Docker-runner paths
 * (createBoardQuartusProject, buildBoardProject, programBoardCommand) passed ipDir directly
 * to toolchain.getDocker() instead of computeMountBase(name, ipDir) like
 * QuartusToolchain.createProject does — breaking Docker-based builds whenever a fileSets HDL
 * file lives outside ipDir (e.g. the DE10-Nano case studies' "../../common/rtl/..." layout).
 */
describe('BoardCommands Docker mount base (issue: PR #82 review)', () => {
  let tmpRoot: string;
  let ipDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    // jest config's resetMocks:true strips every mock's implementation before each test —
    // these all need reapplying here rather than relying on __mocks__/vscode.ts's defaults.
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'quartus.runner') {
          return 'docker';
        }
        if (key === 'quartus.dockerImage') {
          return 'intel/quartus:23.1';
        }
        return defaultValue;
      },
      update: jest.fn(),
    }));
    (vscode.commands.registerCommand as jest.Mock).mockImplementation(
      () => new vscode.Disposable(() => {})
    );
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      async (_opts: unknown, task: () => Promise<unknown>) => task()
    );
    (vscode.Uri.file as jest.Mock).mockImplementation((p: string) => ({
      fsPath: p,
      toString: () => p,
    }));
    (vscode.window.createOutputChannel as jest.Mock).mockImplementation(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    }));
    (runProcess as jest.Mock).mockResolvedValue({ success: true, exitCode: 0 });
    (parseQuartusReports as jest.Mock).mockResolvedValue({});

    // fileSets RTL lives two directories above the .ip.yml — the common shape for the
    // DE10-Nano case studies (examples/<ip>/led_blink.ip.yml -> examples/common/rtl/*.sv).
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-board-docker-'));
    ipDir = path.join(tmpRoot, 'examples', 'led_blink');
    await fs.mkdir(ipDir, { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'examples', 'common', 'rtl'), { recursive: true });
    await fs.writeFile(
      path.join(ipDir, 'led_blink.ip.yml'),
      [
        'vlnv:',
        '  vendor: test',
        '  library: lib',
        '  name: led_blink',
        '  version: 1.0.0',
        'fileSets:',
        '  - name: RTL_Sources',
        '    files:',
        '      - path: ../../common/rtl/led_blink.sv',
        '        type: systemverilog',
        '        managed: false',
      ].join('\n')
    );

    const boardDir = path.join(ipDir, 'altera-board');
    await fs.mkdir(path.join(boardDir, 'output_files'), { recursive: true });
    await fs.writeFile(path.join(boardDir, 'led_blink_board_top_board_project.tcl'), '# stub\n');
    await fs.writeFile(path.join(boardDir, 'output_files', 'led_blink_board_top.sof'), '');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('buildBoardProject computes the mount base from fileSets, not ipDir', async () => {
    registerBoardCommands(fakeContext, resourceRoots);
    const registerCommand = vscode.commands.registerCommand as jest.Mock;
    const buildHandler = registerCommand.mock.calls.find(
      ([id]) => id === 'fpga-ip-core.buildBoardProject'
    )?.[1] as (uri: vscode.Uri) => Promise<void>;
    expect(buildHandler).toBeDefined();

    await buildHandler(vscode.Uri.file(path.join(ipDir, 'led_blink.ip.yml')));

    const call = (runProcess as jest.Mock).mock.calls[0];
    expect(call).toBeDefined();
    const options = call[2] as { docker?: { image: string; mountBase: string } };
    expect(options.docker).toBeDefined();
    // The fileSets RTL lives at tmpRoot/common/rtl (two ".." above ipDir), so the common
    // ancestor of it and ipDir (tmpRoot/examples/led_blink) is tmpRoot itself — wider than
    // ipDir alone, proving computeMountBase ran instead of a bare ipDir passthrough (which
    // would have left the RTL file unmounted inside the Docker container).
    expect(options.docker?.mountBase).toBe(tmpRoot);
    expect(options.docker?.mountBase).not.toBe(ipDir);
  });
});
