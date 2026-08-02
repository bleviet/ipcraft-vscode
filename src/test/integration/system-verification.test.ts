import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import type {
  DiscoveredSystem,
  SystemVerificationConfig,
  SystemVerificationPlan,
} from '../../domain/systemVerification.types';
import discoveryOutput from '../fixtures/system-verification/discovery-output.json';
import { parseSystemVerificationConfig } from '../../services/systemVerification/SystemVerificationConfig';
import { buildSystemVerificationPlan } from '../../services/systemVerification/SystemVerificationPlanner';
import { scaffoldSystemVerification } from '../../services/systemVerification/SystemVerificationScaffolder';
import { VivadoSystemDiscovery } from '../../services/systemVerification/VivadoSystemDiscovery';
import { parseMemoryMap } from '../../domain/parse';
import { guardTier2, toolOnPath } from './tier';

const config: SystemVerificationConfig = {
  recreateScript: 'hardware/system/create_system.tcl',
  part: 'xc7z020clg484-1',
  designName: 'system',
  clockPath: '/sys_clk',
  clockPeriodNs: 10,
  resetPath: '/sys_rst_n',
  resetActiveLow: true,
  resetCycles: 5,
  target: {
    driveInterfacePath: '/S_AXI_TEST',
    instancePath: '/control_0',
    memoryMap: '../ip/control.mm.yml',
  },
};

const discoveredFixture = discoveryOutput as DiscoveredSystem;
const planBinding = {
  boundaryInterface: discoveredFixture.boundaryInterfaces[0],
  clockPort: discoveredFixture.boundaryPorts[0],
  resetPort: discoveredFixture.boundaryPorts[1],
  wrapperPorts: discoveredFixture.wrapperPorts,
  wrapperLanguage: 'VHDL' as const,
};

const plan: SystemVerificationPlan = {
  route: {
    driveInterfacePath: '/S_AXI_TEST',
    instancePath: '/control_0',
    protocol: 'AXI4-Lite',
    baseAddress: 0,
    addressRange: 0x40,
    busBytes: 4,
    addressWidth: 32,
    addressSegmentPath: '/control_0/S_AXI/reg0',
    mappedSegmentPath: '/S_AXI_TEST/SEG_control_0_reg0',
  },
  ...planBinding,
  transactions: [],
};

const fixtureDirectory = path.resolve(__dirname, '../fixtures/system-verification/vhdl');
const vivadoExampleDirectory = path.resolve(process.cwd(), 'examples/system_verification_axil');
const vivadoFixtureDirectory = path.join(vivadoExampleDirectory, 'xilinx');
const VIVADO_BIN = process.env.VIVADO_BIN ?? 'vivado';

function runGhdl(workDirectory: string, args: ReadonlyArray<string>): SpawnSyncReturns<string> {
  return spawnSync('ghdl', args, {
    cwd: workDirectory,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function requireGhdlSuccess(result: SpawnSyncReturns<string>, command: string): void {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

function writeScaffold(outputDirectory: string, scaffold: Record<string, string>): void {
  for (const [relativePath, contents] of Object.entries(scaffold)) {
    const destination = path.join(outputDirectory, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents, 'utf8');
  }
}

function readResult(runDirectory: string): { outcome: string; firstFailure?: string } {
  return JSON.parse(fs.readFileSync(path.join(runDirectory, 'result.json'), 'utf8')) as {
    outcome: string;
    firstFailure?: string;
  };
}

describe('rendered AXI4-Lite VHDL BFM', () => {
  it('compiles and runs deterministic reads, writes, byte strobes, errors, and timeouts', () => {
    if (
      guardTier2(
        'ghdl',
        () => toolOnPath('ghdl'),
        'not found on PATH (set REQUIRE_GHDL=1 to require the independent BFM gate)'
      )
    ) {
      return;
    }

    const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-system-bfm-'));
    try {
      const scaffold = scaffoldSystemVerification({
        config,
        plan,
        memoryMapText: 'name: control\naddressBlocks: []\n',
        outputDirectory: path.join(workDirectory, 'hardware/system/verification'),
      });
      fs.writeFileSync(
        path.join(workDirectory, 'axi4lite_master_bfm.vhd'),
        scaffold['tb/axi4lite_master_bfm.vhd'],
        'utf8'
      );
      for (const fixture of ['axi4lite_slave_model.vhd', 'axi4lite_bfm_tb.vhd']) {
        fs.copyFileSync(path.join(fixtureDirectory, fixture), path.join(workDirectory, fixture));
      }

      for (const source of [
        'axi4lite_master_bfm.vhd',
        'axi4lite_slave_model.vhd',
        'axi4lite_bfm_tb.vhd',
      ]) {
        requireGhdlSuccess(runGhdl(workDirectory, ['-a', '--std=08', source]), `ghdl -a ${source}`);
      }
      requireGhdlSuccess(
        runGhdl(workDirectory, ['-e', '--std=08', 'axi4lite_bfm_tb']),
        'ghdl -e axi4lite_bfm_tb'
      );

      const passingRun = runGhdl(workDirectory, [
        '-r',
        '--std=08',
        'axi4lite_bfm_tb',
        '-gtestCase=0',
        '--assert-level=error',
      ]);
      requireGhdlSuccess(passingRun, 'ghdl -r axi4lite_bfm_tb testCase=0');
      expect(`${passingRun.stdout}\n${passingRun.stderr}`).toContain('BFM PASS');

      const expectedFailures = [
        {
          testCase: 1,
          message: 'write-slverr: write B response error',
          response: 'response=0x2',
        },
        { testCase: 2, message: 'read-decerr: read R response error', response: 'response=0x3' },
        {
          testCase: 3,
          message: 'write-aw-stall: write AW timeout',
          response: 'address=0x00000030',
        },
        { testCase: 4, message: 'read-ar-stall: read AR timeout', response: 'address=0x00000034' },
      ];

      for (const expectedFailure of expectedFailures) {
        const result = runGhdl(workDirectory, [
          '-r',
          '--std=08',
          'axi4lite_bfm_tb',
          `-gtestCase=${expectedFailure.testCase}`,
          '--assert-level=error',
        ]);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(output).toContain(expectedFailure.message);
        expect(output).toContain(expectedFailure.response);
      }
    } finally {
      fs.rmSync(workDirectory, { recursive: true, force: true });
    }
  });
});

describe('recreated Vivado system verification', () => {
  it('discovers, plans, scaffolds, and runs a recreated mixed-language AXI4-Lite block design', async () => {
    const explicitlySkipped = process.env.SKIP_VIVADO === '1';
    if (
      guardTier2(
        'vivado',
        () => !explicitlySkipped && (fs.existsSync(VIVADO_BIN) || toolOnPath(VIVADO_BIN)),
        explicitlySkipped
          ? 'SKIP_VIVADO=1 (explicit opt-out)'
          : `${VIVADO_BIN} was not found as a path or on PATH (set VIVADO_BIN or REQUIRE_VIVADO=1)`
      )
    ) {
      return;
    }

    const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-system-'));
    const systemDirectory = path.join(
      workDirectory,
      'examples',
      'system_verification_axil',
      'xilinx'
    );
    const verificationDirectory = path.join(systemDirectory, 'verification');
    const memoryMapDirectory = path.dirname(systemDirectory);
    const passingRunDirectory = path.join(workDirectory, 'passing-run');
    const failingRunDirectory = path.join(workDirectory, 'failing-run');

    try {
      fs.mkdirSync(verificationDirectory, { recursive: true });
      for (const fixture of ['create_system.tcl', 'vhdl_target.vhd', 'verilog_neighbour.sv']) {
        fs.copyFileSync(
          path.join(vivadoFixtureDirectory, fixture),
          path.join(systemDirectory, fixture)
        );
      }

      fs.mkdirSync(memoryMapDirectory, { recursive: true });
      const memoryMapText = fs.readFileSync(
        path.join(vivadoExampleDirectory, 'control.mm.yml'),
        'utf8'
      );
      fs.writeFileSync(path.join(memoryMapDirectory, 'control.mm.yml'), memoryMapText, 'utf8');

      const fixtureConfigPath = path.join(
        vivadoFixtureDirectory,
        'verification',
        'system-verification.yml'
      );
      const fixtureConfig = parseSystemVerificationConfig(
        fs.readFileSync(fixtureConfigPath, 'utf8'),
        fixtureConfigPath
      );
      const discovery = new VivadoSystemDiscovery(
        {
          getDocker: () => undefined,
          getLaunchEnv: () => ({ env: {}, extraMounts: [] }),
          resolve: () => ({ exe: VIVADO_BIN, prefixArgs: [] }),
        },
        path.resolve(process.cwd(), 'src', 'generator', 'templates')
      );
      const discovered = await discovery.discover({
        config: fixtureConfig,
        workspaceRoot: workDirectory,
        scratchDir: path.join(workDirectory, 'discovery'),
        workspaceConfiguration: {} as vscode.WorkspaceConfiguration,
        cancellationToken: {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        },
      });
      expect(discovered.axiRoutes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ instancePath: '/control_0', baseAddress: 0x44a00000 }),
          expect.objectContaining({ instancePath: '/neighbour_0', baseAddress: 0x44a01000 }),
        ])
      );
      const passingPlan = buildSystemVerificationPlan(
        fixtureConfig,
        discovered,
        parseMemoryMap(memoryMapText).map
      );
      expect(passingPlan.route).toMatchObject({
        addressSegmentPath: '/control_0/s_axi/reg0',
        baseAddress: 0x44a00000,
        addressRange: 0x1000,
      });

      const passingScaffold = scaffoldSystemVerification({
        config: fixtureConfig,
        plan: passingPlan,
        memoryMapText,
        outputDirectory: verificationDirectory,
      });
      for (const [relativePath, contents] of Object.entries(passingScaffold)) {
        expect(
          fs.readFileSync(path.join(vivadoFixtureDirectory, 'verification', relativePath), 'utf8')
        ).toBe(contents);
      }
      writeScaffold(verificationDirectory, passingScaffold);

      const passingResult = spawnSync(
        'make',
        ['run', `VIVADO=${VIVADO_BIN}`, 'WAVES=0', `RUN_DIR=${passingRunDirectory}`],
        { cwd: verificationDirectory, encoding: 'utf8', timeout: 600_000 }
      );
      expect(passingResult.error).toBeUndefined();
      if (passingResult.status !== 0) {
        throw new Error(
          `make run failed with exit ${passingResult.status}\n` +
            `stdout:\n${passingResult.stdout}\nstderr:\n${passingResult.stderr}`
        );
      }
      expect(`${passingResult.stdout}\n${passingResult.stderr}`).toContain(
        'IPCraft system verification passed'
      );
      expect(passingResult.status).toBe(0);
      expect(readResult(passingRunDirectory)).toMatchObject({ outcome: 'passed' });

      const wrongMemoryMapText = memoryMapText.replace(
        '          resetValue: 0\n',
        '          resetValue: 0xDEADBEEF\n'
      );
      expect(wrongMemoryMapText).not.toBe(memoryMapText);
      const wrongPlan = buildSystemVerificationPlan(
        fixtureConfig,
        discovered,
        parseMemoryMap(wrongMemoryMapText).map
      );
      fs.writeFileSync(path.join(memoryMapDirectory, 'control.mm.yml'), wrongMemoryMapText, 'utf8');
      writeScaffold(
        verificationDirectory,
        scaffoldSystemVerification({
          config: fixtureConfig,
          plan: wrongPlan,
          memoryMapText: wrongMemoryMapText,
          outputDirectory: verificationDirectory,
        })
      );

      const failingResult = spawnSync(
        'make',
        ['run', `VIVADO=${VIVADO_BIN}`, 'WAVES=0', `RUN_DIR=${failingRunDirectory}`],
        { cwd: verificationDirectory, encoding: 'utf8', timeout: 600_000 }
      );
      expect(failingResult.error).toBeUndefined();
      expect(failingResult.status).not.toBe(0);
      expect(readResult(failingRunDirectory)).toMatchObject({
        outcome: 'failed',
        firstFailure: expect.stringMatching(
          /CONTROL.*address=0x44A00004.*expected=0xDEADBEEF.*observed=0x00000000/i
        ),
      });
    } finally {
      fs.rmSync(workDirectory, { recursive: true, force: true });
    }
  }, 1_300_000);
});
