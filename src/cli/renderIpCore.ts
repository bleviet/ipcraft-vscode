import * as path from 'path';
import { BusLibraryService } from '../services/BusLibraryService';
import type { ResourceRoots } from '../services/ResourceRoots';
import { ipLocalBusFolder } from '../services/render/ipSymbolImage';
import type { BusLibraryCache } from '../services/render/renderResources';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import { Logger } from '../utils/Logger';

/** Logs nothing: the CLI prints only its result line on stdout. */
class SilentLogger extends Logger {
  constructor() {
    super('ipcraft-cli');
  }
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * The bus library the editor would show for this file, minus the VS Code settings, workspace
 * scan and Vivado catalog: the built-in definitions plus the IP's own `useBusLibrary` folder.
 */
async function loadBusLibrary(
  roots: Pick<ResourceRoots, 'busDefinitionsDir' | 'busDefinitionSchemaPath'>,
  ipDir: string,
  useBusLibrary: unknown
): Promise<NormalizedBusLibrary> {
  const service = new BusLibraryService(
    new SilentLogger(),
    roots.busDefinitionsDir,
    roots.busDefinitionSchemaPath
  );
  const builtin = await service.loadDefaultSources();
  if (typeof useBusLibrary === 'string' && useBusLibrary !== '') {
    // A folder that does not exist contributes no definitions.
    const ipLocal = await service.loadFromDirectories(
      [path.resolve(ipDir, useBusLibrary)],
      'ipLocal'
    );
    return service.normalizeSources(builtin, ipLocal);
  }
  return service.normalizeSources(builtin);
}

/** The library for an `.ip.yml` mapping, loaded once per IP-local folder. */
export function busLibraryFor(
  data: Record<string, unknown>,
  inputPath: string,
  roots: Pick<ResourceRoots, 'busDefinitionsDir' | 'busDefinitionSchemaPath'>,
  libraries: BusLibraryCache
): Promise<NormalizedBusLibrary> {
  const folder = ipLocalBusFolder(data, inputPath);
  let loading = libraries.get(folder);
  if (!loading) {
    loading = loadBusLibrary(roots, path.dirname(inputPath), data.useBusLibrary);
    libraries.set(folder, loading);
  }
  return loading;
}
