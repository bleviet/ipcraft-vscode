import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { parseMemoryMap } from '../domain/parse';
import type { IpCore } from '../domain/ipcore.types';
import { copyPortLayouts } from '../dataInspector/portLayouts';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import type { InspectorField } from '../dataInspector/fieldLayout';
import type { RegisterLayoutCopy } from '../shared/messages/dataInspector';
import { Logger } from '../utils/Logger';
import { uniqueStableId } from '../dataInspector/stableId';
import type { IpCoreDataNode } from './ImportResolver';
import { loadRuntimeBusLibrary } from './loadRuntimeBusLibrary';
import type { ResourceRoots } from './ResourceRoots';

const MAX_MEMORY_MAP_FILES = 1000;
const MAX_IP_CORE_FILES = 1000;

export class DataInspectorRegisterLayoutReader {
  private readonly logger = new Logger('DataInspectorRegisterLayoutReader');

  constructor(private readonly resourceRoots: ResourceRoots) {}

  async load(): Promise<RegisterLayoutCopy[]> {
    const layouts = await this.loadRegisterLayouts();
    layouts.push(...(await this.loadPortLayouts()));
    return layouts;
  }

  private async loadRegisterLayouts(): Promise<RegisterLayoutCopy[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*.mm.yml',
      '**/{node_modules,dist}/**',
      MAX_MEMORY_MAP_FILES
    );
    const layouts: RegisterLayoutCopy[] = [];
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const document = parseMemoryMap(Buffer.from(bytes).toString('utf8'));
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        for (const block of document.map.addressBlocks) {
          for (const register of block.registers) {
            if (register.__kind === 'array' && register.registers) {
              for (const nested of register.registers) {
                layouts.push(
                  copyRegisterLayout(relativePath, `${block.name}/${register.name}`, nested)
                );
              }
            } else {
              layouts.push(copyRegisterLayout(relativePath, block.name, register));
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Skipping invalid memory map ${uri.toString()}`, error);
      }
    }
    return layouts;
  }

  private async loadPortLayouts(): Promise<RegisterLayoutCopy[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*.ip.yml',
      '**/{node_modules,dist}/**',
      MAX_IP_CORE_FILES
    );
    const layouts: RegisterLayoutCopy[] = [];
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const data = yaml.load(Buffer.from(bytes).toString('utf8'));
        if (!data || typeof data !== 'object') {
          continue;
        }
        const ipCoreData = data as IpCoreDataNode;
        let library: NormalizedBusLibrary | undefined;
        if (hasBusPortFields(ipCoreData)) {
          try {
            library = await loadRuntimeBusLibrary(this.resourceRoots, uri, ipCoreData);
          } catch (error) {
            this.logger.warn(`Bus library unavailable for ${uri.toString()}`, error);
          }
        }
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        layouts.push(...copyPortLayouts(relativePath, ipCoreData as unknown as IpCore, library));
      } catch (error) {
        this.logger.warn(`Skipping invalid IP core ${uri.toString()}`, error);
      }
    }
    return layouts;
  }
}

function hasBusPortFields(ipCore: IpCoreDataNode): boolean {
  const buses = (ipCore as { busInterfaces?: unknown }).busInterfaces;
  return (
    Array.isArray(buses) &&
    buses.some((bus: { portFields?: unknown } | null) => {
      const portFields = bus?.portFields;
      return (
        typeof portFields === 'object' && portFields !== null && Object.keys(portFields).length > 0
      );
    })
  );
}

export function copyRegisterLayout(
  relativePath: string,
  parentLabel: string,
  register: {
    name: string;
    size: number;
    fields: Array<{
      name: string;
      offset: number;
      width: number;
      description?: string;
      enumeratedValues?: Record<string, string> | null;
    }>;
  }
): RegisterLayoutCopy {
  const usedIds = new Set<string>();
  const fields: InspectorField[] = register.fields.map((field, index) => {
    const id = uniqueStableId(`import-${index}-${field.name}`, usedIds);
    usedIds.add(id);
    return {
      id,
      name: field.name,
      msb: field.offset + field.width - 1,
      lsb: field.offset,
      groupId: 'default',
      description: field.description,
      enumValues: field.enumeratedValues ? { ...field.enumeratedValues } : undefined,
    };
  });
  return {
    id: `${relativePath}:${parentLabel}:${register.name}`,
    label: `${path.basename(relativePath)} · ${parentLabel}/${register.name}`,
    kind: 'register',
    width: register.size,
    fields,
    sourceFile: relativePath,
    provenance: { sourceFile: relativePath, registerName: register.name },
  };
}
