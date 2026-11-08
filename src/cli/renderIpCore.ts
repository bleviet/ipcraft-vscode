import * as path from 'path';
import * as yaml from 'yaml';
import { BusLibraryService } from '../services/BusLibraryService';
import type { ResourceRoots } from '../services/ResourceRoots';
import { canonicalizeParsedIpCore } from '../shared/busContracts/ipCoreCanonicalize';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import { readIpCoreFormatVersion } from '../shared/ipCoreFormat';
import { renderIpSymbolSvg } from '../shared/render/ipSymbolSvg';
import type { Palette } from '../shared/render/palette';
import { Logger } from '../utils/Logger';
import type { IpCore } from '../webview/types/ipCore';
import {
  clockDomainColor,
  computeSymbolLayout,
  hasMultipleClockDomains,
  isExpandableBus,
  symbolLayoutInputs,
} from '../webview/ipcore/components/canvas/symbolInputs';

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

function parseIpCore(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid YAML: an .ip.yml must be a mapping');
  }
  return parsed as Record<string, unknown>;
}

export interface IpCoreRenderOptions {
  palette: Palette;
  grid: boolean;
  background: 'editor' | 'transparent';
  fontFaceCss: string;
}

/** Draws the IP core symbol of an `.ip.yml` text, as the IP core editor's canvas shows it. */
export async function renderIpCoreFile(
  inputPath: string,
  text: string,
  roots: Pick<ResourceRoots, 'busDefinitionsDir' | 'busDefinitionSchemaPath'>,
  options: IpCoreRenderOptions
): Promise<string> {
  const data = parseIpCore(text);
  const version = readIpCoreFormatVersion(data);
  if (!version.ok) {
    throw new Error(version.message);
  }
  const vlnv = data.vlnv as Record<string, unknown> | undefined;
  if (!vlnv || typeof vlnv !== 'object' || !vlnv.name) {
    throw new Error(`'${inputPath}' is not an IP core: it has no vlnv.name`);
  }
  const library = await loadBusLibrary(roots, path.dirname(inputPath), data.useBusLibrary);
  const ipCore = canonicalizeParsedIpCore(data, library).ipCore as unknown as IpCore;
  const inputs = symbolLayoutInputs(ipCore, library);
  const layout = computeSymbolLayout(ipCore, inputs);
  const multiDomain = hasMultipleClockDomains(ipCore);
  return renderIpSymbolSvg(layout, {
    ...options,
    domainColor: (idx) => clockDomainColor(idx, multiDomain),
    expandable: (port) =>
      isExpandableBus(port.data as { type?: string; conduitPorts?: unknown[] }, inputs.busDefs),
  });
}
