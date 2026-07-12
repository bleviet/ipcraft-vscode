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
});
