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
export async function installGlobalBusDefinitions(busDefinitionsDir: string): Promise<string> {
  const currentDir = busDefinitionsDir;
  const files = await fs.readdir(currentDir);

  const busDefinitions: BusDefinitions = {};

  for (const file of files) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      const filePath = path.join(currentDir, file);
      const yamlText = await fs.readFile(filePath, 'utf-8');
      const parsed = yaml.load(yamlText) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        Object.assign(busDefinitions, parsed);
      }
    }
  }

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
