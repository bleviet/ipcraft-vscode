# Webview (React)

The webview is an embedded browser that renders the visual editors using React. It communicates with the extension host via `postMessage`.

## App Shells

| Editor | Entry | Root Element |
|--------|-------|-------------|
| Memory Map | `src/webview/index.tsx` | `#root` |
| IP Core | `src/webview/ipcore/IpCoreApp.tsx` | `#ipcore-root` |

## Memory Map Components

### Navigation

| Component | File | Role |
|-----------|------|------|
| `Outline` | `components/Outline.tsx` | Sidebar tree with search, expand/collapse, inline rename |
| `DetailsPanel` | `components/DetailsPanel.tsx` | Routes to sub-editors based on selection type |

### Editors

| Component | File | Handles |
|-----------|------|---------|
| `RegisterEditor` | `components/register/RegisterEditor.tsx` | Register properties + bit field table |
| `FieldsTable` | `components/register/FieldsTable.tsx` | Inline-editable field rows with draft layers |
| `BlockEditor` | `components/memorymap/BlockEditor.tsx` | Address block registers |
| `MemoryMapEditor` | `components/memorymap/MemoryMapEditor.tsx` | Top-level memory map blocks |
| `RegisterArrayEditor` | `components/memorymap/RegisterArrayEditor.tsx` | Register array properties |

### Visualizers

| Component | File | Purpose |
|-----------|------|---------|
| `BitFieldVisualizer` | `components/BitFieldVisualizer.tsx` | Visual register bit diagram (3 layout modes) |
| `AddressMapVisualizer` | `components/AddressMapVisualizer.tsx` | Address block visualization |
| `RegisterMapVisualizer` | `components/RegisterMapVisualizer.tsx` | Register layout visualization |

## IP Core Components

### Layout

| Component | File | Role |
|-----------|------|------|
| `NavigationSidebar` | `ipcore/components/layout/NavigationSidebar.tsx` | Section navigation with keyboard support |
| `EditorPanel` | `ipcore/components/layout/EditorPanel.tsx` | Routes to section editors by selected section |

### Section Editors

| Component | File | Handles |
|-----------|------|---------|
| `MetadataEditor` | `ipcore/components/sections/MetadataEditor.tsx` | VLNV, description, API version |
| `ClocksTable` | `ipcore/components/sections/ClocksTable.tsx` | Clock definitions |
| `ResetsTable` | `ipcore/components/sections/ResetsTable.tsx` | Reset signal definitions |
| `PortsTable` | `ipcore/components/sections/PortsTable.tsx` | User-defined port definitions |
| `ParametersTable` | `ipcore/components/sections/ParametersTable.tsx` | Generic parameter definitions |
| `BusInterfacesEditor` | `ipcore/components/sections/BusInterfacesEditor.tsx` | Bus interface cards with arrays |
| `BusInterfaceCard` | `ipcore/components/sections/BusInterfaceCard.tsx` | Individual bus interface editing |
| `PortMappingTable` | `ipcore/components/sections/PortMappingTable.tsx` | Physical-to-logical signal mapping |
| `MemoryMapsEditor` | `ipcore/components/sections/MemoryMapsEditor.tsx` | Memory map references |
| `FileSetsEditor` | `ipcore/components/sections/FileSetsEditor.tsx` | File set definitions |
| `GeneratorPanel` | `ipcore/components/sections/GeneratorPanel.tsx` | VHDL generation UI |
| `InlineEditField` | `ipcore/components/sections/InlineEditField.tsx` | Reusable inline edit component |

## Memory Map Hooks

State management and behavior logic for the Memory Map editor:

| Hook | File | Purpose |
|------|------|---------|
| `useMemoryMapState` | `hooks/useMemoryMapState.ts` | Parsed memory map state from YAML |
| `useSelection` | `hooks/useSelection.ts` | Selection tracking |
| `useYamlSync` | `hooks/useYamlSync.ts` | Bi-directional YAML sync with host |
| `useFieldEditor` | `hooks/useFieldEditor.ts` | Field drafts, selection, insertion, keyboard |
| `useTableNavigation` | `hooks/useTableNavigation.ts` | Arrow/Vim cell navigation |
| `useTableEditing` | `hooks/useTableEditing.ts` | Inline cell editing |
| `useDetailsNavigation` | `hooks/useDetailsNavigation.ts` | Navigation between detail views |
| `useOutlineRename` | `hooks/useOutlineRename.ts` | Inline rename in outline tree |
| `useSelectionResolver` | `hooks/useSelectionResolver.ts` | Resolves selection to data |
| `useSelectionLifecycle` | `hooks/useSelectionLifecycle.ts` | Selection lifecycle management |
| `useYamlUpdateHandler` | `hooks/useYamlUpdateHandler.ts` | Handles YAML update coordination |
| `useAutoFocus` | `hooks/useAutoFocus.ts` | Ref auto-focus |
| `useEscapeFocus` | `hooks/useEscapeFocus.ts` | Escape key refocus |

## IP Core Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useIpCoreState` | `ipcore/hooks/useIpCoreState.ts` | Parsed IP Core state, update methods, validation |
| `useIpCoreSync` | `ipcore/hooks/useIpCoreSync.ts` | Sends YAML updates to extension host |
| `useNavigation` | `ipcore/hooks/useNavigation.ts` | Section navigation state |
| `useBusInterfaceEditing` | `ipcore/hooks/useBusInterfaceEditing.ts` | Bus interface editing state and actions |

## Webview Services

| Service | File | Purpose |
|---------|------|---------|
| `DataNormalizer` | `services/DataNormalizer.ts` | Normalizes varying YAML shapes |
| `YamlPathResolver` | `services/YamlPathResolver.ts` | Path-based YAML updates |
| `YamlService` | `services/YamlService.ts` | Parse/dump YAML |
| `SpatialInsertionService` | `services/SpatialInsertionService.ts` | Insert entities with repacking |
| `FieldOperationService` | `services/FieldOperationService.ts` | Field-level operations (delete, move, update) |

## Algorithms

Pure functions for spatial computations:

| Algorithm | File |
|-----------|------|
| `BitFieldRepacker` | `algorithms/BitFieldRepacker.ts` |
| `RegisterRepacker` | `algorithms/RegisterRepacker.ts` |
| `AddressBlockRepacker` | `algorithms/AddressBlockRepacker.ts` |

## Type Definitions

| File | Content |
|------|---------|
| `types/memoryMap.d.ts` | Generated from `memory_map.schema.json` |
| `types/ipCore.d.ts` | Generated from `ip_core.schema.json` |
| `types/editor.d.ts` | Editor-specific types |
| `types/selection.d.ts` | Selection model types |
| `types/registerModel.ts` | Register model types |

Types are auto-generated from JSON schemas in `ipcraft-spec/schemas/` via `npm run generate-types`.

## Bitfield Subdirectory

`src/webview/components/bitfield/` contains extracted modules for the `BitFieldVisualizer`:

| Module | Purpose |
|--------|---------|
| `ProLayoutView.tsx` | Pro layout rendering |
| `DefaultLayoutView.tsx` | Default layout rendering |
| `VerticalLayoutView.tsx` | Vertical (side-by-side) layout |
| `FieldCell.tsx` | Individual bit-field cell rendering |
| `ValueBar.tsx` | Hex value bar component |
| `useShiftDrag.ts` | Resize/create drag state machine |
| `useCtrlDrag.ts` | Reorder drag state machine |
| `useValueEditing.ts` | Reset value editing state machine |
| `reorderAlgorithm.ts` | Ctrl-drag reorder computation |
| `keyboardOperations.ts` | Keyboard reorder/resize helpers |
| `renderBitCellStyle.ts` | Shared bit-cell styling across layouts |
| `utils.ts` | Shared utility functions |
| `types.ts` | Bitfield-specific type definitions |
| `index.ts` | Barrel exports |

## Outline Subdirectory

`src/webview/components/outline/` contains the sidebar tree navigation system:

| Module | Purpose |
|--------|---------|
| `OutlineHeader.tsx` | Search bar and expand/collapse controls |
| `OutlineTreeNodes.tsx` | Recursive tree node rendering |
| `BlockNode.tsx` | Address block tree node |
| `RegisterNode.tsx` | Register tree node |
| `RegisterArrayNode.tsx` | Register array tree node with expand |
| `FieldNode.tsx` | Bit field tree node |
| `useOutlineKeyboard.ts` | Keyboard navigation within the tree |
| `buildVisibleSelections.ts` | Computes visible selection state |
| `outlineIds.ts` | Stable ID generation for tree nodes |
| `types.ts` | Outline-specific type definitions |
| `index.ts` | Barrel exports |

## Shared Components

`src/webview/shared/components/` contains reusable form and table components used across both editors:

| Component | Purpose |
|-----------|---------|
| `EditableTable.tsx` | Generic inline-editable table with add/delete |
| `FormField.tsx` | Labeled form field wrapper |
| `SelectField.tsx` | Dropdown select field |
| `NumberField.tsx` | Numeric input field |
| `TextAreaField.tsx` | Multi-line text input |
| `CheckboxField.tsx` | Checkbox input |
| `KeyboardShortcutsButton.tsx` | Keyboard shortcuts help dialog |

## Shared Utilities

`src/webview/shared/utils/` contains utilities shared between Memory Map and IP Core editors:

| Module | Purpose |
|--------|---------|
| `validation.ts` | Field and register validation helpers |
| `fieldValidation.ts` | Bit field-specific validation |
| `formatters.ts` | Display formatting utilities |
| `yamlKeyMapper.ts` | Maps between UI keys and YAML keys |
| `focus.ts` | Focus management utilities |

## Webview Utilities

`src/webview/utils/` contains editor-specific utility modules:

| Module | Purpose |
|--------|---------|
| `BitFieldUtils.ts` | Bit range parsing, formatting, ownership |
| `blockSize.ts` | Address block size calculations |
| `formatUtils.ts` | Number formatting helpers |
