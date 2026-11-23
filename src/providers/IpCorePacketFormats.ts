import * as path from 'path';
import * as vscode from 'vscode';
import type { WebviewRouter } from '../services/WebviewRouter';
import type { IpCoreWebviewMessage } from '../shared/messages/ipCore';
import { candidatesOfFile } from '../shared/packetFormat';
import { collectPacketFormatInfos, readFromDisk } from '../services/packetFormat/refInfo';

/** Posts the resolution of each `packetFormatRef` of the document; nothing when it has none (the webview looks refs up by name). */
export function postPacketFormatInfo(
  router: WebviewRouter<IpCoreWebviewMessage>,
  parsed: unknown,
  text: string,
  ipFile: string
): void {
  const infos = collectPacketFormatInfos(parsed, ipFile);
  if (Object.keys(infos).length > 0) {
    router.postNotification({ type: 'packetFormatInfo', sourceRevision: text, infos });
  }
}

/** Lists the formats of all `*.pkt.yml` files in the workspace for the picker. */
export async function postPacketFormatCandidates(
  router: WebviewRouter<IpCoreWebviewMessage>,
  ipFile: string
): Promise<void> {
  const uris = await vscode.workspace.findFiles('**/*.pkt.yml', '**/node_modules/**', 200);
  const candidates = uris.flatMap((uri) =>
    candidatesOfFile(ipFile, uri.fsPath.split(path.sep).join('/'), readFromDisk)
  );
  router.postNotification({ type: 'packetFormatCandidates', candidates });
}
