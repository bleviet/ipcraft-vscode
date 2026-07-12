import * as path from 'path';
import { Logger } from '../../../../utils/Logger';
import { TemplateLoader } from '../../../../generator/TemplateLoader';
import { devResourceRoots } from '../../../../services/ResourceRoots';
import {
  scaffoldBoardProject,
  type BoardProjectOptions,
} from '../../../../generator/board/BoardProjectScaffolder';
import { builtinBoardPath } from '../../../../generator/board/BoardDefinitionLoader';

const repoRoot = path.resolve(__dirname, '../../../../..');
const resourceRoots = devResourceRoots(repoRoot);
const templates = new TemplateLoader(
  new Logger('BoardProjectScaffolder.test'),
  resourceRoots.templatesDir
);

const ipYamlPath = path.join(repoRoot, 'src', 'test', 'fixtures', 'led_blink-ipcore.yml');
const clockOnlyIpYamlPath = path.join(repoRoot, 'src', 'test', 'fixtures', 'clock_only-ipcore.yml');
const led8IpYamlPath = path.join(repoRoot, 'src', 'test', 'fixtures', 'led8-ipcore.yml');
const boardYamlPath = builtinBoardPath(resourceRoots, 'de10_nano.board.yml');

function baseOptions(): BoardProjectOptions {
  return {
    ipYamlPath,
    boardYamlPath,
    resourceRoots,
    templates,
    hdlLanguage: 'systemverilog',
  };
}

function clockOnlyOptions(): BoardProjectOptions {
  return {
    ...baseOptions(),
    ipYamlPath: clockOnlyIpYamlPath,
  };
}

function led8Options(): BoardProjectOptions {
  return {
    ...baseOptions(),
    ipYamlPath: led8IpYamlPath,
  };
}

describe('BoardProjectScaffolder', () => {
  it('AC #71.1 — board top instantiates led_blink, no VIRTUAL_PIN assignment', async () => {
    const { files, wrapperName } = await scaffoldBoardProject(baseOptions());

    expect(wrapperName).toBe('led_blink_board_top');

    const wrapper = files['altera-board/led_blink_board_top.sv'];
    expect(wrapper).toContain('module led_blink_board_top');
    expect(wrapper).toContain('led_blink u_core');
    // led_blink declares an external active-low reset (KEY0) — no synthesized POR needed.
    expect(wrapper).not.toContain('por_done');

    const project = files['altera-board/led_blink_board_project.tcl'];
    expect(project).not.toContain('set_instance_assignment -name VIRTUAL_PIN');
    expect(project).toContain('TOP_LEVEL_ENTITY led_blink_board_top');
  });

  // Regression: without this assignment, quartus_asm writes the .sof next to the
  // project files instead of output_files/ — verified live via a real Quartus
  // compile, which silently broke `make program`, the project's own printed
  // programming instructions, and BuildCommands' Fmax report parser (all of which
  // assume output_files/).
  it('sets PROJECT_OUTPUT_DIRECTORY so the .sof lands where the Makefile/report parser expect it', async () => {
    const { files } = await scaffoldBoardProject(baseOptions());
    const project = files['altera-board/led_blink_board_project.tcl'];
    expect(project).toContain('set_global_assignment -name PROJECT_OUTPUT_DIRECTORY output_files');
  });

  it('AC #71.2 — the board project references the generated board pins and board SDC', async () => {
    const { files } = await scaffoldBoardProject(baseOptions());
    const project = files['altera-board/led_blink_board_project.tcl'];

    expect(project).toContain('SDC_FILE led_blink_board.sdc');
    expect(project).toContain('source [file join $script_dir led_blink_board_pins.tcl]');

    expect(files['altera-board/led_blink_board_pins.tcl']).toContain(
      'set_location_assignment PIN_W15 -to led0'
    );
    expect(files['altera-board/led_blink_board.sdc']).toContain(
      'create_clock -period 20.000 -name fpga_clk1_50'
    );
  });

  it('AC #71.3 — determinism: re-running produces byte-identical files', async () => {
    const first = await scaffoldBoardProject(baseOptions());
    const second = await scaffoldBoardProject(baseOptions());
    expect(second.files).toEqual(first.files);
  });

  it('wires the board active-low KEY0 reset straight through to the IP active-low rst_n (no inversion)', async () => {
    const { files } = await scaffoldBoardProject(baseOptions());
    const wrapper = files['altera-board/led_blink_board_top.sv'];
    expect(wrapper).toContain('.rst_n (key0)');
  });

  it('clock-only IP (no reset, no user ports) produces valid port list with no trailing comma', async () => {
    const { files } = await scaffoldBoardProject(clockOnlyOptions());
    const wrapper = files['altera-board/clock_only_board_top.sv'];
    expect(wrapper).toBeDefined();
    // The clock line must not end with a comma when there are no subsequent ports.
    expect(wrapper).toContain('input  logic fpga_clk1_50\n);');
    expect(wrapper).not.toContain('fpga_clk1_50,');
  });

  // Regression for the real Quartus fitter error (176310: "Can't place multiple pins
  // assigned to pin location") hit when a width-8 port was collapsed onto one board
  // net/pin — verified live against the DE10-Nano board with `examples/led_avmm`.
  it('a width-8 user port gets one board pin per bit, not one pin for the whole bus', async () => {
    const { files } = await scaffoldBoardProject(led8Options());

    const wrapper = files['altera-board/led8_board_top.sv'];
    expect(wrapper).toContain('output logic [7:0] led');
    expect(wrapper).toContain('.led (led)');

    const pins = files['altera-board/led8_board_pins.tcl'];
    for (let i = 0; i < 8; i++) {
      expect(pins).toContain(`set_location_assignment PIN_`);
    }
    expect(pins).toContain('set_location_assignment PIN_W15 -to led[0]');
    expect(pins).toContain('set_location_assignment PIN_AA24 -to led[1]');
    expect(pins).toContain('set_location_assignment PIN_AA23 -to led[7]');
    // Each bit must be a distinct pin — no assignment shared across bits.
    const pinTokens = [...pins.matchAll(/set_location_assignment (\S+) -to led\[\d+\]/g)].map(
      (m) => m[1]
    );
    expect(pinTokens).toHaveLength(8);
    expect(new Set(pinTokens).size).toBe(8);
  });
});
