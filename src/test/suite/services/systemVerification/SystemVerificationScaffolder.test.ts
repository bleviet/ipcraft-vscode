import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type {
  DiscoveredBoundaryInterface,
  DiscoveredBoundaryPort,
  SystemVerificationConfig,
  SystemVerificationPlan,
} from '../../../../domain/systemVerification.types';
import { scaffoldSystemVerification } from '../../../../services/systemVerification/SystemVerificationScaffolder';

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

const boundaryInterface: DiscoveredBoundaryInterface = {
  path: '/S_AXI_TEST',
  mode: 'Slave',
  protocol: 'AXI4LITE',
  addressWidth: 32,
  dataWidth: 32,
  signals: [],
};
const clockPort: DiscoveredBoundaryPort = {
  path: '/sys_clk',
  type: 'clock',
  direction: 'in',
  width: 1,
};
const resetPort: DiscoveredBoundaryPort = {
  path: '/sys_rst_n',
  type: 'reset',
  direction: 'in',
  width: 1,
};

const plan: SystemVerificationPlan = {
  route: {
    driveInterfacePath: '/S_AXI_TEST',
    instancePath: '/control_0',
    protocol: 'AXI4-Lite',
    baseAddress: 0x44a00000,
    addressRange: 0x20,
    busBytes: 4,
    addressWidth: 32,
    addressSegmentPath: '/control_0/S_AXI/reg0',
    mappedSegmentPath: '/S_AXI_TEST/SEG_control_0_reg0',
  },
  boundaryInterface,
  clockPort,
  resetPort,
  wrapperLanguage: 'VHDL',
  transactions: [
    {
      registerName: 'STATUS',
      address: 0x44a00000,
      vectors: [
        {
          kind: 'resetRead',
          address: 0x44a00000,
          expectedValue: 1,
          compareMask: 1,
          registerName: 'STATUS',
        },
      ],
    },
    {
      registerName: 'CONTROL',
      address: 0x44a00004,
      vectors: [
        {
          kind: 'writeReadback',
          address: 0x44a00004,
          writeValue: 3,
          expectedValue: 3,
          compareMask: 3,
          registerName: 'CONTROL',
        },
      ],
    },
  ],
};

const input = {
  config,
  plan,
  memoryMapText: 'name: control\naddressBlocks: []\n',
  outputDirectory: '/work/hardware/system/verification',
};

describe('SystemVerificationScaffolder', () => {
  it('renders the mandatory Makefile and VHDL BFM with resolved plan values', () => {
    const files = scaffoldSystemVerification(input);

    expect(Object.keys(files).sort()).toEqual([
      'Makefile',
      'scripts/run_xsim.tcl',
      'system-verification.yml',
      'tb/axi4lite_master_bfm.vhd',
      'tb/system_verification_tb.vhd',
    ]);
    expect(files.Makefile).toContain('run:');
    expect(files['tb/system_verification_tb.vhd']).toContain('44A00004');
  });

  it('refuses to clean an unowned run directory and removes an owned canonical run', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-make-clean-'));
    const projectRoot = path.join(tempDirectory, 'project');
    const outputDirectory = path.join(projectRoot, 'hardware', 'system', 'verification');
    const unownedDirectory = path.join(tempDirectory, 'unowned');
    const ownedDirectory = path.join(projectRoot, '.ipcraft', 'system-verification', 'run-1');
    const fakeBinDirectory = path.join(tempDirectory, 'fake-bin');
    const fakeRmRecord = path.join(tempDirectory, 'fake-rm-invoked');

    try {
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.mkdirSync(unownedDirectory, { recursive: true });
      fs.writeFileSync(path.join(unownedDirectory, 'sentinel'), 'keep', 'utf8');
      fs.mkdirSync(ownedDirectory, { recursive: true });
      fs.writeFileSync(path.join(ownedDirectory, '.ipcraft-system-verification-run'), '', 'utf8');
      fs.writeFileSync(
        path.join(outputDirectory, 'Makefile'),
        scaffoldSystemVerification({ ...input, outputDirectory }).Makefile,
        'utf8'
      );
      fs.mkdirSync(fakeBinDirectory);
      const fakeRmPath = path.join(fakeBinDirectory, 'rm');
      fs.writeFileSync(
        fakeRmPath,
        '#!/bin/sh\nprintf invoked > "$FAKE_RM_RECORD"\nexit 99\n',
        'utf8'
      );
      fs.chmodSync(fakeRmPath, 0o755);
      const guardedEnvironment = {
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_RM_RECORD: fakeRmRecord,
      };

      const refused = spawnSync('make', ['clean', `RUN_DIR=${unownedDirectory}`], {
        cwd: outputDirectory,
        encoding: 'utf8',
        env: guardedEnvironment,
      });
      expect(refused.status).not.toBe(0);
      expect(fs.existsSync(path.join(unownedDirectory, 'sentinel'))).toBe(true);
      expect(fs.existsSync(fakeRmRecord)).toBe(false);

      for (const unsafeDirectory of ['/', '..', projectRoot]) {
        const unsafe = spawnSync('make', ['clean', `RUN_DIR=${unsafeDirectory}`], {
          cwd: outputDirectory,
          encoding: 'utf8',
          env: guardedEnvironment,
        });
        expect(unsafe.status).not.toBe(0);
        expect(fs.existsSync(fakeRmRecord)).toBe(false);
      }

      const cleaned = spawnSync('make', ['clean', `RUN_DIR=${ownedDirectory}`], {
        cwd: outputDirectory,
        encoding: 'utf8',
      });
      expect(cleaned.status).toBe(0);
      expect(fs.existsSync(ownedDirectory)).toBe(false);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('refuses to clean through an intermediate symlink outside the project run root', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-make-clean-symlink-'));
    const projectRoot = path.join(tempDirectory, 'project');
    const outputDirectory = path.join(projectRoot, 'hardware', 'system', 'verification');
    const projectRunRoot = path.join(projectRoot, '.ipcraft', 'system-verification');
    const outsideRunDirectory = path.join(tempDirectory, 'outside', 'run-1');
    const linkedRunDirectory = path.join(projectRunRoot, 'link', 'run-1');

    try {
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.mkdirSync(projectRunRoot, { recursive: true });
      fs.mkdirSync(outsideRunDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(outsideRunDirectory, '.ipcraft-system-verification-run'),
        '',
        'utf8'
      );
      fs.writeFileSync(path.join(outsideRunDirectory, 'sentinel'), 'keep', 'utf8');
      fs.symlinkSync(
        path.join(tempDirectory, 'outside'),
        path.join(projectRunRoot, 'link'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      fs.writeFileSync(
        path.join(outputDirectory, 'Makefile'),
        scaffoldSystemVerification({ ...input, outputDirectory }).Makefile,
        'utf8'
      );

      const result = spawnSync('make', ['clean', `RUN_DIR=${linkedRunDirectory}`], {
        cwd: outputDirectory,
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/Refusing to clean unsafe RUN_DIR/);
      expect(fs.readFileSync(path.join(outsideRunDirectory, 'sentinel'), 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('preserves explicit configuration and plan values within the V1 runner scope', () => {
    const explicitInput = {
      ...input,
      config: {
        ...config,
        part: 'xczu3eg-sbva484-1-e',
        clockPeriodNs: 7.5,
        resetActiveLow: false,
        resetCycles: 9,
      },
    };
    const files = scaffoldSystemVerification(explicitInput);
    const makefile = files.Makefile;
    const runner = files['scripts/run_xsim.tcl'];
    const testbench = files['tb/system_verification_tb.vhd'];
    const bfm = files['tb/axi4lite_master_bfm.vhd'];

    expect(files['system-verification.yml']).toContain('part: xczu3eg-sbva484-1-e');
    expect(makefile).toMatch(/^run:/m);
    expect(makefile).toMatch(/^clean:/m);
    expect(makefile).toMatch(/^help:/m);
    expect(makefile).toContain(
      '$(VIVADO) -mode batch -source scripts/run_xsim.tcl -nojournal -nolog -tclargs "$(RUN_DIR_ABS)" "$(WAVES)"'
    );

    expect(runner).toContain('xczu3eg-sbva484-1-e');
    expect(runner).toContain('export_simulation');
    expect(runner).toContain('-exec');
    expect(runner).toContain('result.json');
    expect(runner.match(/IPCRAFT_LIFECYCLE:(discover|plan|compile)/g)).toEqual([
      'IPCRAFT_LIFECYCLE:discover',
      'IPCRAFT_LIFECYCLE:plan',
      'IPCRAFT_LIFECYCLE:compile',
    ]);
    expect(testbench).toContain('IPCRAFT_LIFECYCLE:run');
    expect(runner).toContain('write_result $run_dir failed');
    expect(runner).toContain('write_result $run_dir passed');

    expect(testbench).toContain('constant clockPeriod : time := 7.5 ns');
    expect(testbench).toContain('constant resetCycles : positive := 9');
    expect(testbench).toContain("constant resetAsserted : std_logic := '1'");
    expect(testbench).toContain('walking-one');
    expect(testbench).toContain('axi4lite_write_single');
    expect(testbench).toContain('axi4lite_read_single');
    expect(testbench).toContain(
      "signal wrapperAwValid : std_logic_vector(0 to 0) := (others => '0')"
    );
    expect(testbench).toContain('S_AXI_TEST_awvalid => wrapperAwValid');
    expect(testbench).toContain('wrapperAwValid(0) <= awValid');
    expect(testbench).toContain('awReady <= wrapperAwReady(0)');

    expect(bfm).toContain('write AW timeout');
    expect(bfm).toContain('write W timeout');
    expect(bfm).toContain('write B timeout');
    expect(bfm).toContain('read AR timeout');
    expect(bfm).toContain('read R timeout');
    expect(bfm).toContain('response error address=0x');
    expect(bfm).not.toMatch(/burst|axi_vip|cocotb|questa/i);
  });

  it('executes the Vivado-exported XSim flow without rebuilding lossy compiler commands', () => {
    const runner = scaffoldSystemVerification(input)['scripts/run_xsim.tcl'];

    expect(runner).toContain('export_simulation');
    expect(runner).toContain('-export_source_files');
    expect(runner).toContain('-exec');
    expect(runner).not.toContain('-of_objects [current_fileset -simset]');
    expect(runner).toContain('collect_simulation_diagnostics $export_dir');
    expect(runner).not.toMatch(/\bredirect\b/);
    expect(runner).not.toMatch(/\brun_command\b|\bxvhdl\b|\bxvlog\b|\bxelab\b/);
  });

  it('validates the recreated physical binding before reporting discover and plan lifecycle stages', () => {
    const runner = scaffoldSystemVerification(input)['scripts/run_xsim.tcl'];
    const validationCall = runner.indexOf('validate_runtime_binding');

    expect(validationCall).toBeGreaterThan(-1);
    expect(runner.indexOf('IPCRAFT_LIFECYCLE:discover')).toBeGreaterThan(validationCall);
    expect(runner).toContain('/control_0/S_AXI/reg0');
    expect(runner).toContain('/S_AXI_TEST/SEG_control_0_reg0');
    expect(runner).toContain('0x44A00000');
    expect(runner).toContain('current_bd_design');
    expect(runner).toContain('does not match configured design');
  });

  it('rejects an output layout that cannot resolve a workspace-relative recreation script', () => {
    expect(() =>
      scaffoldSystemVerification({
        ...input,
        outputDirectory: '/work/verification',
      })
    ).toThrow(/outputDirectory .* cannot resolve recreateScript/);
  });

  it('masks both sides of readback comparisons', () => {
    const unmaskedPlan: SystemVerificationPlan = {
      ...plan,
      transactions: [
        {
          registerName: 'MASKED',
          address: 0x44a00004,
          vectors: [
            {
              kind: 'resetRead',
              address: 0x44a00004,
              expectedValue: 0x81,
              compareMask: 0x01,
              registerName: 'MASKED',
            },
          ],
        },
      ],
    };

    const testbench = scaffoldSystemVerification({ ...input, plan: unmaskedPlan })[
      'tb/system_verification_tb.vhd'
    ];

    expect(testbench).toContain('(observedData and x"00000001") = (x"00000081" and x"00000001")');
  });

  it('writes the first actionable exported-simulation diagnostic to result.json', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-xsim-runner-'));
    const outputDirectory = path.join(tempDirectory, 'hardware', 'system', 'verification');
    const recreateScript = path.join(tempDirectory, config.recreateScript);
    const runnerPath = path.join(outputDirectory, 'scripts', 'run_xsim.tcl');
    const harnessPath = path.join(tempDirectory, 'harness.tcl');
    const runDirectory = path.join(tempDirectory, 'run');
    const exportArgsPath = path.join(tempDirectory, 'export-args.txt');
    const wrapperPath = path.join(tempDirectory, 'system_wrapper.vhd');

    try {
      const files = scaffoldSystemVerification({ ...input, outputDirectory });
      fs.mkdirSync(path.dirname(recreateScript), { recursive: true });
      fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
      fs.mkdirSync(path.join(outputDirectory, '..', 'ip'), { recursive: true });
      fs.writeFileSync(recreateScript, '# recreation stub\n', 'utf8');
      fs.writeFileSync(runnerPath, files['scripts/run_xsim.tcl'], 'utf8');
      fs.writeFileSync(
        path.join(outputDirectory, 'system-verification.yml'),
        files['system-verification.yml'],
        'utf8'
      );
      fs.writeFileSync(
        path.join(outputDirectory, '..', 'ip', 'control.mm.yml'),
        input.memoryMapText,
        'utf8'
      );
      fs.writeFileSync(
        wrapperPath,
        `entity system_wrapper is
  port (
    sys_clk : in STD_LOGIC;
    sys_rst_n : in STD_LOGIC
  );
end system_wrapper;
`,
        'utf8'
      );
      fs.writeFileSync(
        harnessPath,
        `
proc current_project {} { return project }
proc current_bd_design {} { return system }
proc get_property {args} {
    set property [lindex $args end-1]
    set object [lindex $args end]
    if {$property eq "PART"} { return "xc7z020clg484-1" }
    array set values {
        project,TARGET_LANGUAGE VHDL
        boundary,PATH /S_AXI_TEST
        boundary,NAME S_AXI_TEST
        boundary,MODE Slave
        boundary,CONFIG.PROTOCOL AXI4LITE
        boundary,CONFIG.ADDR_WIDTH 32
        boundary,CONFIG.DATA_WIDTH 32
        clock,TYPE clk
        clock,DIR I
        reset,TYPE rst
        reset,DIR I
        mapped,PATH /S_AXI_TEST/SEG_control_0_reg0
        mapped,OFFSET 0x44A00000
        mapped,RANGE 0x20
        slave,PATH /control_0/S_AXI/reg0
        cell,PATH /control_0
    }
    if {[info exists values($object,$property)]} { return $values($object,$property) }
    return ""
}
proc get_files {args} { return [list system.bd] }
proc get_filesets {args} { return sim_1 }
proc current_fileset {args} { return sim_1 }
proc get_bd_intf_ports {args} { return boundary }
proc get_bd_ports {args} {
    if {[lsearch -exact $args -of_objects] >= 0} { return {} }
    set path [lindex $args end]
    if {$path eq "/sys_clk"} { return clock }
    if {$path eq "/sys_rst_n"} { return reset }
    return {}
}
proc get_bd_addr_spaces {args} { return address_space }
proc get_bd_addr_segs {args} {
    if {[lsearch -exact $args -of_objects] < 0} { return mapped }
    set object [lindex $args end]
    if {$object eq "address_space"} { return mapped }
    if {$object eq "mapped"} { return slave }
    return {}
}
proc get_bd_intf_pins {args} { return pin }
proc get_bd_cells {args} { return cell }
proc generate_target {args} {}
proc make_wrapper {args} { return [list $::env(WRAPPER_PATH)] }
proc add_files {args} {}
proc set_property {args} {}
proc update_compile_order {args} {}
proc export_ip_user_files {args} {}
proc export_simulation {args} {
    set handle [open $::env(EXPORT_ARGS_FILE) w]
    puts $handle [join $args " "]
    close $handle
    set directoryIndex [lsearch -exact $args -directory]
    set exportDirectory [lindex $args [expr {$directoryIndex + 1}]]
    file mkdir [file join $exportDirectory xsim]
    set logHandle [open [file join $exportDirectory xsim simulate.log] w]
    puts $logHandle {INFO: starting exported XSim flow}
    puts $logHandle {ERROR: [XSIM 43-3322] CONTROL address=0x44A00004 response=SLVERR}
    close $logHandle
    return
}
set argv [list $::env(RUN_DIR) 0]
source $::env(RUNNER_PATH)
`,
        'utf8'
      );

      const result = spawnSync('tclsh', [harnessPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPORT_ARGS_FILE: exportArgsPath,
          RUN_DIR: runDirectory,
          RUNNER_PATH: runnerPath,
          WRAPPER_PATH: wrapperPath,
        },
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain('INFO: starting exported XSim flow');
      expect(JSON.parse(fs.readFileSync(path.join(runDirectory, 'result.json'), 'utf8'))).toEqual({
        outcome: 'failed',
        firstFailure: 'ERROR: [XSIM 43-3322] CONTROL address=0x44A00004 response=SLVERR',
        route: {
          driveInterfacePath: '/S_AXI_TEST',
          instancePath: '/control_0',
          baseAddress: 0x44a00000,
        },
      });
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('fails before recreation when the tracked configuration drifts from the reviewed plan', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-binding-drift-'));
    const outputDirectory = path.join(tempDirectory, 'hardware', 'system', 'verification');
    const recreateScript = path.join(tempDirectory, config.recreateScript);
    const runnerPath = path.join(outputDirectory, 'scripts', 'run_xsim.tcl');
    const harnessPath = path.join(tempDirectory, 'harness.tcl');
    const runDirectory = path.join(tempDirectory, 'run');

    try {
      const files = scaffoldSystemVerification({ ...input, outputDirectory });
      fs.mkdirSync(path.dirname(recreateScript), { recursive: true });
      fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
      fs.mkdirSync(path.join(outputDirectory, '..', 'ip'), { recursive: true });
      fs.writeFileSync(recreateScript, '# recreation stub\n', 'utf8');
      fs.writeFileSync(runnerPath, files['scripts/run_xsim.tcl'], 'utf8');
      fs.writeFileSync(
        path.join(outputDirectory, 'system-verification.yml'),
        files['system-verification.yml'].replace('resetCycles: 5', 'resetCycles: 6'),
        'utf8'
      );
      fs.writeFileSync(
        path.join(outputDirectory, '..', 'ip', 'control.mm.yml'),
        input.memoryMapText,
        'utf8'
      );
      fs.writeFileSync(
        harnessPath,
        `
proc current_project {} { return project }
proc current_bd_design {} { return system }
proc get_property {property object} {
    if {$property eq "PART"} { return "xc7z020clg484-1" }
    if {$property eq "TARGET_LANGUAGE"} { return "VHDL" }
    return ""
}
proc get_files {args} { return [list system.bd] }
proc get_filesets {args} { return sim_1 }
proc generate_target {args} {}
proc make_wrapper {args} { return [list system_wrapper.vhd] }
proc add_files {args} {}
proc set_property {args} {}
proc update_compile_order {args} {}
proc export_ip_user_files {args} {}
proc export_simulation {args} {}
set argv [list $::env(RUN_DIR) 0]
source $::env(RUNNER_PATH)
`,
        'utf8'
      );

      const result = spawnSync('tclsh', [harnessPath], {
        encoding: 'utf8',
        env: { ...process.env, RUN_DIR: runDirectory, RUNNER_PATH: runnerPath },
      });

      expect(result.status).toBe(1);
      expect(
        JSON.parse(fs.readFileSync(path.join(runDirectory, 'result.json'), 'utf8'))
      ).toMatchObject({
        outcome: 'failed',
        firstFailure: expect.stringMatching(/tracked configuration.*drift/i),
      });
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
