import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getIpcraftConfigDir } from '../utils/configDir';
import { isValidVlnv } from '../utils/vlnv';
import { Logger } from '../utils/Logger';

const logger = new Logger('VivadoCatalogScanner');

interface VivadoCatalog {
  version: string;
  scannedAt: string;
  ipdefs: string[];
}

export class VivadoCatalogScanner {
  private get catalogPath(): string {
    return path.join(getIpcraftConfigDir(), 'vivado', 'catalog.json');
  }

  async scan(): Promise<{ count: number; catalogPath: string }> {
    const config = vscode.workspace.getConfiguration('ipcraft');
    const vivadoPath = (config.get<string>('vivadoPath') ?? 'vivado') || 'vivado';

    const tmpDir = path.join(os.tmpdir(), `ipcraft-vivado-scan-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const outputFile = path.join(tmpDir, 'ipdefs.txt');
    const tclScript = path.join(tmpDir, 'scan.tcl');

    const tclContent = [
      'create_project -in_memory -part xc7z020clg484-1',
      `set fh [open {${outputFile}} w]`,
      'foreach ipdef [get_ipdefs *] { puts $fh "$ipdef" }',
      'close $fh',
      'exit',
    ].join('\n');

    await fs.writeFile(tclScript, tclContent, 'utf8');

    try {
      await runProcess(vivadoPath, [
        '-mode',
        'batch',
        '-source',
        tclScript,
        '-nojournal',
        '-nolog',
      ]);

      let rawOutput = '';
      try {
        rawOutput = await fs.readFile(outputFile, 'utf8');
      } catch {
        rawOutput = '';
      }

      const ipdefs = rawOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => isValidVlnv(line));

      const catalogDir = path.dirname(this.catalogPath);
      await fs.mkdir(catalogDir, { recursive: true });

      const catalog: VivadoCatalog = {
        version: '2024.2',
        scannedAt: new Date().toISOString(),
        ipdefs,
      };

      await fs.writeFile(this.catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
      logger.info(`Vivado catalog scan complete: ${ipdefs.length} IPs`);

      return { count: ipdefs.length, catalogPath: this.catalogPath };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async loadCachedCatalog(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.catalogPath, 'utf8');
      const catalog = JSON.parse(raw) as VivadoCatalog;
      return Array.isArray(catalog.ipdefs) ? catalog.ipdefs : [];
    } catch {
      return [];
    }
  }
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}
