/**
 * The version of the IP core that owns a memory map, as the extension host resolves it and the
 * Memory Map webview consumes it. Pure and dependency free: imported by both bundles.
 */
import { resolveVersionRef, type VersionRef, type VersionScheme } from './versionScheme';

export interface VersionContext {
  status: 'resolved' | 'none' | 'ambiguous';
  /** Resolved only. */
  versionScheme?: VersionScheme;
  /** Resolved only: the raw `vlnv.version` text. */
  version?: string;
  /** Resolved only: workspace-relative path of the owning `.ip.yml`. */
  ipCorePath?: string;
  /** Ambiguous only: workspace-relative paths of every `.ip.yml` importing the map. */
  candidates?: string[];
}

/** The number `ref` stands for in the owning core's version, or null when there is none. */
export function resolveVersionRefInContext(ctx: VersionContext, ref: VersionRef): number | null {
  if (ctx.status !== 'resolved' || ctx.versionScheme === undefined || ctx.version === undefined) {
    return null;
  }
  return resolveVersionRef(ctx.versionScheme, ctx.version, ref);
}
