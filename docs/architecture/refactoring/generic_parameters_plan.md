# Restricting Parameters to the Big Three

This document details the architecture, design decisions, and implementation steps to restrict the parameter/generic data types within IPCraft to the three standard cross-vendor types: integer, boolean, and string.

Dropping natural, positive, real, and bit_vector/std_logic_vector from the top-level GUI parameter space simplifies UI logic, eliminates cross-vendor formatting/formatting conflicts in generated IP-XACT component.xml and Altera hw.tcl files, and establishes cleaner parameterization conventions.

---

## Technical Strategy

Any custom bitmask, vector width, or base address can be represented as an integer at the GUI/editor level, and cast to the appropriate std_logic_vector/logic vector inside the generated RTL code.

### Type Translation Table

| IPCraft (.ip.yml) | RTL (VHDL) | RTL (SystemVerilog) | Intel/Altera (_hw.tcl) | AMD/Xilinx (component.xml) |
| --- | --- | --- | --- | --- |
| integer | integer | int | INTEGER | long |
| boolean | boolean | bit | BOOLEAN | bool |
| string | string | string | STRING | string |

---

## Proposed Changes

### 1. Examples and Fixtures

#### ipcraft-spec/examples/xcvr_loopback/xcvr_loopback.ip.yml
- Update parameters (XCVR_DW, XCVR_KW) dataType from natural to integer.

#### src/test/fixtures/xcvr-ipcore.yml
- Update parameters (XCVR_DW, XCVR_KW) dataType from natural to integer.

#### src/test/fixtures/expr-ipcore.yml
- Update parameter AxiDataWidth_g dataType from positive to integer.

### 2. Schema and Domain Models

#### ipcraft-spec/schemas/ip_core.schema.json
- Update the ParameterType definition enum to strictly support: integer, boolean, and string.
- Formally declare parameter constraint and layout properties under the Parameter properties:
  - min (integer): Minimum constraint value.
  - max (integer): Maximum constraint value.
  - allowed_values / allowedValues (array of integers/strings): Discrete choices constraint (mutually exclusive with range).
  - ui_group / uiGroup (string): Logical UI grouping name.

#### src/domain/ipcore.types.ts
- Re-generate TS models by running npm install (to sync local ipcraft-spec folder to node_modules) and running npm run generate-types.
- Modify src/domain/parse.ts to copy constraint properties (min, max, allowedValues/allowed_values, uiGroup/ui_group) during normalizeIpCore normalization.

### 3. VHDL / Verilog Parsers

#### src/parser/VhdlParser.ts
- Modify normalizeParamDataType to map non-standard types to the Big Three:
  - natural, positive -> integer
  - real -> integer
  - Any vector type (for example, std_logic_vector, bit_vector) -> integer
- Flag generic warnings during extraction:
  - If a generic parameter's VHDL type is a vector (for example, contains std_logic_vector or bit_vector), append a warning: "Warning: std_logic_vector generic detected on generic '<name>'. Convert to integer for cross-vendor GUI compatibility."
  - Return these warnings in ParseResult so they can be surfaced in VS Code using vscode.window.showWarningMessage upon import.

#### src/parser/VerilogParser.ts
- Map SystemVerilog types:
  - int, integer, byte, shortint, longint, real -> integer
  - bit (when single-bit/boolean) -> boolean
  - Any vector/logic -> integer (with a warning if a vector parameter is detected).

#### src/parser/HwTclParser.ts & ComponentXmlParser.ts
- Restrict parsed types to integer, boolean, and string. Map Altera/Xilinx target types back to the Big Three.

### 4. Canvas Inspector UI

#### src/webview/ipcore/components/canvas/CanvasInspector.tsx
- Limit PARAM_TYPE_OPTS to: integer, boolean, and string.
- Update the state update handler onSave / onUpdate to clear constraint fields (min, max, allowedValues) when the parameter's dataType is changed (for example, changing from integer to boolean).
- Implement the Expanded Settings controls in ParameterPanel based on the selected type:
  - Integer Parameters:
    - Compact: standard numeric input field.
    - Expanded: Constraint Mode Toggle (Unrestricted, Range, Discrete Choices):
      - Unrestricted: no extra options.
      - Range: renders Min and Max side-by-side numeric fields.
      - Discrete Choices: tag-input field rendering added values as chips.
  - Boolean Parameters:
    - Compact: checkbox field.
    - Expanded: only displays Description textarea and UI Group text field.
  - String Parameters:
    - Compact: text input field.
    - Expanded: Constraint Mode Toggle (Unrestricted, Discrete Choices):
      - Unrestricted: no extra options.
      - Discrete Choices: tag-input field for allowed strings.

#### src/webview/ipcore/components/sections/ParametersTable.tsx
- Restrict type choices in dropdown to integer, boolean, and string.
- Ensure defaults automatically set: 0 for integer, false for boolean, \"\" for string.

### 5. Code Generation Engine

#### src/generator/IpCoreScaffolder.ts
- Simplify resolveSvGenericType to map integer to int, boolean to bit, and string to empty string.
- Simplify resolveGenericDefault and resolveSvGenericDefault to strictly format the Big Three defaults (integer as number, boolean as true/false in VHDL and 1'b1/1'b0 in SV, string as quoted string).

#### src/generator/templates/amd_component_xml.j2
- Map parameters spirit:format based on types: long (for integer), bool (for boolean), string (for string).
- If range (min/max) or discrete choices (allowed_values) exist, generate corresponding IP-XACT spirit validation constraints.

#### src/generator/templates/altera_hw_tcl.j2
- Output add_parameter types: INTEGER, BOOLEAN, STRING.
- Clean up any legacy float/vector type handling.

---

## Verification Plan

### Automated Verification
- Run unit test suites to confirm no existing functionality is broken:
  - npm run test:unit
- Write new parser unit tests in VhdlParser.test.ts to assert that vector generics are flagged and parsed as integers with warning entries.
- Add scaffolder tests to assert correct SystemVerilog and VHDL generation for boolean and string parameters.
- Run linter to verify formatting and type correctness:
  - npm run lint

### Manual Verification
- Import a VHDL file containing a std_logic_vector generic and verify the warning is correctly shown in VS Code.
- Open the visual editor, add/edit parameters in the Inspector Panel, and test:
  - Toggling type to boolean clears range/discrete choice settings.
  - Editing constraints (ranges and discrete choices) writes correct YAML blocks.
- Generate Vivado and Platform Designer wrappers, and inspect the resulting XML and TCL files to verify clean cross-vendor parameter mappings.
