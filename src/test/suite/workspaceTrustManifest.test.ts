import * as fs from 'fs';
import * as path from 'path';

interface CommandContribution {
  command: string;
  enablement?: string;
}

interface Manifest {
  capabilities?: {
    untrustedWorkspaces?: {
      supported?: string | boolean;
      description?: string;
      restrictedConfigurations?: string[];
    };
  };
  contributes?: { commands?: CommandContribution[] };
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
) as Manifest;

const TRUST_REQUIRED_COMMANDS = [
  'fpga-ip-core.editInIpPackager',
  'fpga-ip-core.editInPlatformDesigner',
  'fpga-ip-core.generateHdl',
  'fpga-ip-core.scaffoldProject',
  'fpga-ip-core.exportAltera',
  'fpga-ip-core.exportXilinx',
  'fpga-ip-core.generateTestbench',
  'fpga-ip-core.generateDocumentation',
  'fpga-ip-core.generateVivadoProject',
  'fpga-ip-core.generateQuartusProject',
  'fpga-ip-core.generateAndBuildVivado',
  'fpga-ip-core.generateAndBuildQuartus',
  'fpga-ip-core.buildVivadoOoc',
  'fpga-ip-core.buildQuartusCompile',
  'fpga-ip-core.parseVHDL',
  'fpga-ip-core.parseHwTcl',
  'fpga-ip-core.parseComponentXml',
  'fpga-ip-core.scanVivadoCatalog',
  'fpga-ip-core.scanVivadoInterfaces',
  'fpga-ip-core.build',
  'fpga-ip-core.openInVivado',
  'fpga-ip-core.openInQuartus',
  'fpga-ip-core.previewTemplateOutput',
];

const RESTRICTED_CONFIGURATIONS = [
  'ipcraft.scaffoldPackPaths',
  'ipcraft.generate.scaffoldPack',
  'ipcraft.vivado.runner',
  'ipcraft.vivado.installDir',
  'ipcraft.vivado.dockerImage',
  'ipcraft.quartus.runner',
  'ipcraft.quartus.installDir',
  'ipcraft.quartus.dockerImage',
];

describe('workspace trust manifest contract', () => {
  it('declares limited untrusted workspace support with a useful description', () => {
    const capability = manifest.capabilities?.untrustedWorkspaces;
    expect(capability?.supported).toBe('limited');
    expect(capability?.description).toContain('Restricted Mode');
  });

  it('disables every execution-capable command in Restricted Mode', () => {
    const commands = new Map(
      manifest.contributes?.commands?.map((command) => [command.command, command]) ?? []
    );

    for (const commandId of TRUST_REQUIRED_COMMANDS) {
      expect(commands.get(commandId)?.enablement).toContain('isWorkspaceTrusted');
    }
  });

  it('declares settings that can redirect templates or external tools as restricted', () => {
    const restricted = manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations;
    expect(restricted).toEqual(expect.arrayContaining(RESTRICTED_CONFIGURATIONS));
  });

  it('keeps representative read-only commands enabled in Restricted Mode', () => {
    const commands = new Map(
      manifest.contributes?.commands?.map((command) => [command.command, command]) ?? []
    );
    const readOnlyCommands = [
      'fpga-ip-core.viewBusDefinitions',
      'fpga-ip-core.scanWorkspaceBusDefinitions',
      'fpga-ip-core.showBuildOutput',
      'fpga-ip-core.checkHdlConsistency',
      'fpga-ip-core.checkConsistency',
      'fpga-ip-core.copyComponentInstance',
      'fpga-ip-core.openAsText',
      'fpga-ip-core.openAsVisual',
      'fpga-ip-core.previewInIpcraft',
    ];

    for (const commandId of readOnlyCommands) {
      expect(commands.get(commandId)).toBeDefined();
      expect(commands.get(commandId)?.enablement ?? '').not.toContain('isWorkspaceTrusted');
    }
  });
});
