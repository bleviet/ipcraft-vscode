/**
 * Expands Vivado block design containers (`create_bd_cell -type container`):
 * a container is replaced by the block design Tcl script that generates its
 * block design (see {@link rankBdTcl} for how the script is found), grafted
 * inline as a hierarchy level. Nested containers are expanded recursively; a
 * script that contains itself, directly or through others, is left as a black
 * box with a warning. The `.bd` build product is never read.
 */

import * as path from 'path';
import { containerDesigns } from '../../../domain/bdContainer';
import type { SystemDiagnostic, SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import { readBdTcl } from '../../../parser/system/BdTclReader';
import { BD_LINKS_FILE } from './bdLinks';
import type { CmakeEntry } from './cmakeProjects';
import { SourceFailedError, type EnrichmentIo, type EnrichmentLog } from './enrichmentIo';
import { bdTclEntryFromText, type BdTclEntry } from './fileEntries';
import { graftSubsystem } from './graftSubsystem';
import { rankBdTcl, type BdTclRanking, type RankedBdTcl } from './rankBdTcl';

/** What the whole call tree shares: each list is read at most once, on first use. */
interface Sources<R> {
  io: EnrichmentIo<R>;
  log?: EnrichmentLog;
  cmake(): Promise<CmakeEntry[]>;
  workspace(): Promise<BdTclEntry<R>[]>;
}

const once = <T>(build: () => Promise<T>): (() => Promise<T>) => {
  let cached: Promise<T> | undefined;
  return () => (cached ??= build());
};

const createSources = <R>(io: EnrichmentIo<R>, log?: EnrichmentLog): Sources<R> => ({
  io,
  log,
  cmake: once(() => io.listCmakeFiles()),
  workspace: once(() => io.listBdTclFiles()),
});

const depth = (instance: SystemInstance) => instance.path.split('/').length;

const hasContainer = (graph: SystemGraph) =>
  Object.values(graph.instances).some((instance) => instance.container);

/** `designFile` is the path of the design: the nearest script wins a tie. */
export async function expandContainers<R>(
  graph: SystemGraph,
  designFile: string,
  io: EnrichmentIo<R>,
  log?: EnrichmentLog
): Promise<SystemGraph> {
  if (graph.source.format !== 'vivado-bd-tcl' || !hasContainer(graph)) {
    return graph;
  }
  return expandWithin(graph, designFile, [designFile], createSources(io, log));
}

/** The Tcl files listed with `designFile` in a CMake project, as index entries. */
async function projectEntries<R>(
  designFile: string,
  sources: Sources<R>
): Promise<BdTclEntry<R>[]> {
  const design = path.resolve(designFile);
  const files = new Set<string>();
  for (const cmake of await sources.cmake()) {
    for (const project of cmake.projects) {
      if (project.some((file) => path.resolve(file) === design)) {
        project
          .filter((file) => file.toLowerCase().endsWith('.tcl'))
          .forEach((file) => files.add(path.resolve(file)));
      }
    }
  }
  files.delete(design);
  const entries: BdTclEntry<R>[] = [];
  for (const file of files) {
    try {
      const location = sources.io.locate(file);
      entries.push(bdTclEntryFromText(await sources.io.readText(location.ref), location));
    } catch (error) {
      if (error instanceof SourceFailedError) {
        throw error;
      }
      // Unreadable: skipped.
    }
  }
  return entries;
}

/**
 * The user's link (when readable) and the Tcl files found for block design `bd`, ranked. The
 * workspace Tcl index is read only when the link and the CMake project do not decide, or when
 * `all` candidates are wanted: a weaker evidence never changes their choice.
 */
async function rankContainerTcl<R>(
  bd: string,
  designFile: string,
  links: Record<string, string>,
  project: () => Promise<BdTclEntry<R>[]>,
  sources: Sources<R>,
  all = false
): Promise<{ ranking: BdTclRanking<R>; unreadableLink?: string }> {
  let link: BdTclEntry<R> | undefined;
  let unreadableLink: string | undefined;
  if (links[bd] !== undefined) {
    try {
      const location = sources.io.locate(links[bd]);
      link = bdTclEntryFromText(await sources.io.readText(location.ref), location);
    } catch (error) {
      if (error instanceof SourceFailedError) {
        throw error;
      }
      unreadableLink = links[bd];
    }
  }
  const rank = async (workspace: readonly BdTclEntry<R>[]) =>
    rankBdTcl(bd, designFile, { link, project: await project(), workspace });
  const decided = all ? undefined : await rank([]);
  const ranking = decided?.chosen ? decided : await rank(await sources.workspace());
  return { ranking, unreadableLink };
}

/** The Tcl files that may generate block design `bd` for a container in `designFile`, strongest evidence first. */
export async function bdTclCandidates<R>(
  bd: string,
  designFile: string,
  io: EnrichmentIo<R>,
  log?: EnrichmentLog
): Promise<RankedBdTcl<R>[]> {
  const sources = createSources(io, log);
  const { ranking } = await rankContainerTcl(
    bd,
    designFile,
    (await io.readBdLinks(designFile)).links,
    once(() => projectEntries(designFile, sources)),
    sources,
    true
  );
  return ranking.candidates;
}

async function expandWithin<R>(
  graph: SystemGraph,
  designFile: string,
  stack: readonly string[],
  sources: Sources<R>
): Promise<SystemGraph> {
  const { io, log } = sources;
  const containers = Object.values(graph.instances)
    .filter((instance) => instance.container)
    .sort((a, b) => depth(a) - depth(b));
  if (containers.length === 0) {
    return graph;
  }
  const { links, rejected } = await io.readBdLinks(designFile);
  const project = once(() => projectEntries(designFile, sources));
  const notes: SystemDiagnostic[] = [];
  let result = graph;
  let blackBoxes = false;
  for (const instance of containers) {
    const note = (message: string) =>
      notes.push({
        severity: 'warning',
        message: `${instance.name}: ${message}`,
        lines: [instance.line],
        ...(instance.parent !== '/' && { level: instance.parent }),
      });
    const bd = (containerDesigns(instance) as { active: string }).active;
    const { ranking, unreadableLink } = await rankContainerTcl(
      bd,
      designFile,
      links,
      project,
      sources
    );
    if (rejected[bd] !== undefined) {
      note(
        `${BD_LINKS_FILE} links ${bd} to ${rejected[bd]}, which is not a .tcl file inside the workspace folder; ignored.`
      );
    }
    if (unreadableLink !== undefined) {
      note(
        `${BD_LINKS_FILE} links ${bd} to ${unreadableLink}, which cannot be read; using automatic resolution.`
      );
    }
    const chosen = ranking.chosen;
    if (!chosen) {
      blackBoxes = true;
      note(
        ranking.ambiguous
          ? `several Tcl scripts define block design ${bd}: ${ranking.ambiguous
              .map((ranked) => ranked.entry.displayName)
              .sort()
              .join(', ')}. Use Assign Tcl to choose one.`
          : `no Tcl script defines block design ${bd}; shown as a black box. Use Assign Tcl in the details panel to choose one.`
      );
      continue;
    }
    const { entry, evidence } = chosen;
    if (stack.includes(entry.file)) {
      blackBoxes = true;
      note(`${entry.displayName} instantiates itself.`);
      continue;
    }
    try {
      const read = readBdTcl(await io.readText(entry.ref), entry.displayName);
      const child = await expandWithin(read, entry.file, [...stack, entry.file], sources);
      const source = { fileName: entry.displayName, uri: entry.uri };
      result = graftSubsystem(result, instance.path, child, source);
      const grafted = result.instances[instance.path];
      result = {
        ...result,
        instances: {
          ...result.instances,
          [instance.path]: {
            ...grafted,
            container: {
              ...(grafted.container as { reference: string }),
              source: { ...source, evidence },
            },
          },
        },
      };
    } catch (error) {
      if (error instanceof SourceFailedError) {
        throw error;
      }
      blackBoxes = true;
      log?.warn(`Could not read subsystem ${entry.displayName}: ${String(error)}`);
      note(
        `Could not read subsystem ${entry.displayName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  const capabilities = { ...result.capabilities };
  if (blackBoxes) {
    for (const key of ['connections', 'addressMap'] as const) {
      capabilities[key] = capabilities[key] === 'complete' ? 'partial' : capabilities[key];
    }
  }
  return notes.length === 0 && !blackBoxes
    ? result
    : { ...result, capabilities, diagnostics: [...result.diagnostics, ...notes] };
}
