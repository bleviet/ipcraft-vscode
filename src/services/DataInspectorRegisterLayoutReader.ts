import * as path from 'path';
import * as vscode from 'vscode';
import { parseMemoryMap } from '../domain/parse';
import type { InspectorField } from '../dataInspector/fieldLayout';
import type { RegisterLayoutCopy } from '../shared/messages/dataInspector';

export class DataInspectorRegisterLayoutReader {
  async load(): Promise<RegisterLayoutCopy[]> {
    const uris = await vscode.workspace.findFiles('**/*.mm.yml', '**/{node_modules,dist}/**');
    const layouts: RegisterLayoutCopy[] = [];
    for (const uri of uris) {
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
    }
    return layouts;
  }
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
  const fields: InspectorField[] = register.fields.map((field, index) => ({
    id: `import-${index}-${field.name}`,
    name: field.name,
    msb: field.offset + field.width - 1,
    lsb: field.offset,
    groupId: 'default',
    description: field.description,
    enumValues: field.enumeratedValues ? { ...field.enumeratedValues } : undefined,
  }));
  return {
    id: `${relativePath}:${parentLabel}:${register.name}`,
    label: `${path.basename(relativePath)} · ${parentLabel}/${register.name}`,
    width: register.size,
    fields,
    sourceFile: relativePath,
    registerName: register.name,
  };
}
