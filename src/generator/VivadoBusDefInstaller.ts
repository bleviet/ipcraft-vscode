import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getIpcraftConfigDir } from '../utils/configDir';
import {
  renderBusDefinitionXml,
  renderAbstractionDefinitionXml,
  CustomBusInfo,
} from './VivadoComponentXmlGenerator';
import type { BusDefinitions } from './types';
import { Logger } from '../utils/Logger';

const logger = new Logger('VivadoBusDefInstaller');

/**
 * Installs IPCraft's custom bus definitions into the global OS configuration directory
 * so they can be referenced globally by Vivado.
 */
export async function installGlobalBusDefinitions(extensionPath: string): Promise<string> {
  const definitionsPath = path.join(extensionPath, 'dist', 'resources', 'bus_definitions.yml');
  let yamlText: string;
  try {
    yamlText = await fs.readFile(definitionsPath, 'utf-8');
  } catch (err) {
    // Fallback if not running in production dist
    yamlText = await fs.readFile(
      path.join(extensionPath, 'resources', 'bus_definitions.yml'),
      'utf-8'
    );
  }

  const busDefinitions = yaml.load(yamlText) as BusDefinitions;

  const configDir = getIpcraftConfigDir();
  const vivadoBusDefsDir = path.join(configDir, 'vivado', 'busdefs');

  await fs.mkdir(vivadoBusDefsDir, { recursive: true });

  let installedCount = 0;

  for (const def of Object.values(busDefinitions)) {
    const bt = def.busType;
    if (!bt?.vendor || !bt.library || !bt.name || !bt.version) {
      continue;
    }

    // Only install our own custom buses (e.g. avalon_st, conduit) globally
    if (bt.vendor !== 'ipcraft') {
      continue;
    }

    const customBusInfo: CustomBusInfo = {
      vendor: bt.vendor,
      library: bt.library,
      name: bt.name,
      version: bt.version,
      description: bt.description ?? '',
      ports: def.ports ?? [],
    };

    const busDefXml = renderBusDefinitionXml(customBusInfo);
    const absDefXml = renderAbstractionDefinitionXml(customBusInfo);

    await fs.writeFile(path.join(vivadoBusDefsDir, `${bt.name}.xml`), busDefXml);
    await fs.writeFile(path.join(vivadoBusDefsDir, `${bt.name}_rtl.xml`), absDefXml);
    installedCount++;
  }

  logger.info(`Installed ${installedCount} IPCraft bus definitions to ${vivadoBusDefsDir}`);
  return vivadoBusDefsDir;
}
