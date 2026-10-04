import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import type { BusDefinitionFile } from '../domain/busDefinition.types';
import {
  busAliasIdentity,
  normalizeBusLibrary,
  type BusDefinitionSource,
  type BusLibraryDiagnostic,
  type NormalizedBusLibrary,
} from '../shared/busContracts';
import { mapWithConcurrency } from '../utils/concurrency';
import { Logger } from '../utils/Logger';
import { YamlValidator } from './YamlValidator';

export interface LoadedBusDefinitionSources {
  readonly sources: readonly BusDefinitionSource[];
  readonly diagnostics: readonly BusLibraryDiagnostic[];
}

/**
 * Validates that a parsed YAML object looks like a bus definition record:
 * a top-level object where at least one value is an object with an array
 * `ports` field. Shared by BusLibraryService and WorkspaceBusDefinitionScanner.
 */
export function isBusDefRecord(parsed: unknown): parsed is Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  const record = parsed as Record<string, unknown>;
  return Object.values(record).some(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as Record<string, unknown>).ports)
  );
}

function schemaDiagnostic(sourceFile: string, message: string): BusLibraryDiagnostic {
  return {
    code: 'BUS_DEF_SCHEMA_INVALID',
    severity: 'error',
    sourceFile,
    path: [],
    message,
  };
}

function canonicalVlnv(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const busType = (entry as { busType?: Record<string, unknown> }).busType;
  if (!busType) {
    return null;
  }
  const parts = [busType.vendor, busType.library, busType.name, busType.version];
  return parts.every((part) => typeof part === 'string' && part.length > 0)
    ? parts.join(':')
    : null;
}

/** Apply source precedence before normalization so replacing a canonical VLNV also removes aliases. */
function selectWinningSources(sources: readonly BusDefinitionSource[]): BusDefinitionSource[] {
  const winners = new Map<
    string,
    { source: BusDefinitionSource; key: string; entry: BusDefinitionFile[string] }
  >();
  const canonicalOwners = new Map<string, string>();

  for (const source of sources) {
    for (const [key, entry] of Object.entries(source.definitions)) {
      const canonical = canonicalVlnv(entry);
      const priorCanonical = winners.get(key) ? canonicalVlnv(winners.get(key)?.entry) : undefined;
      if (priorCanonical) {
        canonicalOwners.delete(priorCanonical);
      }
      if (canonical) {
        const priorKey = canonicalOwners.get(canonical);
        if (priorKey !== undefined && priorKey !== key) {
          winners.delete(priorKey);
        }
        canonicalOwners.set(canonical, key);
      }
      winners.set(key, { source, key, entry });
    }
  }

  return Array.from(winners.values()).map(({ source, key, entry }) => ({
    sourceFile: source.sourceFile,
    sourceKind: source.sourceKind,
    definitions: { [key]: entry },
  }));
}

export class BusLibraryService {
  private readonly validator = new YamlValidator();
  private cachedDefaultSources: LoadedBusDefinitionSources | null = null;
  private cachedDefaultLibrary: NormalizedBusLibrary | null = null;
  private readonly cachedConfiguredSources = new Map<string, LoadedBusDefinitionSources>();

  constructor(
    private readonly logger: Logger,
    private readonly busDefinitionsDir: string,
    private readonly busDefinitionSchemaPath = path.join(
      path.dirname(busDefinitionsDir),
      'schemas',
      'bus_definition.schema.json'
    )
  ) {}

  async loadDefaultLibrary(): Promise<NormalizedBusLibrary> {
    this.cachedDefaultLibrary ??= this.normalizeSources(await this.loadDefaultSources());
    return this.cachedDefaultLibrary;
  }

  async loadDefaultSources(): Promise<LoadedBusDefinitionSources> {
    if (this.cachedDefaultSources) {
      return this.cachedDefaultSources;
    }

    const dirUri = vscode.Uri.file(this.busDefinitionsDir);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch (error) {
      this.logger.error('Default bus library directory not found in extension resources');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Default bus library directory not found at ${this.busDefinitionsDir}: ${message}`
      );
    }

    const ymlFiles = entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.yml'))
      .map(([name]) => name)
      .sort();
    const sources: BusDefinitionSource[] = [];

    for (const fileName of ymlFiles) {
      const filePath = path.join(this.busDefinitionsDir, fileName);
      let content: string;
      try {
        const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        content = Buffer.from(fileData).toString('utf8');
      } catch (error) {
        this.logger.error(`Failed to read bus definition file: ${fileName}`);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read bus definition from ${filePath}: ${message}`);
      }

      let parsed: unknown;
      try {
        parsed = yaml.load(content);
      } catch (error) {
        this.logger.error(`Failed to parse bus definition file: ${fileName}`);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse bus definition from ${filePath}: ${message}`);
      }
      const validation = this.validator.validateAgainstSchema(parsed, this.busDefinitionSchemaPath);
      if (!validation.valid) {
        throw new Error(
          `Invalid bundled bus definition at ${filePath}: ${validation.error ?? 'schema validation failed'}`
        );
      }
      sources.push({
        sourceFile: filePath,
        sourceKind: 'builtin',
        definitions: parsed as BusDefinitionFile,
      });
    }

    this.cachedDefaultSources = Object.freeze({
      sources: Object.freeze(sources),
      diagnostics: Object.freeze([]),
    });
    this.logger.info(
      `Loaded default bus library from ${this.busDefinitionsDir} (${ymlFiles.length} files)`
    );
    return this.cachedDefaultSources;
  }

  async loadFromUserPaths(
    paths: string[],
    workspaceRoot?: string
  ): Promise<LoadedBusDefinitionSources> {
    const resolvedPaths = paths.map((item) =>
      path.isAbsolute(item) ? item : path.resolve(workspaceRoot ?? process.cwd(), item)
    );
    const cacheKey = JSON.stringify(resolvedPaths);
    const cached = this.cachedConfiguredSources.get(cacheKey);
    if (cached) {
      return cached;
    }
    const loaded = await this.loadFromDirectories(resolvedPaths, 'configured');
    this.cachedConfiguredSources.set(cacheKey, loaded);
    this.logger.info(
      `Loaded ${loaded.sources.length} user bus definition file(s) from custom paths`
    );
    return loaded;
  }

  async loadFromDirectories(
    paths: string[],
    sourceKind: BusDefinitionSource['sourceKind'] = 'ipLocal'
  ): Promise<LoadedBusDefinitionSources> {
    const results = await Promise.all(
      paths.map((dirPath) => this.scanDirectory(dirPath, sourceKind))
    );
    const loaded = Object.freeze({
      sources: Object.freeze(results.flatMap((result) => result.sources)),
      diagnostics: Object.freeze(results.flatMap((result) => result.diagnostics)),
    });
    this.logger.info(
      `Loaded ${loaded.sources.length} bus definition file(s) from ${sourceKind} directories`
    );
    return loaded;
  }

  loadRecord(
    definitions: Record<string, unknown>,
    sourceFile: string,
    sourceKind: BusDefinitionSource['sourceKind']
  ): LoadedBusDefinitionSources {
    const validation = this.validator.validateAgainstSchema(
      definitions,
      this.busDefinitionSchemaPath
    );
    if (!validation.valid) {
      return Object.freeze({
        sources: Object.freeze([]),
        diagnostics: Object.freeze([
          schemaDiagnostic(
            sourceFile,
            `Invalid bus definition: ${validation.error ?? 'schema validation failed'}`
          ),
        ]),
      });
    }
    return Object.freeze({
      sources: Object.freeze([
        { sourceFile, sourceKind, definitions: definitions as BusDefinitionFile },
      ]),
      diagnostics: Object.freeze([]),
    });
  }

  /**
   * Load a workspace scan result, validating each discovered file on its own so a
   * schema-invalid file only drops its own definitions. Definitions without file
   * provenance are loaded together under `workspace://discovered`.
   */
  loadWorkspaceScan(scan: {
    library: Record<string, unknown>;
    files: readonly { uri: { fsPath: string }; busTypes: readonly string[] }[];
  }): LoadedBusDefinitionSources {
    const loads: LoadedBusDefinitionSources[] = [];
    const assignedKeys = new Set<string>();
    for (const file of scan.files) {
      const definitions = Object.fromEntries(
        file.busTypes
          .filter((key) => scan.library[key] !== undefined)
          .map((key) => {
            assignedKeys.add(key);
            return [key, scan.library[key]];
          })
      );
      if (Object.keys(definitions).length > 0) {
        loads.push(this.loadRecord(definitions, file.uri.fsPath, 'workspace'));
      }
    }
    const unassigned = Object.fromEntries(
      Object.entries(scan.library).filter(([key]) => !assignedKeys.has(key))
    );
    if (Object.keys(unassigned).length > 0) {
      loads.push(this.loadRecord(unassigned, 'workspace://discovered', 'workspace'));
    }
    return Object.freeze({
      sources: Object.freeze(loads.flatMap((load) => load.sources)),
      diagnostics: Object.freeze(loads.flatMap((load) => load.diagnostics)),
    });
  }

  normalizeSources(...loads: readonly LoadedBusDefinitionSources[]): NormalizedBusLibrary {
    const semanticDiagnostics: BusLibraryDiagnostic[] = [];
    // selectedSources always holds winners only (unique keys and canonical VLNVs).
    let selectedSources: BusDefinitionSource[] = [];
    // Normalized selectedSources, computed only when the full check needs it.
    let selected: NormalizedBusLibrary | null = null;
    const selectedKeys = new Set<string>();
    const selectedCanonicals = new Set<string>();
    const aliasOwners = new Map<string, string>();
    const adopt = (library: NormalizedBusLibrary): void => {
      selected = library;
      selectedKeys.clear();
      selectedCanonicals.clear();
      aliasOwners.clear();
      for (const winner of selectedSources) {
        for (const [key, entry] of Object.entries(winner.definitions)) {
          selectedKeys.add(key);
          const canonical = canonicalVlnv(entry);
          if (canonical) {
            selectedCanonicals.add(canonical);
          }
        }
      }
      for (const alias of library.aliases) {
        aliasOwners.set(busAliasIdentity(alias), alias.canonicalVlnv);
      }
    };

    for (const source of loads.flatMap((load) => load.sources)) {
      for (const [key, entry] of Object.entries(source.definitions)) {
        const candidate: BusDefinitionSource = {
          sourceFile: source.sourceFile,
          sourceKind: source.sourceKind,
          definitions: { [key]: entry },
        };
        const candidateResult = normalizeBusLibrary([candidate]);
        const candidateContract = candidateResult.definitions[key];
        if (!candidateContract) {
          if (source.sourceKind === 'builtin') {
            const detail = candidateResult.diagnostics.map((item) => item.message).join(' ');
            throw new Error(`Invalid bundled bus definition at ${source.sourceFile}: ${detail}`);
          }
          semanticDiagnostics.push(...candidateResult.diagnostics);
          continue;
        }

        // Fast path: a new key and canonical VLNV whose aliases are free cannot
        // displace or change any selected definition, so normalizing the whole
        // library again would give the same result plus this candidate.
        const canonical = canonicalVlnv(entry);
        if (
          canonical &&
          !selectedKeys.has(key) &&
          !selectedCanonicals.has(canonical) &&
          candidateResult.aliases.every((alias) => {
            const owner = aliasOwners.get(busAliasIdentity(alias));
            return owner === undefined || owner === candidateContract.canonicalVlnv;
          })
        ) {
          selectedSources = [...selectedSources, candidate];
          selected = null;
          selectedKeys.add(key);
          selectedCanonicals.add(canonical);
          for (const alias of candidateResult.aliases) {
            aliasOwners.set(busAliasIdentity(alias), alias.canonicalVlnv);
          }
          continue;
        }

        const before: NormalizedBusLibrary = selected ?? normalizeBusLibrary(selectedSources);
        const tentativeSources = selectWinningSources([...selectedSources, candidate]);
        const tentative = normalizeBusLibrary(tentativeSources);
        const acceptedCandidate = tentative.definitions[key];
        const removesUnrelatedDefinition = Object.values(before.definitions).some(
          (existing) =>
            existing.key !== key &&
            existing.canonicalVlnv !== canonical &&
            !Object.values(tentative.definitions).some(
              (next) => next.canonicalVlnv === existing.canonicalVlnv
            )
        );
        if (acceptedCandidate?.sourceFile !== candidate.sourceFile || removesUnrelatedDefinition) {
          const diagnostics = tentative.diagnostics.filter(
            (diagnostic) => diagnostic.severity === 'error'
          );
          if (source.sourceKind === 'builtin') {
            const detail = diagnostics.map((item) => item.message).join(' ');
            throw new Error(`Invalid bundled bus definition at ${source.sourceFile}: ${detail}`);
          }
          semanticDiagnostics.push(...diagnostics);
          selected = before;
          continue;
        }
        selectedSources = tentativeSources;
        adopt(tentative);
      }
    }
    const normalized = normalizeBusLibrary(selectWinningSources(selectedSources));
    return Object.freeze({
      definitions: normalized.definitions,
      aliases: normalized.aliases,
      diagnostics: Object.freeze([
        ...loads.flatMap((load) => load.diagnostics),
        ...semanticDiagnostics,
        ...normalized.diagnostics,
      ]),
    });
  }

  private async scanDirectory(
    dirPath: string,
    sourceKind: BusDefinitionSource['sourceKind']
  ): Promise<LoadedBusDefinitionSources> {
    const files = await this.collectBusDefFiles(dirPath);
    const results = await mapWithConcurrency(files, 16, async (filePath) => {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = yaml.load(content);
        if (!isBusDefRecord(parsed)) {
          return null;
        }
        return this.loadRecord(parsed, filePath, sourceKind);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping bus definition file '${filePath}': ${message}`);
        return {
          sources: [],
          diagnostics: [schemaDiagnostic(filePath, `Could not load bus definition: ${message}`)],
        } satisfies LoadedBusDefinitionSources;
      }
    });
    return {
      sources: results.flatMap((result) => result?.sources ?? []),
      diagnostics: results.flatMap((result) => result?.diagnostics ?? []),
    };
  }

  private async collectBusDefFiles(dirPath: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not read bus library directory '${dirPath}': ${message}`);
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.collectBusDefFiles(fullPath)));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) &&
        !entry.name.endsWith('.ip.yml') &&
        !entry.name.endsWith('.mm.yml')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  clearCache(): void {
    this.cachedDefaultSources = null;
    this.cachedDefaultLibrary = null;
    this.cachedConfiguredSources.clear();
  }
}
