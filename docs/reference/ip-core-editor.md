# IP Core Editor Reference

The IP Core editor is the custom visual editor for `*.ip.yml` files. It provides dedicated section editors for all aspects of an IP Core definition.

## Structure

The editor uses a sidebar + panel layout:

```text
+---------------------------+------------------------------------------+
| NavigationSidebar         | EditorPanel                              |
|                           |                                          |
| Metadata                  |  (selected section editor)               |
| Clocks                    |                                          |
| Resets                    |                                          |
| Ports                     |                                          |
| Parameters                |                                          |
| Bus Interfaces            |                                          |
| Memory Maps               |                                          |
| File Sets                 |                                          |
| Generator                 |                                          |
+---------------------------+------------------------------------------+
| Validation Errors (if any)                                           |
+----------------------------------------------------------------------+
```

Keyboard shortcuts: `Ctrl+H` focuses the sidebar, `Ctrl+L` focuses the editor panel.

## Section Editors

### MetadataEditor

Edits the IP Core's VLNV (Vendor, Library, Name, Version) and description. Fields use inline editing with save/cancel.

### ClocksTable

Tabular editor for clock definitions. Each clock has a name, logical name, direction, frequency, and description.

### ResetsTable

Tabular editor for reset signals. Each reset has a name, logical name, direction, polarity (active high/low), and description.

### PortsTable

Tabular editor for user-defined ports (non-bus signals). Each port has a name, logical name, direction, width (can reference a parameter for parameterized widths), and description.

### ParametersTable

Tabular editor for generic parameters. Each parameter has a name, value, data type, and description. Parameter names can be referenced in port widths.

### BusInterfacesEditor

Card-based editor for bus interfaces. Each card shows the interface name, type, mode, physical prefix, and associated clock/reset. Supports:

- Bus interface arrays with configurable count, index start, and naming patterns
- Optional port selection from bus library definitions
- Port width overrides
- Port mapping table for physical-to-logical signal mapping

### MemoryMapsEditor

Editor for memory map references. Displays linked memory maps with `$ref` resolution. Shows registers and address blocks from imported memory map files.

### FileSetsEditor

Editor for file set definitions. Organizes generated and source files into named groups (e.g., RTL, Testbench, Integration).

### GeneratorPanel

VHDL project scaffolding UI. See the [Generator Reference](generator.md) for details on generation options, vendor integration, and template system.

### PortMappingTable

Sub-editor within Bus Interfaces for mapping physical port names to logical signal names and configuring port widths.

## State Management

### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useIpCoreState` | `ipcore/hooks/useIpCoreState.ts` | Parsed IP Core state, update methods, validation |
| `useIpCoreSync` | `ipcore/hooks/useIpCoreSync.ts` | Sends YAML updates to extension host |
| `useNavigation` | `ipcore/hooks/useNavigation.ts` | Section navigation state |
| `useBusInterfaceEditing` | `ipcore/hooks/useBusInterfaceEditing.ts` | Bus interface editing state and actions |

### Layout Components

| Component | File | Purpose |
|-----------|------|---------|
| `NavigationSidebar` | `ipcore/components/layout/NavigationSidebar.tsx` | Section navigation with keyboard |
| `EditorPanel` | `ipcore/components/layout/EditorPanel.tsx` | Routes to section editors |

## Validation

The IP Core editor performs cross-reference validation:

- Checks that `associatedClock` references an existing clock name
- Checks that `associatedReset` references an existing reset name
- Checks that `memoryMapRef` references an existing memory map

Validation errors appear in a panel at the bottom of the editor. Clicking an error navigates to the relevant section and highlights the field.

## Implementation Files

| File | Purpose |
|------|---------|
| `src/webview/ipcore/IpCoreApp.tsx` | App shell, message handling, keyboard shortcuts |
| `src/webview/ipcore/components/layout/` | NavigationSidebar, EditorPanel |
| `src/webview/ipcore/components/sections/` | All section editors (12 files) |
| `src/webview/ipcore/hooks/` | State management hooks (4 files) |
