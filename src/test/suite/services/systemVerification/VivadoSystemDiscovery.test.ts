import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TemplateLoader } from '../../../../generator/TemplateLoader';
import { Logger } from '../../../../utils/Logger';
import discoveryOutput from '../../../fixtures/system-verification/discovery-output.json';
import * as buildRunner from '../../../../services/BuildRunner';
import {
  VivadoSystemDiscovery,
  VivadoSystemDiscoveryRequest,
} from '../../../../services/systemVerification/VivadoSystemDiscovery';
import type { SystemVerificationConfig } from '../../../../domain/systemVerification.types';
import type { VivadoToolchain } from '../../../../services/toolchains/VivadoToolchain';

jest.mock('../../../../services/BuildRunner');

const runProcess = buildRunner.runProcess as jest.Mock;

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

describe('VivadoSystemDiscovery', () => {
  let workspaceRoot: string;
  let scratchDir: string;
  let manifestPath: string;
  let request: VivadoSystemDiscoveryRequest;
  let discovery: VivadoSystemDiscovery;
  const workspaceConfiguration = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;
  const resolve = jest.fn();
  const getDocker = jest.fn();
  const getLaunchEnv = jest.fn();
  const toolchain = {
    resolve,
    getDocker,
    getLaunchEnv,
  } as unknown as VivadoToolchain;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-discovery-workspace-'));
    scratchDir = path.join(workspaceRoot, '.ipcraft-discovery');
    manifestPath = path.join(scratchDir, 'discovery-manifest.json');
    await fs.mkdir(path.dirname(path.join(workspaceRoot, config.recreateScript)), {
      recursive: true,
    });
    await fs.writeFile(path.join(workspaceRoot, config.recreateScript), '# recreate\n', 'utf8');

    resolve.mockReturnValue({ exe: 'vivado', prefixArgs: [] });
    getDocker.mockReturnValue(undefined);
    getLaunchEnv.mockReturnValue({ env: {}, extraMounts: [] });
    runProcess.mockResolvedValue({ success: true, exitCode: 0 });

    request = {
      mode: 'preConfiguration',
      recreateScript: config.recreateScript,
      workspaceRoot,
      scratchDir,
      workspaceConfiguration,
      cancellationToken: { isCancellationRequested: false } as vscode.CancellationToken,
    };
    discovery = new VivadoSystemDiscovery(
      toolchain,
      path.join(process.cwd(), 'src', 'generator', 'templates')
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('parses typed boundary shape and exact mapped-to-slave address binding', async () => {
    await expect(
      discovery.parseManifest(JSON.stringify(discoveryOutput), manifestPath)
    ).resolves.toMatchObject({
      wrapperLanguage: 'VHDL',
      boundaryInterfaces: [
        expect.objectContaining({ path: '/S_AXI_TEST', addressWidth: 32, dataWidth: 32 }),
      ],
      boundaryPorts: [
        expect.objectContaining({ path: '/sys_clk', type: 'clock', width: 1 }),
        expect.objectContaining({ path: '/sys_rst_n', type: 'reset', width: 1 }),
      ],
      axiRoutes: [
        expect.objectContaining({
          mappedSegmentPath: '/S_AXI_TEST/SEG_control_0_reg0',
          addressSegmentPath: '/control_0/s_axi/reg0',
        }),
      ],
    });
  });

  it('runs Vivado in batch mode inside the supplied scratch directory', async () => {
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(discoveryOutput), 'utf8');

    await discovery.discover(request);

    expect(runProcess).toHaveBeenCalledWith(
      'vivado',
      expect.arrayContaining([
        '-mode',
        'batch',
        '-source',
        expect.stringContaining('discover.tcl'),
      ]),
      expect.objectContaining({ cwd: scratchDir })
    );
    expect(resolve).toHaveBeenCalledWith('vivado', workspaceConfiguration, undefined);
    expect(getDocker).toHaveBeenCalledWith(workspaceConfiguration, scratchDir, undefined);
    expect(getLaunchEnv).toHaveBeenCalledWith(workspaceConfiguration);
  });

  it('discovers the current design without requiring a filename-derived expected name', async () => {
    let generatedTcl = '';
    runProcess.mockImplementation(async (_exe: string, args: string[]) => {
      const sourceIndex = args.indexOf('-source');
      generatedTcl = await fs.readFile(args[sourceIndex + 1], 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify(discoveryOutput), 'utf8');
      return { success: true, exitCode: 0 };
    });

    const result = await discovery.discover(request);

    expect(result.designName).toBe('system');
    expect(generatedTcl).not.toContain("Expected block design ''");
  });

  it('still verifies an explicitly expected design name when supplied', async () => {
    let generatedTcl = '';
    runProcess.mockImplementation(async (_exe: string, args: string[]) => {
      const sourceIndex = args.indexOf('-source');
      generatedTcl = await fs.readFile(args[sourceIndex + 1], 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify(discoveryOutput), 'utf8');
      return { success: true, exitCode: 0 };
    });

    await discovery.discover({
      mode: 'preConfiguration',
      recreateScript: config.recreateScript,
      expectedDesignName: 'system',
      workspaceRoot,
      scratchDir,
      workspaceConfiguration,
      cancellationToken: request.cancellationToken,
    });

    expect(generatedTcl).toContain('set expected_design_name "system"');
    expect(generatedTcl).toContain('$expected_design_name ne ""');
  });

  it('preserves the complete-config discovery request with exact design validation', async () => {
    let generatedTcl = '';
    runProcess.mockImplementation(async (_exe: string, args: string[]) => {
      const sourceIndex = args.indexOf('-source');
      generatedTcl = await fs.readFile(args[sourceIndex + 1], 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify(discoveryOutput), 'utf8');
      return { success: true, exitCode: 0 };
    });

    await discovery.discover({
      config,
      workspaceRoot,
      scratchDir,
      workspaceConfiguration,
      cancellationToken: request.cancellationToken,
    });

    expect(generatedTcl).toContain('set expected_design_name "system"');
    expect(generatedTcl).toContain('hardware/system/create_system.tcl');
  });

  it('sources the recreation script before performing discovery queries', async () => {
    let generatedTcl = '';
    runProcess.mockImplementation(async (_exe: string, args: string[]) => {
      const sourceIndex = args.indexOf('-source');
      generatedTcl = await fs.readFile(args[sourceIndex + 1], 'utf8');
      await fs.writeFile(manifestPath, JSON.stringify(discoveryOutput), 'utf8');
      return { success: true, exitCode: 0 };
    });

    await discovery.discover(request);

    expect(generatedTcl.indexOf('source $recreate_script')).toBeGreaterThan(-1);
    expect(generatedTcl.indexOf('source $recreate_script')).toBeLessThan(
      generatedTcl.indexOf('get_bd_intf_ports')
    );
  });

  it('binds each boundary address-space mapping to its exact downstream slave segment', async () => {
    const tclDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-discovery-tcl-'));
    const recreateScript = path.join(tclDir, 'recreate.tcl');
    const discoverScript = path.join(tclDir, 'discover.tcl');
    const manifest = path.join(tclDir, 'manifest.json');
    const workDir = path.join(tclDir, 'work');
    const harness = path.join(tclDir, 'harness.tcl');
    const templates = new TemplateLoader(
      new Logger('VivadoSystemDiscovery.test'),
      path.join(process.cwd(), 'src', 'generator', 'templates')
    );

    await fs.writeFile(recreateScript, '# recreated by the harness\n', 'utf8');
    await fs.writeFile(
      discoverScript,
      templates.render('system_verification_discover.tcl.j2', {
        recreateScript,
        designName: 'system',
        manifestPath: manifest,
        workDir,
      }),
      'utf8'
    );
    await fs.writeFile(
      harness,
      `
proc current_bd_design {args} { return system }
proc current_project {} { return project }
proc get_bd_intf_ports {args} {
    if {[llength $args] == 1 && [lindex $args 0] eq "-quiet"} { return {boundary gpio_boundary} }
    return boundary
}
proc get_bd_ports {args} {
    if {[lsearch -exact $args -of_objects] >= 0} { return boundary_awaddr }
    return {sys_clk sys_rst_n}
}
proc get_bd_addr_spaces {args} { return boundary_space }
proc get_bd_intf_pins {args} {
    set object [lindex $args end]
    if {$object eq "control_slave"} { return control_pin }
    if {$object eq "extra_slave"} { return extra_pin }
    return {}
}
proc get_bd_cells {args} {
    if {[lsearch -exact $args -of_objects] >= 0} {
        set object [lindex $args end]
        if {$object eq "control_pin"} { return control_cell }
        if {$object eq "extra_pin"} { return extra_cell }
    }
    return {control_cell extra_cell}
}
proc get_bd_addr_segs {args} {
    set object [lindex $args end]
    if {$object eq "boundary_space"} { return {control_primary control_alias extra_mapped} }
    if {$object eq "control_primary" || $object eq "control_alias"} { return control_slave }
    if {$object eq "extra_mapped"} { return extra_slave }
    return {}
}
proc get_property {args} {
    set property [lindex $args end-1]
    set object [lindex $args end]
    array set values {
        boundary,PATH /S_AXI_TEST
        boundary,NAME S_AXI_TEST
        boundary,MODE Slave
        boundary,CONFIG.PROTOCOL AXI4-Lite
        boundary,CONFIG.ADDR_WIDTH 32
        boundary,CONFIG.DATA_WIDTH 32
        gpio_boundary,PATH /led_8bits
        gpio_boundary,NAME led_8bits
        gpio_boundary,MODE Master
        boundary_awaddr,NAME S_AXI_TEST_awaddr
        boundary_awaddr,DIR I
        boundary_awaddr,LEFT 31
        boundary_awaddr,RIGHT 0
        sys_clk,PATH /sys_clk
        sys_clk,TYPE clk
        sys_clk,DIR I
        sys_clk,INTF FALSE
        sys_rst_n,PATH /sys_rst_n
        sys_rst_n,TYPE rst
        sys_rst_n,DIR I
        sys_rst_n,INTF FALSE
        control_pin,PATH /control_0/S_AXI
        extra_pin,PATH /control_0_extra/S_AXI
        control_cell,PATH /control_0
        extra_cell,PATH /control_0_extra
        control_slave,PATH /control_0/S_AXI/reg0
        extra_slave,PATH /control_0_extra/S_AXI/reg0
        control_primary,PATH /S_AXI_TEST/SEG_control_0_reg0
        control_primary,OFFSET 0x44A00000
        control_primary,RANGE 0x20
        control_alias,PATH /S_AXI_TEST/SEG_control_0_alias
        control_alias,OFFSET 0x44B00000
        control_alias,RANGE 0x20
        extra_mapped,PATH /S_AXI_TEST/SEG_control_0_extra_reg0
        extra_mapped,OFFSET 0x44C00000
        extra_mapped,RANGE 0x20
        project,TARGET_LANGUAGE Verilog
    }
    if {[info exists values($object,$property)]} { return $values($object,$property) }
    return {}
}
source {${discoverScript}}
`,
      'utf8'
    );

    const result = spawnSync('tclsh', [harness], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    const parsedManifest = JSON.parse(await fs.readFile(manifest, 'utf8'));
    expect(parsedManifest.boundaryPorts).toEqual([
      { path: '/sys_clk', type: 'clock', direction: 'in', width: 1 },
      { path: '/sys_rst_n', type: 'reset', direction: 'in', width: 1 },
    ]);
    expect(parsedManifest.boundaryInterfaces).toEqual([
      expect.objectContaining({ path: '/S_AXI_TEST', protocol: 'AXI4-Lite' }),
    ]);
    expect(parsedManifest.axiRoutes).toEqual([
      expect.objectContaining({
        instancePath: '/control_0',
        addressSegmentPath: '/control_0/S_AXI/reg0',
        baseAddress: 0x44a00000,
      }),
      expect.objectContaining({
        instancePath: '/control_0',
        addressSegmentPath: '/control_0/S_AXI/reg0',
        baseAddress: 0x44b00000,
      }),
      expect.objectContaining({
        instancePath: '/control_0_extra',
        addressSegmentPath: '/control_0_extra/S_AXI/reg0',
        baseAddress: 0x44c00000,
      }),
    ]);

    await fs.rm(tclDir, { recursive: true, force: true });
  });

  it('rejects malformed discovery JSON with its source path', async () => {
    await expect(discovery.parseManifest('{bad}', manifestPath)).rejects.toThrow(manifestPath);
  });

  it('rejects schema-invalid discovery JSON with its source path', async () => {
    await expect(
      discovery.parseManifest(
        JSON.stringify({ ...discoveryOutput, axiRoutes: [{ protocol: 'AXI4-Lite' }] }),
        manifestPath
      )
    ).rejects.toThrow(manifestPath);
  });

  it('removes the scratch directory when discovery is cancelled before staging', async () => {
    await expect(
      discovery.discover({
        ...request,
        cancellationToken: { isCancellationRequested: true } as vscode.CancellationToken,
      })
    ).rejects.toThrow(/cancelled/);

    expect(existsSync(scratchDir)).toBe(false);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('forwards active cancellation to the process and cleans the scratch directory', async () => {
    let cancellationListener: (() => void) | undefined;
    let resolveProcess: ((result: { success: boolean; exitCode: number }) => void) | undefined;
    let cancellationRequested = false;
    const cancellationToken = {
      get isCancellationRequested() {
        return cancellationRequested;
      },
      onCancellationRequested: jest.fn((listener: () => void) => {
        cancellationListener = () => {
          cancellationRequested = true;
          listener();
        };
        return { dispose: jest.fn() };
      }),
    } as unknown as vscode.CancellationToken;
    runProcess.mockImplementation(
      (
        _executable: string,
        _args: string[],
        options: { cancellationToken?: vscode.CancellationToken }
      ) =>
        new Promise<{ success: boolean; exitCode: number }>((resolve) => {
          options.cancellationToken?.onCancellationRequested(() =>
            resolve({ success: false, exitCode: -1 })
          );
          resolveProcess = resolve;
        })
    );

    const pending = discovery.discover({ ...request, cancellationToken });
    while (!resolveProcess) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    cancellationListener?.();
    resolveProcess?.({ success: false, exitCode: -1 });

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(runProcess).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cancellationToken })
    );
    expect(existsSync(scratchDir)).toBe(false);
  });
});
