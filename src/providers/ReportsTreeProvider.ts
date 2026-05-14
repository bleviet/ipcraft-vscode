import * as vscode from 'vscode';
import * as path from 'path';
import type { BuildReports, TimingResult, UtilizationResult } from '../services/ReportParser';

export type BuildStatus = 'idle' | 'running' | 'success' | 'failed';

interface NodeDef {
  label: string;
  icon?: string;
  filePath?: string;
  children?: NodeDef[];
}

export class ReportsTreeProvider implements vscode.TreeDataProvider<ReportNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReportNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private status: BuildStatus = 'idle';
  private reports: BuildReports[] = [];

  update(status: BuildStatus, reports: BuildReports[] = []): void {
    this.status = status;
    this.reports = reports;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ReportNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ReportNode): ReportNode[] {
    if (!element) {
      return this.rootNodes();
    }
    return element.children ?? [];
  }

  private rootNodes(): ReportNode[] {
    switch (this.status) {
      case 'idle':
        return [new ReportNode({ label: 'No build yet — run IPCraft: Build' })];
      case 'running':
        return [new ReportNode({ label: 'Building…', icon: 'loading~spin' })];
      case 'failed':
        return [new ReportNode({ label: 'Build failed — check Output Channel', icon: 'error' })];
      case 'success':
        return this.reports.map((r) => this.reportGroupNode(r));
    }
  }

  private reportGroupNode(report: BuildReports): ReportNode {
    const vendor = report.vendor === 'vivado' ? 'Vivado' : 'Quartus';
    const modeLabel = report.mode === 'ooc' ? 'OOC' : report.mode === 'xpr' ? 'XPR' : 'Compile';
    const failed = report.timing?.met === false;
    const children: NodeDef[] = [];

    if (report.timing) {
      children.push(this.timingNodeDef(report.timing, report.vendor, report.reportDir));
    }
    if (report.utilization) {
      children.push(this.utilizationNodeDef(report.utilization));
    }
    if (report.cdc?.violations) {
      children.push({
        label: `CDC: ${report.cdc.violations} violation(s)`,
        icon: 'warning',
        filePath: path.join(report.reportDir, 'cdc.rpt'),
      });
    }

    const node = new ReportNode({
      label: `${vendor} — ${modeLabel}`,
      icon: failed ? 'error' : 'pass',
      children,
    });
    node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    return node;
  }

  private timingNodeDef(
    timing: TimingResult,
    vendor: 'vivado' | 'quartus',
    reportDir: string
  ): NodeDef {
    const filePath = vendor === 'vivado' ? path.join(reportDir, 'timing.rpt') : undefined;
    const children: NodeDef[] = [];

    if (vendor === 'vivado') {
      if (timing.wns !== undefined) {
        const sign = timing.wns >= 0 ? '+' : '';
        children.push({
          label: `WNS ${sign}${timing.wns.toFixed(3)} ns`,
          icon: timing.wns >= 0 ? 'pass' : 'error',
        });
      }
      if (timing.whs !== undefined) {
        const sign = timing.whs >= 0 ? '+' : '';
        children.push({
          label: `WHS ${sign}${timing.whs.toFixed(3)} ns`,
          icon: timing.whs >= 0 ? 'pass' : 'error',
        });
      }
      if (timing.tnsFailingEndpoints !== undefined) {
        children.push({ label: `Failing paths: ${timing.tnsFailingEndpoints}` });
      }
    } else {
      if (timing.fmax !== undefined) {
        children.push({ label: `Fmax: ${timing.fmax.toFixed(2)} MHz`, icon: 'pass' });
      }
      if (!timing.met) {
        children.push({ label: 'Timing requirements not met', icon: 'error' });
      }
    }

    return {
      label: 'Timing',
      icon: timing.met ? 'pass' : 'error',
      filePath,
      children,
    };
  }

  private utilizationNodeDef(util: UtilizationResult): NodeDef {
    const children: NodeDef[] = [];

    const addRow = (label: string, data?: { used: number; total: number; pct: number }) => {
      if (!data) {
        return;
      }
      const text =
        data.total > 0
          ? `${label}: ${data.used.toLocaleString()} / ${data.total.toLocaleString()} (${data.pct.toFixed(1)}%)`
          : `${label}: ${data.used.toLocaleString()}`;
      children.push({ label: text });
    };

    addRow('LUT', util.lut);
    addRow('FF', util.ff);
    addRow('BRAM', util.bram);
    addRow('DSP', util.dsp);

    return { label: 'Utilization', children };
  }
}

class ReportNode extends vscode.TreeItem {
  children?: ReportNode[];

  constructor(def: NodeDef) {
    super(
      def.label,
      def.children?.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    if (def.icon) {
      this.iconPath = new vscode.ThemeIcon(def.icon);
    }

    if (def.filePath) {
      this.command = {
        command: 'vscode.open',
        title: 'Open Report',
        arguments: [vscode.Uri.file(def.filePath)],
      };
      this.tooltip = def.filePath;
    }

    if (def.children?.length) {
      this.children = def.children.map((c) => new ReportNode(c));
    }
  }
}
