# Porting Python IPCraft Features to ipcraft-vscode

> **Goal:** Bring every feature from the Python `ipcraft` CLI/library into the VS Code extension, so users have full parity within the editor.

---

## Current State Summary

### What ipcraft-vscode already has

| Area | Status |
|---|---|
| VHDL generation (pkg, top, core, bus wrapper, regs) | ✅ Complete |
| VHDL import → `.ip.yml` | ✅ Complete |
| Visual memory map editor (outline, register map, bitfield) | ✅ Complete |
| Visual IP core editor (metadata, ports, clocks, resets, bus interfaces, file sets) | ✅ Complete |
| AXI4-Lite & Avalon-MM bus wrappers | ✅ Complete |
| Cocotb testbench & Makefile generation | ✅ Complete |
| Altera `_hw.tcl` generation | ✅ Complete |
| AMD/Xilinx `component.xml` + XGUI generation | ✅ Complete |
| `$import` for memory maps & file sets | ✅ Complete |
| Bus library loading (built-in + custom) | ✅ Complete |
| Enumerated values on bitfields | ✅ Complete |
| Register arrays (count/stride) | ✅ Complete |
| File set auto-update after generation | ✅ Complete |
| Bitfield drag/resize/reorder in visual editor | ✅ Complete |
| Three bitfield layout views (default, pro, vertical) | ✅ Complete |

### What is missing (features in Python ipcraft but not in ipcraft-vscode)

| # | Feature | Priority | Effort |
|---|---|---|---|
| 1 | Verilog parser | High | Medium |
| 2 | IP-XACT (`component.xml`) parser | High | Large |
| 3 | Intel `_hw.tcl` parser | Medium | Medium |
| 4 | Parse dispatcher (auto-detect input format) | Medium | Small |
| 5 | Comprehensive validation framework | Critical | Large |
| 6 | Register map documentation generation (Markdown) | High | Small |
| 7 | Register templates (reusable register definitions) | Medium | Medium |
| 8 | Runtime/driver layer (Python register abstraction) | Low | Large |
| 9 | Interactive init wizard (TUI-style project scaffolding) | Medium | Medium |
| 10 | Dry-run mode for generation | Medium | Small |
| 11 | Watch mode for auto-regeneration | Low | Small |
| 12 | Custom template directory support | Medium | Medium |
| 13 | Template context dump (`--dump-context`) | Low | Small |
| 14 | ASCII IP symbol diagram | Low | Small |
| 15 | Xilinx `package_ip.tcl` template | Medium | Small |
| 16 | `memmap.yml` generation (Python driver memory map) | Low | Small |
| 17 | Structured output layout (`rtl/`, `tb/`, `docs/`, …) | Medium | Small |
| 18 | JSON machine-readable output mode | Low | Small |
| 19 | Generation progress reporting | Low | Small |

---

## Phase 1 — Validation Framework

**Why first:** Validation is foundational — every subsequent feature (parsers, generation, editing) benefits from a robust validation layer. The current `YamlValidator` only checks YAML syntax; the Python version validates 100+ rules.

### Task 1.1 — Create `IpCoreValidator` service

**File:** `src/services/IpCoreValidator.ts`

Implement a validation service modeled after `ipcraft/model/validators.py::IpCoreValidator`.

**Validation rules to implement:**

1. **VLNV validation**
   - All four fields (vendor, library, name, version) must be non-empty strings
   - Only valid characters allowed (alphanumeric, `.`, `-`, `_`)
   - Version should follow semver-like pattern

2. **Clock validation**
   - Clock names must be unique
   - Physical name must exist
   - Frequency format validation if provided (supports Hz, KHz, MHz, GHz suffixes)

3. **Reset validation**
   - Reset names must be unique
   - Physical name must exist
   - Polarity must be `"activeHigh"` or `"activeLow"`

4. **Port validation**
   - Port names must be unique
   - Direction must be `"in"`, `"out"`, or `"inout"`
   - Width must be positive integer or valid parameter reference
   - No conflicts with bus interface physical ports

5. **Bus interface validation**
   - Interface names must be unique
   - Type must exist in loaded bus library
   - Mode must be valid for bus type (`master`/`slave` for AXI/Avalon, `source`/`sink` for streaming)
   - Physical prefix must be non-empty
   - `associated_clock` and `associated_reset` must reference existing clocks/resets
   - `memory_map_ref` must reference existing memory map (if specified)
   - Port width overrides must be positive integers
   - Array config validation: `count` ≥ 1, `index_start` ≥ 0, patterns must contain `{index}` placeholder

6. **Memory map validation**
   - Memory map names must be unique
   - Address block names must be unique within a memory map
   - Address block overlap detection (no two blocks may occupy same address range)
   - Register name uniqueness within a block
   - Register offset must be non-negative and word-aligned
   - Field bit-range validation: no field overlaps within a register
   - Field width + offset must not exceed register size
   - Access type must be one of the valid enum values
   - Register array: stride must be ≥ 4 and word-aligned, count ≥ 1
   - Reset values must fit within the field/register width

7. **File set validation**
   - File set names must be unique
   - File paths must be non-empty
   - File types must be valid enum values

8. **Parameter validation**
   - Parameter names must be unique
   - Data types must be valid (`integer`, `natural`, `positive`, `real`, `boolean`, `string`)
   - Value must be compatible with declared data type

**Implementation details:**
- Return structured results: `{ valid: boolean, errors: ValidationError[], warnings: ValidationWarning[] }`
- Each error/warning should include: `path` (YAML path, e.g., `busInterfaces[0].associated_clock`), `message`, `severity`
- Integrate with VS Code diagnostics API to show squiggles in the YAML text editor

**Reference files:**
- Python: `ipcraft/model/validators.py`
- Python: `ipcraft/model/memory_map.py` (address overlap logic)
- VS Code: `src/services/YamlValidator.ts` (extend or wrap)

### Task 1.2 — Create `MemoryMapValidator` service

**File:** `src/services/MemoryMapValidator.ts`

Focused validation for `.mm.yml` files (can be used standalone without an IP core context).

**Rules:**
- Address block base addresses must not overlap
- Register offsets must not collide within a block
- Bitfield ranges must not overlap within a register
- Bitfields must fit within the register width
- All `access` values must be from the valid enum set
- `enumerated_values` keys must be valid integers fitting in the field width
- Register array stride × count must not exceed the address block range

### Task 1.3 — Wire validators into editor providers

**Files to modify:**
- `src/providers/MemoryMapEditorProvider.ts`
- `src/providers/IpCoreEditorProvider.ts`
- `src/services/MessageHandler.ts`

**Steps:**
1. Run validation on document open and on every document change (debounced, 500ms)
2. Report errors/warnings via `vscode.languages.createDiagnosticCollection`
3. Send validation results to webview for inline error indicators
4. Add a `fpga-ip-core.validate` command to the command palette

### Task 1.4 — Add JSON Schema validation

**Files to modify:**
- `src/services/YamlValidator.ts`

**Steps:**
1. Add `ajv` (or similar) as a dependency
2. Load schemas from `ipcraft-spec/schemas/ip_core.schema.json` and `memory_map.schema.json`
3. Validate parsed YAML against the JSON schema before running semantic validators
4. Map schema validation errors to `ValidationError[]` format

---

## Phase 2 — Additional Parsers

### Task 2.1 — Verilog parser

**File:** `src/parser/VerilogParser.ts`

Port `ipcraft/parser/hdl/verilog_parser.py` to TypeScript.

**Features to implement:**
- Extract module name from `module <name> (` declaration
- Parse parameter definitions from `#(parameter ...)` blocks
  - Name, type, default value
- Parse port declarations (both ANSI and non-ANSI styles)
  - Direction: `input`, `output`, `inout`
  - Width: from `[N:0]` range expressions
  - Wire/reg distinction
- Strip `//` and `/* */` comments before parsing
- Handle `include directives gracefully (skip them)

**Approach:**
- Use regex-based parsing similar to existing `VhdlParser.ts` style
- Reference: `ipcraft/parser/hdl/verilog_parser.py` (pyparsing grammar → convert to regex/manual parser)

**Output model:** Same `IpCoreData` structure as VHDL parser produces.

**Test file:** `src/test/suite/parser/VerilogParser.test.ts`
- Test with simple modules, parameterized modules, multi-port entities
- Add Verilog fixture files to `src/test/fixtures/`

### Task 2.2 — IP-XACT parser

**File:** `src/parser/IpXactParser.ts`

Port `ipcraft/parser/vendor/ipxact_parser.py` to TypeScript.

**Features to implement:**
- Parse Xilinx IP-XACT `component.xml` files
- Support both namespaces:
  - IP-XACT 2009: `spirit:` namespace (`http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009`)
  - IP-XACT 2014: `ipxact:` namespace (`http://www.accellera.org/XMLSchema/IPXACT/1685-2014`)
- Extract:
  - VLNV from `<vendor>`, `<library>`, `<name>`, `<version>` elements
  - Ports from `<model><ports><port>` elements (name, direction, width from vectors)
  - Bus interfaces from `<busInterfaces><busInterface>` (name, type VLNV, mode, port maps)
  - Parameters from `<parameters><parameter>` (name, value, type)
  - Clock/reset classification from bus interface associations
  - Memory maps from `<memoryMaps><memoryMap>` (address blocks, registers, fields)
- Bus type mapping: `aximm` → `AXI4_LITE` or `AXI4_FULL` (use address width heuristic: ≤ 32 → Lite)

**Dependencies:**
- Use a lightweight XML parser: `fast-xml-parser` or Node.js built-in `DOMParser` (available in extension host)

**Test file:** `src/test/suite/parser/IpXactParser.test.ts`
- Add IP-XACT fixture files (Xilinx-generated component.xml samples)

### Task 2.3 — Intel `_hw.tcl` parser

**File:** `src/parser/HwTclParser.ts`

Port `ipcraft/parser/vendor/hw_tcl_parser.py` to TypeScript.

**Features to implement:**
- Regex-based extraction (no TCL interpreter needed):
  - `set_module_property NAME <value>` → VLNV fields, description
  - `add_interface <name> <type> <direction>` → bus interface list
  - `set_interface_property <name> <prop> <value>` → associated clock/reset
  - `add_interface_port <iface> <physical> <logical> <dir> <width>` → port mappings
  - `add_parameter <name> <type> <default>` → parameters
- Interface direction mapping: `end`/`slave`/`sink` vs `start`/`master`/`source`
- Bus type mapping for Avalon and AXI variants

**Test file:** `src/test/suite/parser/HwTclParser.test.ts`
- Add `_hw.tcl` fixture files

### Task 2.4 — Parse dispatcher

**File:** `src/parser/ParseDispatcher.ts`

Port `ipcraft/parser/vendor/parse_dispatcher.py` to TypeScript.

**Features to implement:**
- Auto-detect input file format from extension and content:
  - `.vhd`, `.vhdl` → `VhdlParser`
  - `.v`, `.sv` → `VerilogParser`
  - `*_hw.tcl` → `HwTclParser`
  - `.xml` (with IP-XACT root element) → `IpXactParser`
- Unified `parse(filePath: string): Promise<IpCoreData>` interface
- Error handling for unsupported formats

### Task 2.5 — Register "Import from…" commands

**Files to modify:**
- `src/commands/GenerateCommands.ts`
- `package.json` (add commands and context menus)

**New commands:**
- `fpga-ip-core.parseVerilog` — Import from Verilog file
- `fpga-ip-core.parseIpXact` — Import from IP-XACT `component.xml`
- `fpga-ip-core.parseHwTcl` — Import from Intel `_hw.tcl`
- `fpga-ip-core.parseAny` — Auto-detect format and import (uses ParseDispatcher)

**Context menu entries:**
- Add these to Explorer context menu for relevant file extensions (`.v`, `.sv`, `.xml`, `.tcl`)
- Add "Import to IP Core YAML…" to editor title menu

**UI flow:**
1. User right-clicks file → "Import to IP Core YAML…"
2. Dispatcher detects format, runs parser
3. Quick pick for VLNV fields (vendor, library, version) — pre-fill from parsed data
4. Option to also generate `.mm.yml` skeleton (checkbox)
5. Opens generated `.ip.yml` in the visual editor

---

## Phase 3 — Enhanced Code Generation

### Task 3.1 — Register map Markdown documentation generation

**File:** `src/generator/RegmapDocGenerator.ts`
**Template:** `src/generator/templates/regmap_docs.md.j2`

Port `regmap_docs.md.j2` from the Python repo.

**Output:** `{name}_regmap.md` containing:
- Title and description
- Register summary table (offset in hex, name, access, reset value, description)
- Per-register detail sections:
  - Bitfield table (bits range, field name, access, reset, description)
  - Enumerated value tables where applicable
- Register array sections with indexed names
- Address block headers with base address and range

**Integration:**
- Add to `IpCoreScaffolder.ts` as an optional generation step
- Add checkbox in `GeneratorPanel.tsx`: "Generate register map documentation"
- Place output in `docs/` subdirectory when using structured layout

### Task 3.2 — Xilinx `package_ip.tcl` template

**Template:** `src/generator/templates/amd_package_ip_tcl.j2`

Port `xilinx_package_ip_tcl.j2` from the Python repo.

**Content:**
- Temporary Vivado project creation script
- Source file discovery via `glob`
- IP-XACT core setup
- VLNV metadata application
- Bus interface property setting
- Parameter definitions
- Packaging and archival

**Integration:**
- Generate alongside `component.xml` when AMD/Xilinx vendor is selected
- Output path: `amd/package_ip.tcl`
- Add to file set under "Integration" category

### Task 3.3 — `memmap.yml` generation for Python drivers

**Template:** `src/generator/templates/memmap.yml.j2` (already exists as placeholder)

Port the actual `memmap.yml.j2` content from the Python repo.

**Content:**
- Simplified YAML memory map consumable by `ipcraft.runtime` Python driver
- Registers with absolute addresses (base + offset)
- Field definitions with bit ranges and access types
- Used by cocotb testbenches to auto-discover registers

**Integration:**
- Generate alongside cocotb testbench files
- Output path: `tb/memmap.yml`

### Task 3.4 — Structured output layout

**File to modify:** `src/generator/IpCoreScaffolder.ts`

Currently all generated files are placed in a flat or semi-structured layout. Fully implement the structured layout matching the Python `generate_all_with_structure()`:

```
output/
├── rtl/
│   ├── {name}_pkg.vhd
│   ├── {name}.vhd
│   ├── {name}_core.vhd
│   ├── {name}_{bus}.vhd
│   └── {name}_regs.vhd          (optional)
├── tb/
│   ├── {name}_test.py           (optional)
│   ├── Makefile                 (optional)
│   └── memmap.yml               (optional)
├── docs/
│   └── {name}_regmap.md         (optional)
├── intel/
│   └── {name}_hw.tcl            (if vendor=intel|both)
└── amd/
    ├── component.xml            (if vendor=amd|both)
    ├── package_ip.tcl           (if vendor=amd|both)
    └── xgui/{name}_v*.tcl       (if vendor=amd|both)
```

**Steps:**
1. Rename `altera/` to `intel/` to match Python convention (or make configurable)
2. Add `docs/` output directory
3. Ensure file set updater categorizes files into correct sets

### Task 3.5 — Custom template directory support

**Files to modify:**
- `src/generator/TemplateLoader.ts`
- `src/generator/IpCoreScaffolder.ts`
- `package.json` (add setting)

**Implementation:**
1. Add VS Code setting: `ipcraft.customTemplateDirs: string[]`
2. Modify `TemplateLoader` to search custom directories first, then fall back to built-in templates
3. Support multiple cascading directories (first match wins)
4. Document the template context variables available to custom templates

**Setting in `package.json`:**
```json
{
  "ipcraft.customTemplateDirs": {
    "type": "array",
    "items": { "type": "string" },
    "default": [],
    "description": "Additional directories to search for Jinja2/Nunjucks templates (searched before built-in templates)"
  }
}
```

### Task 3.6 — Template context dump

**Files to modify:**
- `src/generator/IpCoreScaffolder.ts`
- `src/commands/GenerateCommands.ts`

**Implementation:**
1. Add option to dump the full Nunjucks template context as `template_context.json`
2. Add command: `fpga-ip-core.dumpTemplateContext`
3. Useful for users writing custom templates to inspect available variables
4. Only generate when explicitly requested (checkbox or command)

### Task 3.7 — Dry-run mode for generation

**Files to modify:**
- `src/generator/IpCoreScaffolder.ts`
- `src/commands/GenerateCommands.ts`
- `src/webview/ipcore/components/sections/GeneratorPanel.tsx`

**Implementation:**
1. Add `dryRun: boolean` option to scaffolder
2. When `dryRun` is true:
   - Compute all output file paths
   - Check which files already exist (new / changed / unchanged / unmanaged)
   - Return a summary without writing any files
3. Show dry-run results in a VS Code information message or output channel:
   - 🆕 `rtl/my_core_pkg.vhd` (new)
   - ✏️ `rtl/my_core.vhd` (modified)
   - ✅ `rtl/my_core_axil.vhd` (unchanged)
   - ⚠️ `rtl/my_core_custom.vhd` (unmanaged — will not overwrite)
4. Add "Preview Generation" button in GeneratorPanel
5. Ask for confirmation after dry-run before proceeding with actual generation

### Task 3.8 — Generation progress reporting

**Files to modify:**
- `src/generator/IpCoreScaffolder.ts`
- `src/commands/GenerateCommands.ts`

**Implementation:**
1. Use `vscode.window.withProgress()` to show a progress bar during generation
2. Report each file being generated: "Generating rtl/my_core_pkg.vhd… (3/12)"
3. Show summary notification on completion: "Generated 12 files in rtl/, tb/, docs/"

---

## Phase 4 — Interactive Project Scaffolding

### Task 4.1 — Enhanced `ipcraft new` wizard

**File:** `src/commands/FileCreationCommands.ts` (extend existing)

Port the `ipcraft init` / `ipcraft new` interactive wizard from `ipcraft/cli_init.py`.

**Wizard flow (using VS Code Quick Picks and Input Boxes):**

1. **Step 1 — IP Core name**
   - Input box: "Enter IP core name" (validate: non-empty, valid identifier)

2. **Step 2 — VLNV metadata**
   - Input box: Vendor (default: "user")
   - Input box: Library (default: "ip")
   - Input box: Version (default: "1.0.0")

3. **Step 3 — Bus interface selection**
   - Quick pick: "Select primary bus interface"
   - Options: `AXI4-Lite (Recommended)`, `Avalon-MM`, `AXI4 Full`, `AXI Stream`, `Avalon Streaming`, `None`

4. **Step 4 — Bus mode**
   - Quick pick: "Bus interface mode"
   - Options: `Slave`, `Master` (filtered by bus type)

5. **Step 5 — Memory map**
   - Quick pick: "Create memory map?"
   - Options: `Yes — create linked .mm.yml`, `No — add later`

6. **Step 6 — Output directory**
   - Folder picker: "Select output directory"
   - Default: workspace root or current folder

7. **Step 7 — Generation options**
   - Multi-select quick pick: "What to generate?"
   - Options: `VHDL RTL`, `Register bank`, `Cocotb testbench`, `Intel Platform Designer files`, `AMD/Xilinx Vivado files`, `Register map documentation`

8. **Step 8 — Confirmation**
   - Show summary of selections
   - Confirm → generate `.ip.yml` + `.mm.yml` + selected artifacts

**Output:**
- `.ip.yml` file pre-populated with VLNV, bus interface, clocks, resets
- `.mm.yml` file (if selected) with a skeleton address block containing CTRL/STATUS registers
- Optionally auto-run VHDL generation

**Command:** `fpga-ip-core.initProject`
**Keybinding:** Consider `Ctrl+Shift+I` or no default

### Task 4.2 — ASCII IP symbol diagram in webview

**File:** `src/webview/ipcore/components/IpSymbolDiagram.tsx`

Port `ipcraft.utils.ascii_diagram.generate_ascii_diagram()` — but render as an SVG/HTML component in the webview rather than ASCII text.

**Features:**
- Visual IP block symbol with:
  - Entity name at center
  - Input ports on the left
  - Output ports on the right
  - Bidirectional ports on the bottom
  - Bus interfaces labeled with protocol name
  - Clock/reset ports distinguished with icons
  - Port widths shown as bus notation (e.g., `[31:0]`)
- Auto-layout based on port count
- Updates live as ports are added/removed in the editor

**Integration:**
- Add as a collapsible section in the IP Core editor ("IP Symbol Preview")
- Alternatively, add as a command: `fpga-ip-core.showSymbol` that opens a side panel

---

## Phase 5 — Register Templates

### Task 5.1 — Register template YAML support

**Files to modify:**
- `src/webview/services/YamlService.ts`
- `src/webview/services/DataNormalizer.ts`
- `ipcraft-spec/schemas/memory_map.schema.json`

**YAML format to support:**
```yaml
---
registerTemplates:
  STANDARD_STATUS:
    fields:
      - name: "BUSY"
        bits: "[0]"
        access: "read-only"
      - name: "ERROR"
        bits: "[1]"
        access: "read-only"
  STANDARD_CTRL:
    fields:
      - name: "ENABLE"
        bits: "[0]"
        access: "read-write"
      - name: "RESET"
        bits: "[1]"
        access: "write-1-to-clear"
---
memoryMaps:
  - name: "default"
    addressBlocks:
      - name: "regs"
        baseAddress: 0x0
        range: "4K"
        registers:
          - name: "STATUS"
            offset: 0x00
            template: "STANDARD_STATUS"
          - name: "CTRL"
            offset: 0x04
            template: "STANDARD_CTRL"
```

**Implementation:**
1. Support multi-document YAML (separated by `---`)
2. Parse `registerTemplates` from the first document
3. When a register has a `template` field, resolve it against the template library
4. Merge template fields with register-specific overrides (register fields take priority)
5. Normalize into standard `RegisterDef` objects after template resolution

### Task 5.2 — Register template UI in webview

**Files:**
- `src/webview/components/memorymap/RegisterTemplatePanel.tsx` (new)
- `src/webview/hooks/useRegisterTemplates.ts` (new)

**Features:**
- Panel showing available register templates
- "Apply template" action on a register (replaces fields with template fields)
- "Save as template" action on a register (extracts fields into a template)
- Template library browser with preview of fields
- Template management (create, edit, delete)

### Task 5.3 — Built-in register template library

**File:** `src/resources/register_templates.yml`

**Provide common register templates:**
- `CTRL` — Enable, Reset, Mode select
- `STATUS` — Busy, Error, Done, Overflow
- `IRQ_STATUS` — Interrupt status (W1C fields)
- `IRQ_ENABLE` — Interrupt enable mask
- `IRQ_SET` — Software interrupt set
- `VERSION` — Major, Minor, Patch (read-only)
- `SCRATCH` — Scratch pad register (read-write)
- `ID` — Read-only identification register

---

## Phase 6 — Watch Mode & Automation

### Task 6.1 — Auto-regeneration on file change

**File:** `src/services/WatchService.ts` (new)

Port `--watch` flag behavior from `ipcraft/cli.py`.

**Implementation:**
1. Use `vscode.workspace.createFileSystemWatcher` to watch `.ip.yml` and `.mm.yml` files
2. On change, debounce (1 second), then auto-regenerate VHDL output
3. Show status bar item: "IPCraft: Watching ⟳" or "IPCraft: Idle"
4. Only regenerate files that are affected by the change (if possible, otherwise regenerate all)
5. Report results in an output channel: "IPCraft Output"

**Commands:**
- `fpga-ip-core.startWatch` — Start watching current IP core file
- `fpga-ip-core.stopWatch` — Stop watching

**Activation:**
- Toggle via status bar click
- Setting: `ipcraft.autoRegenerate: boolean` (default: `false`)

### Task 6.2 — Output channel for generation logs

**File:** `src/utils/OutputChannel.ts` (new)

**Implementation:**
1. Create `vscode.window.createOutputChannel("IPCraft")`
2. Route all generation logs (file created, skipped, errors) to this channel
3. Auto-reveal channel on errors
4. Timestamp each entry
5. Use in watch mode, validation, and normal generation

---

## Phase 7 — JSON Output Mode & CLI Integration

### Task 7.1 — Machine-readable JSON output

**File:** `src/services/JsonOutputService.ts` (new)

**Purpose:** Enable programmatic integration with external tools, CI/CD pipelines.

**Implementation:**
1. Define JSON response schemas for each operation:
   ```typescript
   interface GenerationResult {
     success: boolean;
     files: { path: string; status: 'created' | 'updated' | 'skipped' | 'error'; }[];
     errors: { message: string; path?: string; }[];
   }
   
   interface ValidationResult {
     valid: boolean;
     errors: { path: string; message: string; severity: 'error' | 'warning'; }[];
   }
   
   interface ParseResult {
     success: boolean;
     outputFiles: string[];
     warnings: string[];
   }
   ```
2. Add JSON output option to generation and validation commands
3. Write to output channel in structured format

### Task 7.2 — CLI bridge for external tool integration

**File:** `src/commands/CliCommands.ts` (new)

**Purpose:** Allow running ipcraft operations from VS Code's integrated terminal or task runner.

**Implementation:**
1. Register VS Code tasks for common operations:
   - `ipcraft: Generate VHDL` — runs generation on the active file
   - `ipcraft: Validate` — runs validation on the active file
   - `ipcraft: Parse` — imports a file
2. Task definitions in `package.json` `taskDefinitions`
3. Problem matchers to parse validation errors into VS Code's Problems panel

---

## Phase 8 — Runtime & Driver Features

> **Note:** This phase is lower priority because the Python runtime/driver is primarily used in simulation (cocotb) and Python scripting contexts, not within VS Code. Consider whether these features add value in the extension or should remain Python-only.

### Task 8.1 — Generate Python driver module

**Template:** `src/generator/templates/driver.py.j2` (new)

**Features:**
- Generate a Python module with register/field classes for each memory map
- Classes include `read()`, `write()`, `read_field()`, `write_field()` methods
- Auto-generated from memory map definition
- Compatible with `ipcraft.runtime.register` base classes

**Output:** `tb/{name}_driver.py` or `sw/{name}_regs.py`

### Task 8.2 — Generate C header for register definitions

**Template:** `src/generator/templates/regs_header.h.j2` (new)

**Features:**
- `#define` macros for register addresses
- `#define` macros for field masks and shifts
- Struct definitions for register layouts (bitfield structs)
- Read/write accessor macros
- Enumerated value `#define` constants

**Output:** `sw/{name}_regs.h`

This is a commonly requested feature for embedded firmware development.

### Task 8.3 — Generate SystemVerilog header

**Template:** `src/generator/templates/regs_svh.j2` (new)

**Features:**
- `parameter` definitions for register addresses
- `typedef enum` for field enumerations
- `typedef struct packed` for register layouts
- Package wrapper

**Output:** `rtl/{name}_regs_pkg.sv`

---

## Phase 9 — Quality of Life Improvements

### Task 9.1 — Webview validation error indicators

**Files to modify:**
- `src/webview/components/outline/OutlineNode.tsx`
- `src/webview/components/DetailsPanel.tsx`
- `src/webview/hooks/useValidation.ts` (new)

**Implementation:**
1. Extension sends validation results to webview via `postMessage`
2. Outline tree nodes show error/warning icons (🔴/🟡) next to invalid items
3. Details panel shows inline error messages below invalid fields
4. Clicking an error in the Problems panel navigates to the relevant element in the visual editor

### Task 9.2 — Register map documentation preview

**Files:**
- `src/commands/PreviewCommands.ts` (new)

**Implementation:**
1. Command: `fpga-ip-core.previewRegmap`
2. Opens a VS Code Markdown preview panel showing the generated register map documentation
3. Auto-updates on memory map changes (live preview)
4. Uses `vscode.commands.executeCommand('markdown.showPreview')`

### Task 9.3 — Code lens for generation

**File:** `src/providers/IpCoreCodeLensProvider.ts` (new)

**Implementation:**
1. Show code lenses above the VLNV section in `.ip.yml` files:
   - `▶ Generate VHDL` — triggers generation
   - `✓ Validate` — triggers validation
   - `📋 Preview Register Map` — opens regmap docs preview
2. Show code lenses in `.mm.yml` files:
   - `✓ Validate Memory Map` — triggers memory map validation

### Task 9.4 — Hover information in YAML text editor

**File:** `src/providers/YamlHoverProvider.ts` (new)

**Implementation:**
1. Register hover provider for `.ip.yml` and `.mm.yml` files
2. Show contextual information on hover:
   - Register: computed absolute address, total fields, access summary
   - Field: bit range visualization, mask in hex, max value
   - Address block: address range, register count, utilization %
   - Bus interface: expanded port list, required vs optional ports
3. Use `vscode.languages.registerHoverProvider`

### Task 9.5 — Completion provider for YAML text editor

**File:** `src/providers/YamlCompletionProvider.ts` (new)

**Implementation:**
1. Register completion provider for `.ip.yml` and `.mm.yml`
2. Contextual completions:
   - `access:` → suggest `read-only`, `write-only`, `read-write`, `write-1-to-clear`
   - `type:` (bus interface) → suggest `AXI4_LITE`, `AVALON_MM`, `AXI_STREAM`, etc.
   - `mode:` → suggest `master`, `slave`, `source`, `sink`
   - `polarity:` → suggest `activeHigh`, `activeLow`
   - `data_type:` → suggest `integer`, `natural`, `positive`, `boolean`, `string`
   - `associated_clock:` → suggest from available clock names
   - `associated_reset:` → suggest from available reset names
   - `template:` (register) → suggest from `registerTemplates`
   - `import:` → file path completion for `.mm.yml` / `.ip.yml` files
3. Snippet completions for common constructs (new register, new field, new bus interface)

---

## Phase 10 — Testing & Documentation

### Task 10.1 — Parser test suites

**Files:**
- `src/test/suite/parser/VerilogParser.test.ts`
- `src/test/suite/parser/IpXactParser.test.ts`
- `src/test/suite/parser/HwTclParser.test.ts`
- `src/test/suite/parser/ParseDispatcher.test.ts`

**Test fixtures needed:**
- `src/test/fixtures/simple_module.v` — basic Verilog module
- `src/test/fixtures/parameterized_module.v` — module with parameters
- `src/test/fixtures/axi_slave.v` — Verilog with AXI-Lite slave ports
- `src/test/fixtures/component.xml` — Xilinx IP-XACT sample
- `src/test/fixtures/component_2009.xml` — IP-XACT 2009 namespace sample
- `src/test/fixtures/my_core_hw.tcl` — Intel Platform Designer sample

**Coverage targets:**
- Each parser: ≥ 90% line coverage
- Edge cases: empty files, malformed inputs, partial declarations

### Task 10.2 — Validator test suites

**Files:**
- `src/test/suite/services/IpCoreValidator.test.ts`
- `src/test/suite/services/MemoryMapValidator.test.ts`

**Test categories:**
- Valid inputs → no errors
- Missing required fields → appropriate errors
- Duplicate names → uniqueness errors
- Address/bitfield overlaps → collision errors
- Invalid enum values → type errors
- Cross-reference validation → reference errors (e.g., non-existent clock)

### Task 10.3 — Generator test suites

**Files:**
- `src/test/suite/generator/RegmapDocGenerator.test.ts`
- `src/test/suite/generator/DryRun.test.ts`

### Task 10.4 — Update extension documentation

**Files to create/update:**
- `docs/features/validation.md` — Document all validation rules
- `docs/features/parsers.md` — Document import capabilities (supported formats, options)
- `docs/features/generation.md` — Document all generation options and outputs
- `docs/features/templates.md` — Document custom template support and context variables
- `docs/features/register-templates.md` — Document register template system
- `README.md` — Update feature list and screenshots

---

## Implementation Order & Dependencies

```
Phase 1: Validation Framework
  ├── 1.1 IpCoreValidator          (no deps)
  ├── 1.2 MemoryMapValidator       (no deps)
  ├── 1.3 Wire into providers      (depends on 1.1, 1.2)
  └── 1.4 JSON Schema validation   (no deps)

Phase 2: Additional Parsers
  ├── 2.1 Verilog parser           (no deps)
  ├── 2.2 IP-XACT parser           (no deps)
  ├── 2.3 HwTcl parser             (no deps)
  ├── 2.4 Parse dispatcher         (depends on 2.1, 2.2, 2.3)
  └── 2.5 Import commands          (depends on 2.4)

Phase 3: Enhanced Code Generation
  ├── 3.1 Regmap docs              (no deps)
  ├── 3.2 package_ip.tcl template  (no deps)
  ├── 3.3 memmap.yml template      (no deps)
  ├── 3.4 Structured layout        (no deps)
  ├── 3.5 Custom template dirs     (no deps)
  ├── 3.6 Template context dump    (no deps)
  ├── 3.7 Dry-run mode             (no deps)
  └── 3.8 Progress reporting       (no deps)

Phase 4: Interactive Scaffolding
  ├── 4.1 Init wizard              (no deps)
  └── 4.2 IP symbol diagram        (no deps)

Phase 5: Register Templates
  ├── 5.1 YAML support             (no deps)
  ├── 5.2 Template UI              (depends on 5.1)
  └── 5.3 Built-in library         (depends on 5.1)

Phase 6: Watch Mode & Automation
  ├── 6.1 Auto-regeneration        (no deps)
  └── 6.2 Output channel           (no deps)

Phase 7: JSON Output & CLI
  ├── 7.1 JSON output service      (no deps)
  └── 7.2 CLI bridge               (depends on 7.1)

Phase 8: Runtime & Driver Features
  ├── 8.1 Python driver gen        (no deps)
  ├── 8.2 C header gen             (no deps)
  └── 8.3 SystemVerilog header     (no deps)

Phase 9: Quality of Life
  ├── 9.1 Validation indicators    (depends on 1.3)
  ├── 9.2 Regmap preview           (depends on 3.1)
  ├── 9.3 Code lens                (depends on 1.3, 3.x)
  ├── 9.4 Hover provider           (no deps)
  └── 9.5 Completion provider      (no deps)

Phase 10: Testing & Documentation
  ├── 10.1 Parser tests            (depends on Phase 2)
  ├── 10.2 Validator tests         (depends on Phase 1)
  ├── 10.3 Generator tests         (depends on Phase 3)
  └── 10.4 Documentation           (depends on all phases)
```

---

## Effort Estimates

| Phase | Tasks | Estimated Complexity |
|---|---|---|
| Phase 1 — Validation | 4 tasks | Large |
| Phase 2 — Parsers | 5 tasks | Large |
| Phase 3 — Generation | 8 tasks | Medium-Large |
| Phase 4 — Scaffolding | 2 tasks | Medium |
| Phase 5 — Register Templates | 3 tasks | Medium |
| Phase 6 — Watch & Automation | 2 tasks | Small |
| Phase 7 — JSON & CLI | 2 tasks | Small |
| Phase 8 — Runtime/Drivers | 3 tasks | Medium |
| Phase 9 — Quality of Life | 5 tasks | Medium-Large |
| Phase 10 — Testing & Docs | 4 tasks | Medium |
| **Total** | **38 tasks** | |

---

## Recommended Development Sequence

For maximum value delivered earliest:

1. **Phase 1** (Validation) — Immediately improves user experience for all users
2. **Phase 3.1, 3.7** (Regmap docs + Dry-run) — Quick wins with high visibility
3. **Phase 2** (Parsers) — Unlocks import from all major formats
4. **Phase 4.1** (Init wizard) — Improves onboarding for new users
5. **Phase 3** remainder (Generation enhancements) — Fills in feature gaps
6. **Phase 9** (Quality of Life) — Polish and usability
7. **Phase 5** (Register templates) — Power user feature
8. **Phase 6** (Watch mode) — Automation convenience
9. **Phase 8** (Runtime/drivers) — Extends to firmware developers
10. **Phase 7** (JSON/CLI) — Integration and automation

---

## Reference Files

### Python ipcraft (source of truth for porting)

| Feature | Python file |
|---|---|
| CLI commands | `ipcraft/cli.py`, `ipcraft/cli_init.py` |
| Validators | `ipcraft/model/validators.py` |
| VHDL parser | `ipcraft/parser/hdl/vhdl_parser.py` |
| Verilog parser | `ipcraft/parser/hdl/verilog_parser.py` |
| Bus detector | `ipcraft/parser/hdl/bus_detector.py` |
| IP-XACT parser | `ipcraft/parser/vendor/ipxact_parser.py` |
| HwTcl parser | `ipcraft/parser/vendor/hw_tcl_parser.py` |
| Parse dispatcher | `ipcraft/parser/vendor/parse_dispatcher.py` |
| Generator | `ipcraft/generator/hdl/ipcore_project_generator.py` |
| Vendor generator | `ipcraft/generator/hdl/vendor_generator.py` |
| Testbench generator | `ipcraft/generator/hdl/testbench_generator.py` |
| Fileset manager | `ipcraft/generator/hdl/fileset_manager.py` |
| Boilerplate | `ipcraft/generator/yaml/boilerplate.py` |
| IP YAML generator | `ipcraft/generator/yaml/ip_yaml_generator.py` |
| MM YAML generator | `ipcraft/generator/yaml/mm_yaml_generator.py` |
| Data models | `ipcraft/model/core.py`, `bus.py`, `port.py`, `clock_reset.py`, `memory_map.py`, `fileset.py` |
| Bus library | `ipcraft/model/bus_library.py` |
| Runtime | `ipcraft/runtime/register.py` |
| Driver loader | `ipcraft/driver/loader.py`, `bus.py` |
| Templates | `ipcraft/generator/hdl/templates/*.j2` |

### ipcraft-vscode (files to create or modify)

| Feature | VS Code file |
|---|---|
| IP Core validator | `src/services/IpCoreValidator.ts` (new) |
| Memory Map validator | `src/services/MemoryMapValidator.ts` (new) |
| Verilog parser | `src/parser/VerilogParser.ts` (new) |
| IP-XACT parser | `src/parser/IpXactParser.ts` (new) |
| HwTcl parser | `src/parser/HwTclParser.ts` (new) |
| Parse dispatcher | `src/parser/ParseDispatcher.ts` (new) |
| Regmap doc generator | `src/generator/RegmapDocGenerator.ts` (new) |
| Watch service | `src/services/WatchService.ts` (new) |
| Output channel | `src/utils/OutputChannel.ts` (new) |
| JSON output | `src/services/JsonOutputService.ts` (new) |
| Register templates hook | `src/webview/hooks/useRegisterTemplates.ts` (new) |
| Register template panel | `src/webview/components/memorymap/RegisterTemplatePanel.tsx` (new) |
| IP symbol diagram | `src/webview/ipcore/components/IpSymbolDiagram.tsx` (new) |
| Code lens provider | `src/providers/IpCoreCodeLensProvider.ts` (new) |
| Hover provider | `src/providers/YamlHoverProvider.ts` (new) |
| Completion provider | `src/providers/YamlCompletionProvider.ts` (new) |
| Scaffolder (modify) | `src/generator/IpCoreScaffolder.ts` |
| Template loader (modify) | `src/generator/TemplateLoader.ts` |
| Generate commands (modify) | `src/commands/GenerateCommands.ts` |
| File creation commands (modify) | `src/commands/FileCreationCommands.ts` |
| YAML validator (modify) | `src/services/YamlValidator.ts` |
| Extension entry (modify) | `src/extension.ts` |
| Package manifest (modify) | `package.json` |
