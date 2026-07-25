import * as vscode from 'vscode';
import { findActiveIpCoreFile } from '../../../utils/activeIpCoreFile';

function setActiveTab(uri: { fsPath: string } | undefined): void {
  const activeTabGroup = vscode.window.tabGroups.activeTabGroup as unknown as {
    activeTab: { input: unknown } | undefined;
  };
  activeTabGroup.activeTab = uri
    ? { input: new vscode.TabInputCustom(uri as vscode.Uri, 'ipcraft.ipCoreEditor') }
    : undefined;
}

function setActiveEditor(fileName: string | undefined): void {
  (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = fileName
    ? { document: { fileName, uri: { fsPath: fileName } } }
    : undefined;
}

// issue #167: the pre-extraction Build and Generate command modules each had their own
// copy of this lookup, and they disagreed on what to do when a non-IP text editor is
// focused but an .ip.yml custom-editor tab is also open in the group. `fallThroughOnNonIpEditor`
// makes that divergence an explicit, tested parameter instead of an accidental duplication.
describe('findActiveIpCoreFile', () => {
  afterEach(() => {
    setActiveEditor(undefined);
    setActiveTab(undefined);
  });

  it('returns the ip-core text editor when active', () => {
    setActiveEditor('/core.ip.yml');
    expect(findActiveIpCoreFile()).toEqual({ fsPath: '/core.ip.yml' });
    expect(findActiveIpCoreFile({ fallThroughOnNonIpEditor: true })).toEqual({
      fsPath: '/core.ip.yml',
    });
  });

  it('returns the ip-core custom-editor tab when there is no active text editor', () => {
    setActiveTab({ fsPath: '/core.ip.yml' });
    expect(findActiveIpCoreFile()).toEqual({ fsPath: '/core.ip.yml' });
    expect(findActiveIpCoreFile({ fallThroughOnNonIpEditor: true })).toEqual({
      fsPath: '/core.ip.yml',
    });
  });

  it('default mode: stops immediately when a non-IP text editor is active, even with an ip-core tab open', () => {
    setActiveEditor('/core.vhd');
    setActiveTab({ fsPath: '/other.ip.yml' });
    expect(findActiveIpCoreFile()).toBeUndefined();
  });

  it('fallThroughOnNonIpEditor: falls back to the ip-core tab when a non-IP text editor is active', () => {
    setActiveEditor('/core.vhd');
    setActiveTab({ fsPath: '/other.ip.yml' });
    expect(findActiveIpCoreFile({ fallThroughOnNonIpEditor: true })).toEqual({
      fsPath: '/other.ip.yml',
    });
  });

  it('returns undefined when nothing active resolves to an .ip.yml file', () => {
    expect(findActiveIpCoreFile()).toBeUndefined();
    expect(findActiveIpCoreFile({ fallThroughOnNonIpEditor: true })).toBeUndefined();
  });
});
