# IPCraft Sidebar Navigator Integration Plan

This document outlines the design and implementation plan for the IPCraft Activity Bar and Sidebar TreeView integration, excluding any custom Webview dashboard tab.

---

## Technical Design

### 1. package.json Contributions
- Add the `ipcraft-foundry` views container under `contributes.viewsContainers.activitybar`.
- Register the `ipcraft-foundry.navigator` tree view under `contributes.views.ipcraft-foundry`.

### 2. Sidebar TreeView Data Provider
- Create `src/sidebar/IpCoreTreeDataProvider.ts`.
- Implement `vscode.TreeDataProvider` scanning workspace recursively for `*.ip.yml` and `*.mm.yml`.
- Render root collapsible section for "Quick Actions" linking directly to native file creation commands.
- Group detected workspace files under folders representing their containing subdirectories.
- Add filesystem watchers to automatically refresh the view on changes.

### 3. Extension Activation
- Instantiate and register `IpCoreTreeDataProvider` under view ID `ipcraft-foundry.navigator`.
