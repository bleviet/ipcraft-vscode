import type { TemplateLoader } from '../TemplateLoader';
import type { ResourceRoots } from '../../services/ResourceRoots';
import { quartusDeviceFamily } from '../../services/toolchains/QuartusToolchain';
import type { HdlLanguage, IpCoreData } from '../types';
import { loadIpCoreData } from '../loadIpCore';
import { loadBoardDefinition } from './BoardDefinitionLoader';
import { resolveBoardPortMap, buildPinAssignments, netPortName } from './pinAssignment';
import { primaryBoardClockConstraint } from './boardSdc';

export interface BoardProjectOptions {
  ipYamlPath: string;
  boardYamlPath: string;
  resourceRoots: ResourceRoots;
  templates: TemplateLoader;
  hdlLanguage?: HdlLanguage;
  /**
   * RTL files declared by the IP's fileSets, relative to the .ip.yml directory
   * (e.g. "../../common/rtl/led_blink.sv"). Defaults to whatever the IP's own
   * fileSets declare — the board flow does not regenerate IP-level RTL.
   */
  ipRtlFiles?: string[];
}

export interface BoardProjectResult {
  files: Record<string, string>;
  wrapperName: string;
}

/** Cycles a synthesized power-on reset holds after configuration when the IP has an
 *  external reset that could not be mapped to a board net. */
const POR_WIDTH = 4;
const POR_CYCLES = 16;

type FileSetEntry = { name?: string; files?: Array<{ path?: string; type?: string }> };
const HDL_FILESET_TYPES = new Set(['vhdl', 'systemverilog']);

/** RTL files declared in the IP's own fileSets, relative to the .ip.yml directory. */
export function resolveIpRtlFiles(ipCoreData: IpCoreData): string[] {
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;
  return (fileSets ?? [])
    .flatMap((fs) => fs.files ?? [])
    .filter(
      (f): f is { path: string; type: string } =>
        Boolean(f.path) && HDL_FILESET_TYPES.has(f.type ?? '')
    )
    .map((f) => f.path);
}

/**
 * Generate a programmable Quartus board project for an IP core: a board-top wrapper
 * instantiating the IP with board clock/reset nets, real pin + I/O-standard assignments,
 * and a board-mode SDC — closing the board-level gap left by the IP-OOC/virtual-pin
 * project (see QuartusToolchain.scaffold). Pure/deterministic: the same inputs always
 * produce byte-identical output.
 */
export async function scaffoldBoardProject(opts: BoardProjectOptions): Promise<BoardProjectResult> {
  const ipCoreData = await loadIpCoreData(opts.ipYamlPath, opts.resourceRoots);
  const board = await loadBoardDefinition(opts.boardYamlPath, opts.resourceRoots);
  const hdlLanguage: HdlLanguage = opts.hdlLanguage ?? 'systemverilog';
  const isSv = hdlLanguage === 'systemverilog';

  const name = String(ipCoreData.vlnv?.name ?? 'ip_core').toLowerCase();
  const wrapperName = `${name}_board_top`;

  const { map: ipPortMap, errors: mapErrors } = resolveBoardPortMap(ipCoreData, board);
  if (mapErrors.length > 0) {
    throw new Error(`Board port mapping failed: ${mapErrors.join('; ')}`);
  }

  // ---- Clock ------------------------------------------------------------------
  // Clocks and resets always map 1:1 to a single board net (never width > 1).
  const primaryClock = ipCoreData.clocks?.[0];
  const clockIpPort = primaryClock?.name;
  const clockNet = clockIpPort ? (ipPortMap[clockIpPort] as string | undefined) : undefined;
  const clockWrapperPort = clockNet ? netPortName(clockNet) : undefined;

  // ---- Reset: external board reset, or a synthesized power-on reset -----------
  const primaryReset = ipCoreData.resets?.[0];
  const resetIpPort = primaryReset?.name;
  const resetNet = resetIpPort ? (ipPortMap[resetIpPort] as string | undefined) : undefined;
  const hasPor = Boolean(resetIpPort) && !resetNet;
  const resetWrapperPort = resetNet ? netPortName(resetNet) : undefined;

  const ipResetActiveHigh = String(primaryReset?.polarity ?? 'activeHigh')
    .toLowerCase()
    .includes('high');
  let resetConnectionSignal: string | undefined;
  let resetInvert = false;
  if (hasPor) {
    resetConnectionSignal = 'por_done';
    resetInvert = !ipResetActiveHigh;
  } else if (resetNet) {
    const boardReset = board.resets.find((r) => r.name === resetNet);
    const boardResetActiveHigh = boardReset?.polarity === 'activeHigh';
    resetConnectionSignal = resetWrapperPort;
    resetInvert = boardResetActiveHigh !== ipResetActiveHigh;
  }

  // ---- User ports ---------------------------------------------------------------
  // Width-1 ports keep the board net's own name as the wrapper port (e.g. "led0"
  // for LED0). Width-N ports span multiple nets (one pin per bit), so there is no
  // single net to name the port after — use the IP's own port name instead.
  const userPorts = (ipCoreData.ports ?? [])
    .filter((p): p is typeof p & { name: string } => Boolean(p.name))
    .map((p) => {
      const net = ipPortMap[p.name];
      const width = Number(p.width) > 0 ? Number(p.width) : 1;
      const wrapperPort =
        width === 1 && typeof net === 'string' ? netPortName(net) : p.name.toLowerCase();
      return {
        ip_port: p.name,
        wrapper_port: wrapperPort,
        direction: p.direction === 'in' ? 'in' : 'out',
        width,
      };
    });

  // ---- Board top wrapper --------------------------------------------------------
  const wrapperTemplate = isSv ? 'board_top.sv.j2' : 'board_top.vhdl.j2';
  const wrapperFileName = `${wrapperName}.${isSv ? 'sv' : 'vhd'}`;

  const wrapperContent = opts.templates.render(wrapperTemplate, {
    entity_name: wrapperName,
    ip_entity_name: name,
    clock_wrapper_port: clockWrapperPort,
    clock_ip_port: clockIpPort,
    reset_wrapper_port: hasPor ? undefined : resetWrapperPort,
    reset_ip_port: resetIpPort,
    reset_connection_signal: resetConnectionSignal,
    reset_invert: resetInvert,
    has_por: hasPor,
    por_width: POR_WIDTH,
    por_cycles: POR_CYCLES,
    user_ports: userPorts,
  });

  // ---- Pin assignments (against the wrapper's own port list) --------------------
  const wrapperPinMap: Record<string, string | string[]> = {};
  const wrapperTopLevelPorts: string[] = [];
  if (clockWrapperPort && clockNet) {
    wrapperPinMap[clockWrapperPort] = clockNet;
    wrapperTopLevelPorts.push(clockWrapperPort);
  }
  if (!hasPor && resetWrapperPort && resetNet) {
    wrapperPinMap[resetWrapperPort] = resetNet;
    wrapperTopLevelPorts.push(resetWrapperPort);
  }
  for (const p of userPorts) {
    wrapperPinMap[p.wrapper_port] = ipPortMap[p.ip_port];
    wrapperTopLevelPorts.push(p.wrapper_port);
  }

  const { assignments, errors: pinErrors } = buildPinAssignments(
    board,
    wrapperPinMap,
    wrapperTopLevelPorts
  );
  if (pinErrors.length > 0) {
    throw new Error(`Board pin assignment failed: ${pinErrors.join('; ')}`);
  }

  const pinsFileName = `${name}_board_pins.tcl`;
  const pinsContent = opts.templates.render('quartus_pins.tcl.j2', {
    entity_name: wrapperName,
    board_name: board.name,
    assignments,
  });

  // ---- Board SDC ------------------------------------------------------------------
  const sdcFileName = `${name}_board.sdc`;
  const sdcContent = opts.templates.render('quartus_board_sdc.j2', {
    entity_name: wrapperName,
    board_name: board.name,
    board_clock: primaryBoardClockConstraint(board),
  });

  // ---- Board project tcl -----------------------------------------------------------
  const projectFileName = `${name}_board_project.tcl`;
  const projectContent = opts.templates.render('quartus_board_project.tcl.j2', {
    entity_name: wrapperName,
    ip_entity_name: name,
    board_name: board.name,
    target_device: board.device,
    device_family: quartusDeviceFamily(board.device),
    wrapper_file: wrapperFileName,
    wrapper_hdl_type: isSv ? 'SYSTEMVERILOG_FILE' : 'VHDL_FILE',
    ip_rtl_files: opts.ipRtlFiles ?? resolveIpRtlFiles(ipCoreData),
    sdc_file: sdcFileName,
    pins_file: pinsFileName,
  });

  // ---- Makefile (terminal-friendly wrapper around the TCL/quartus_pgm commands above) ----
  const makefileContent = opts.templates.render('board_makefile.j2', {
    entity_name: wrapperName,
    board_name: board.name,
  });

  const files: Record<string, string> = {
    [`altera-board/${wrapperFileName}`]: wrapperContent,
    [`altera-board/${pinsFileName}`]: pinsContent,
    [`altera-board/${sdcFileName}`]: sdcContent,
    [`altera-board/${projectFileName}`]: projectContent,
    [`altera-board/Makefile`]: makefileContent,
  };

  return { files, wrapperName };
}
