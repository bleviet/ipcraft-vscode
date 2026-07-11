#!/usr/bin/env node
/**
 * Headless IpCoreScaffolder.generateAll invocation for an arbitrary .ip.yml,
 * outside the ipcraft-spec examples/templates set (e.g. a cvsoc board
 * project). Mirrors the vscode mock in scripts/validate-examples-qsys.js and
 * the scaffolder setup in src/test/integration/generator.ts.
 *
 * Usage:
 *   npm run compile-tests   # ensure out/ is built
 *   node scripts/generate-standalone-ip.js <path-to.ip.yml> <output-dir> [--targets=quartus,vivado]
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');

const mockVscode = {
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
    showErrorMessage: () => {},
    showWarningMessage: () => {},
    showInformationMessage: () => {},
  },
  workspace: {
    onDidChangeTextDocument: () => {},
    applyEdit: () => {},
    asRelativePath: (p) => p.toString(),
    getConfiguration: () => ({
      get: (key, defaultValue) => defaultValue ?? [],
    }),
    fs: {
      readDirectory: async (uri) => {
        const entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
        return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
      },
      readFile: async (uri) => fs.readFileSync(uri.fsPath),
      writeFile: async (uri, content) => fs.writeFileSync(uri.fsPath, content),
    },
    workspaceFolders: undefined,
  },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  commands: { executeCommand: () => {} },
  Uri: {
    file: (p) => ({ fsPath: p, toString: () => p }),
    from: (parts) => ({
      scheme: parts.scheme,
      path: parts.path,
      toString: () => `${parts.scheme || ''}:${parts.path || ''}`,
    }),
    joinPath: (...paths) => ({
      fsPath: paths.join('/'),
      toString: () => paths.join('/'),
    }),
  },
  Range: class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.startLine = startLine;
      this.startCharacter = startCharacter;
      this.endLine = endLine;
      this.endCharacter = endCharacter;
    }
  },
  WorkspaceEdit: class WorkspaceEdit {
    constructor() {
      this.replace = () => {};
    }
  },
  EventEmitter: class EventEmitter {
    constructor() {
      this.listeners = [];
    }
    get event() {
      return (listener) => {
        this.listeners.push(listener);
        return {
          dispose: () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
          },
        };
      };
    }
    fire(data) {
      for (const listener of this.listeners) listener(data);
    }
    dispose() {
      this.listeners = [];
    }
  },
  Disposable: class Disposable {
    constructor(disposeFn) {
      this.disposeFn = disposeFn;
    }
    dispose() {
      this.disposeFn();
    }
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') return mockVscode;
  return originalRequire.apply(this, arguments);
};

const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const [ipYamlPath, outputDir] = positional;
  if (!ipYamlPath || !outputDir) {
    console.error('Usage: node scripts/generate-standalone-ip.js <ip.yml> <output-dir> [--targets=quartus,vivado] [--lang=vhdl|systemverilog]');
    process.exit(1);
  }
  const targetsArg = args.find((a) => a.startsWith('--targets='));
  const targets = targetsArg ? targetsArg.slice('--targets='.length).split(',') : ['quartus'];
  const langArg = args.find((a) => a.startsWith('--lang='));
  const hdlLanguage = langArg ? langArg.slice('--lang='.length) : 'vhdl';

  const outDir = path.join(REPO_ROOT, 'out');
  if (!fs.existsSync(outDir)) {
    console.error(`Error: ${outDir} not found. Run 'npm run compile-tests' first.`);
    process.exit(1);
  }

  const { IpCoreScaffolder } = require(path.join(outDir, 'generator/IpCoreScaffolder.js'));
  const { TemplateLoader } = require(path.join(outDir, 'generator/TemplateLoader.js'));
  const { Logger } = require(path.join(outDir, 'utils/Logger.js'));
  const { devResourceRoots } = require(path.join(outDir, 'services/ResourceRoots.js'));

  const logger = new Logger('generate-standalone');
  const resourceRoots = devResourceRoots(REPO_ROOT);
  const templatesDir = path.join(REPO_ROOT, 'src/generator/templates');
  const loader = new TemplateLoader(logger, templatesDir);
  const scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

  const resolvedIpYaml = path.resolve(ipYamlPath);
  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  console.log(`Generating from ${resolvedIpYaml}`);
  console.log(`Output dir: ${resolvedOutputDir}`);
  console.log(`Targets: ${targets.join(', ')} | HDL: ${hdlLanguage}`);

  const result = await scaffolder.generateAll(resolvedIpYaml, resolvedOutputDir, {
    targets,
    includeRegs: true,
    includeTestbench: true,
    includeQuartusProject: targets.includes('quartus'),
    includeVivadoProject: targets.includes('vivado'),
    hdlLanguage,
  });

  if (!result.success) {
    console.error(`Generation failed: ${result.error}`);
    process.exit(1);
  }

  const files = Object.keys(result.files || {});
  console.log(`Generated ${files.length} files:`);
  for (const f of files.sort()) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
