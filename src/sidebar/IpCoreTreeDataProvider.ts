import * as vscode from 'vscode';
import * as path from 'path';
import { getWorkspaceBusDefinitionScanner } from '../services/WorkspaceBusDefinitionScanner';

interface NodeDef {
  label: string;
  icon?: string;
  command?: vscode.Command;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  children?: NodeDef[];
  resourceUri?: vscode.Uri;
  contextValue?: string;
}

export class IpCoreTreeDataProvider implements vscode.TreeDataProvider<FoundryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FoundryNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workspaceWatcher: vscode.FileSystemWatcher | undefined;
  private busDefWatcher: vscode.FileSystemWatcher | undefined;
  private busDefScanSubscription: vscode.Disposable | undefined;

  constructor() {
    this.setupWatcher();
  }

  private setupWatcher(): void {
    // Refresh the tree when yml files are created, changed, or deleted
    this.workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ip.yml,mm.yml}');
    this.workspaceWatcher.onDidCreate(() => this.refresh());
    this.workspaceWatcher.onDidChange(() => this.refresh());
    this.workspaceWatcher.onDidDelete(() => this.refresh());

    // Watch generic .yml/.yaml/.xml files for bus definition changes (.xml
    // covers IP-XACT bus/abstraction definitions from Vivado's IP Packager).
    // Only create/delete events invalidate the workspace bus def scan cache —
    // change events fire too frequently during editing, and the explicit
    // "Scan Workspace Bus Definitions" command handles manual refreshes.
    this.busDefWatcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml,xml}');
    this.busDefWatcher.onDidCreate(() => {
      getWorkspaceBusDefinitionScanner().clearCache();
      this.refresh();
    });
    this.busDefWatcher.onDidDelete(() => {
      getWorkspaceBusDefinitionScanner().clearCache();
      this.refresh();
    });

    // The tree never blocks on the (potentially expensive) workspace bus def
    // scan — it renders with whatever's cached so far (see
    // scanWorkspaceForBusDefs) and refreshes once a background or explicit
    // scan completes.
    this.busDefScanSubscription = getWorkspaceBusDefinitionScanner().onDidScan(() =>
      this.refresh()
    );
  }

  dispose(): void {
    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
    }
    if (this.busDefWatcher) {
      this.busDefWatcher.dispose();
    }
    if (this.busDefScanSubscription) {
      this.busDefScanSubscription.dispose();
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FoundryNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FoundryNode): Promise<FoundryNode[]> {
    if (!element) {
      return this.getRootNodes();
    }
    return element.children ?? [];
  }

  private async getRootNodes(): Promise<FoundryNode[]> {
    const nodes: FoundryNode[] = [];

    // 1. Quick Actions Section
    const actionsNode = new FoundryNode({
      label: 'Quick Actions',
      icon: 'zap',
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children: [
        {
          label: 'Create IP Core + Register Map',
          icon: 'add',
          command: {
            command: 'fpga-ip-core.createIpCoreWithMemoryMap',
            title: 'Create IP Core with Register Map',
          },
        },
        {
          label: 'Create IP Core (.ip.yml)',
          icon: 'new-file',
          command: {
            command: 'fpga-ip-core.createIpCore',
            title: 'Create IP Core',
          },
        },
        {
          label: 'Create Register Map (.mm.yml)',
          icon: 'new-file',
          command: {
            command: 'fpga-ip-core.createMemoryMap',
            title: 'Create Register Map',
          },
        },
        {
          label: 'Scan Vivado IP Catalog',
          icon: 'search',
          command: {
            command: 'fpga-ip-core.scanVivadoCatalog',
            title: 'Scan Vivado IP Catalog',
          },
        },
        {
          label: 'Scan Vivado Interface Catalog',
          icon: 'search',
          command: {
            command: 'fpga-ip-core.scanVivadoInterfaces',
            title: 'Scan Vivado Interface Catalog',
          },
        },
        {
          label: 'Scan Workspace Bus Definitions',
          icon: 'search',
          command: {
            command: 'fpga-ip-core.scanWorkspaceBusDefinitions',
            title: 'Scan Workspace Bus Definitions',
          },
        },
      ],
    });
    nodes.push(actionsNode);

    // 2. Scan Workspace for Specs
    const specsNodes = await this.scanWorkspaceForSpecs();
    if (specsNodes.length > 0) {
      const workspaceNode = new FoundryNode({
        label: 'Workspace IP Cores',
        icon: 'library',
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      });
      workspaceNode.children = specsNodes;
      nodes.push(workspaceNode);
    }

    // 3. Scan Workspace for Bus Definitions
    const busDefNodes = await this.scanWorkspaceForBusDefs();
    if (busDefNodes.length > 0) {
      const busDefNode = new FoundryNode({
        label: 'Workspace Bus Definitions',
        icon: 'circuit-board',
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      });
      busDefNode.children = busDefNodes;
      nodes.push(busDefNode);
    }

    return nodes;
  }

  private async scanWorkspaceForSpecs(): Promise<FoundryNode[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const specFiles: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.{ip.yml,mm.yml}');
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
      specFiles.push(...files);
    }

    if (specFiles.length === 0) {
      return [];
    }

    // Group specs by parent directory path
    const groups = new Map<string, { folderUri: vscode.Uri; files: vscode.Uri[] }>();
    for (const file of specFiles) {
      const dirPath = path.dirname(file.fsPath);
      const relativeDir = vscode.workspace.asRelativePath(dirPath);
      const displayDir = relativeDir === '' || relativeDir === '.' ? 'Root Project' : relativeDir;

      let group = groups.get(displayDir);
      if (!group) {
        group = { folderUri: vscode.Uri.file(dirPath), files: [] };
        groups.set(displayDir, group);
      }
      group.files.push(file);
    }

    const folderNodes: FoundryNode[] = [];
    for (const [folderName, group] of groups.entries()) {
      const fileChildren: NodeDef[] = group.files.map((file) => {
        const basename = path.basename(file.fsPath);
        const isIp = basename.endsWith('.ip.yml');
        return {
          label: basename,
          icon: isIp ? 'package' : 'table',
          resourceUri: file,
          contextValue: isIp ? 'ip-spec' : 'mm-spec',
          command: {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [file],
          },
        };
      });

      // Sort files alphabetically
      fileChildren.sort((a, b) => a.label.localeCompare(b.label));

      const folderNode = new FoundryNode({
        label: folderName,
        icon: 'folder',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: fileChildren,
      });
      folderNodes.push(folderNode);
    }

    // Sort folders alphabetically
    folderNodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    return folderNodes;
  }

  /**
   * Shows whatever standalone bus definition files (YAML, same shape as
   * `ipcraft-spec/bus_definitions/*.yml`, or IP-XACT bus/abstraction
   * definition XML) have already been discovered, grouped by parent
   * directory. Never blocks the tree on the underlying workspace walk:
   * `peekAndScanInBackground()` returns instantly, kicking off a scan in the
   * background the first time and refreshing the tree (via `onDidScan`,
   * subscribed in `setupWatcher`) once it completes.
   */
  private async scanWorkspaceForBusDefs(): Promise<FoundryNode[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const result = getWorkspaceBusDefinitionScanner().peekAndScanInBackground();
    if (result.files.length === 0) {
      return [];
    }

    // Group discovered bus def files by parent directory path
    const groups = new Map<
      string,
      { dirUri: vscode.Uri; entries: { name: string; uri: vscode.Uri }[] }
    >();
    for (const file of result.files) {
      const dirPath = path.dirname(file.uri.fsPath);
      const relativeDir = vscode.workspace.asRelativePath(dirPath);
      const displayDir = relativeDir === '' || relativeDir === '.' ? 'Root Project' : relativeDir;

      let group = groups.get(displayDir);
      if (!group) {
        group = { dirUri: vscode.Uri.file(dirPath), entries: [] };
        groups.set(displayDir, group);
      }
      group.entries.push({ name: path.basename(file.uri.fsPath), uri: file.uri });
    }

    const folderNodes: FoundryNode[] = [];
    for (const [folderName, group] of groups.entries()) {
      const fileChildren: NodeDef[] = group.entries.map((entry) => ({
        label: entry.name,
        icon: 'symbol-interface',
        resourceUri: entry.uri,
        contextValue: 'workspace-bus-def',
        command: {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [entry.uri],
        },
      }));

      fileChildren.sort((a, b) => a.label.localeCompare(b.label));

      const folderNode = new FoundryNode({
        label: folderName,
        icon: 'folder',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: fileChildren,
      });
      folderNodes.push(folderNode);
    }

    folderNodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    return folderNodes;
  }
}

export class FoundryNode extends vscode.TreeItem {
  children?: FoundryNode[];

  constructor(def: NodeDef) {
    super(
      def.label,
      def.collapsibleState ??
        (def.children?.length
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None)
    );

    if (def.icon) {
      this.iconPath = new vscode.ThemeIcon(def.icon);
    }

    if (def.command) {
      this.command = def.command;
    }

    if (def.resourceUri) {
      this.resourceUri = def.resourceUri;
      this.tooltip = def.resourceUri.fsPath;
    }

    if (def.contextValue) {
      this.contextValue = def.contextValue;
    }

    if (def.children?.length) {
      this.children = def.children.map((c) => new FoundryNode(c));
    }
  }
}
