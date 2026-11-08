/** What `ipcraft render` loads once and shares between the images of a batch: fonts, bus libraries, workspace files. */

import { RenderAssets } from '../services/render/renderResources';
import { WorkspaceIoPool } from './workspaceIo';

export { readRequired } from '../services/render/renderResources';

export class RenderSession extends RenderAssets {
  /** Workspace scan warnings go to stderr, never stdout. */
  readonly workspaces = new WorkspaceIoPool((message) =>
    process.stderr.write(`Warning: ${message}\n`)
  );
}
