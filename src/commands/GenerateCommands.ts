/**
 * VS Code Commands for VHDL Code Generation
 *
 * Composition root: wires each generator-related command to its handler.
 * See GenerationCommands, VendorProjectCommands, ImportCommands, and
 * BusDefinitionCommands for the actual implementations.
 */

import * as vscode from 'vscode';
import { ResourceRoots } from '../services/ResourceRoots';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import {
  generateHdl,
  scaffoldProject,
  exportAltera,
  exportXilinx,
  generateTestbench,
  generateDocumentation,
} from './GenerationCommands';
import {
  generateVivadoProject,
  generateQuartusProject,
  generateAndBuildVivado,
  generateAndBuildQuartus,
} from './VendorProjectCommands';
import { parseVHDL, parseHwTcl, parseComponentXml } from './ImportCommands';
import { viewBusDefinitions } from './BusDefinitionCommands';

export function registerGeneratorCommands(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots
): void {
  safeRegisterCommand(
    context,
    'fpga-ip-core.generateHdl',
    async (uri?: vscode.Uri) => {
      await generateHdl(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.scaffoldProject',
    async (uri?: vscode.Uri) => {
      await scaffoldProject(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.exportAltera',
    async (uri?: vscode.Uri) => {
      await exportAltera(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.exportXilinx',
    async (uri?: vscode.Uri) => {
      await exportXilinx(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.generateVivadoProject',
    async (uri?: vscode.Uri) => {
      await generateVivadoProject(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.generateQuartusProject',
    async (uri?: vscode.Uri) => {
      await generateQuartusProject(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.generateAndBuildVivado',
    async (uri?: vscode.Uri) => {
      await generateAndBuildVivado(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.generateAndBuildQuartus',
    async (uri?: vscode.Uri) => {
      await generateAndBuildQuartus(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.generateTestbench',
    async (uri?: vscode.Uri) => {
      await generateTestbench(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.generateDocumentation',
    async (uri?: vscode.Uri) => {
      await generateDocumentation(context, resourceRoots, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(context, 'fpga-ip-core.openSettings', async () => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:bleviet.ipcraft-vscode'
    );
  });

  safeRegisterCommand(
    context,
    'fpga-ip-core.parseVHDL',
    async (uri?: vscode.Uri) => {
      await parseVHDL(context, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.parseHwTcl',
    async (uri?: vscode.Uri) => {
      await parseHwTcl(context, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(
    context,
    'fpga-ip-core.parseComponentXml',
    async (uri?: vscode.Uri) => {
      await parseComponentXml(context, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  safeRegisterCommand(context, 'fpga-ip-core.viewBusDefinitions', async () => {
    await viewBusDefinitions(resourceRoots);
  });
}
