import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getIpcraftConfigDir } from '../utils/configDir';
import {
  customBusInfoFromContract,
  renderAbstractionDefinitionXml,
  renderBusDefinitionXml,
} from './VivadoCustomBusDefinitions';
import type { BusDefinitionFile } from '../domain/busDefinition.types';
import { normalizeBusLibrary, type BusDefinitionSource } from '../shared/busContracts';
import { Logger } from '../utils/Logger';

const logger = new Logger('VivadoBusDefInstaller');

/**
 * Installs IPCraft's custom bus definitions into the global OS configuration directory
 * so they can be referenced globally by Vivado.
 */
export async function installGlobalBusDefinitions(busDefinitionsDir: string): Promise<string> {
  const currentDir = busDefinitionsDir;
  const files = await fs.readdir(currentDir);

  const sources: BusDefinitionSource[] = [];
  for (const file of files) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      const filePath = path.join(currentDir, file);
      const parsed = yaml.load(await fs.readFile(filePath, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        sources.push({
          sourceFile: filePath,
          sourceKind: 'builtin',
          definitions: parsed as BusDefinitionFile,
        });
      }
    }
  }
  // Built from the normalized contracts with the same builder as per-IP definitions,
  // so both copies of one VLNV declare the same logical ports (including read_n).
  const library = normalizeBusLibrary(sources);

  const configDir = getIpcraftConfigDir();
  const vivadoBusDefsDir = path.join(configDir, 'vivado', 'busdefs');

  await fs.mkdir(vivadoBusDefsDir, { recursive: true });

  let installedCount = 0;

  for (const contract of Object.values(library.definitions)) {
    const customBusInfo = customBusInfoFromContract(contract);
    // Only install our own custom buses (e.g. avalon_st, conduit) globally
    if (customBusInfo.vendor !== 'ipcraft') {
      continue;
    }

    const busDefXml = renderBusDefinitionXml(customBusInfo);
    const absDefXml = renderAbstractionDefinitionXml(customBusInfo);

    await fs.writeFile(path.join(vivadoBusDefsDir, `${customBusInfo.name}.xml`), busDefXml);
    await fs.writeFile(path.join(vivadoBusDefsDir, `${customBusInfo.name}_rtl.xml`), absDefXml);
    installedCount++;
  }

  logger.info(`Installed ${installedCount} IPCraft bus definitions to ${vivadoBusDefsDir}`);
  return vivadoBusDefsDir;
}
