# IPCraft Control Center UX/UI Concept

This document outlines the visual design, interactive workflows, and technical architecture for the IPCraft Control Center integration using a native VS Code Sidebar Tree View.

---

## 1. UX Strategy & Entry Points

The IPCraft Control Center provides a streamlined, native entry point for managing IP cores and memory maps in the workspace.

### The Entry Point: Activity Bar Icon
A custom IPCraft icon is added to the VS Code Activity Bar. Clicking this icon opens the **IPCraft Control Center** side panel containing a native Tree View (`ipcraft-foundry.navigator`).

### UI Layout: Control Center Sidebar
The sidebar navigator is structured to balance utility and space efficiency. It contains two main logical sections:

1. **Quick Actions**:
   - Pinned at the top of the tree view.
   - Includes links to native file generation commands:
     - **Create IP Core + Register Map**: Opens the native file dialog to generate both specs and link them.
     - **Create IP Core (.ip.yml)**: Creates a blank IP Core.
     - **Create Register Map (.mm.yml)**: Creates a blank Register Map.

2. **Workspace Specifications**:
   - A live list of all `.ip.yml` and `.mm.yml` files detected in the active workspace folders.
   - Files are grouped by project subdirectory using collapsible folder nodes.
   - Clicking a file node opens it directly in its visual editor.
   - Right-clicking a node opens custom context actions (such as generating HDL or building).

---

## 2. Technical Architecture

- **TreeView registration**: Registered under the `ipcraft-foundry` views container in `package.json`.
- **DataProvider**: `IpCoreTreeDataProvider` scans workspace files recursively, builds folder trees dynamically, and registers FS watchers to refresh the list automatically when specs are created or deleted.
- **Icon decoration**: Specifies codicons (`$(package)` for IP cores, `$(table)` for memory maps, `$(folder)` for subdirectories) to ensure visual coherence with standard VS Code themes.
