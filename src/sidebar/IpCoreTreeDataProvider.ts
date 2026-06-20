import * as vscode from 'vscode';
import * as path from 'path';

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

  constructor() {
    this.setupWatcher();
  }

  private setupWatcher(): void {
    // Refresh the tree when yml files are created, changed, or deleted
    this.workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ip.yml,mm.yml}');
    this.workspaceWatcher.onDidCreate(() => this.refresh());
    this.workspaceWatcher.onDidChange(() => this.refresh());
    this.workspaceWatcher.onDidDelete(() => this.refresh());
  }

  dispose(): void {
    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
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
