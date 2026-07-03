# Issue #28: Per-file VHDL version for fileSets

GitHub issue: https://github.com/bleviet/ipcraft-vscode/issues/28 ("[Files][Synthesis] Allow editing VHDL version for files", bug + enhancement).

## Problem

A user added a VHDL file that used a VHDL-2008 construct. Synthesis rejected it. IPCraft had no way to tell Vivado which HDL language standard a given source file was written against.

## Root cause

`src/generator/VivadoComponentXmlGenerator.ts` `renderVhdlFile()` hardcoded:

```xml
<spirit:fileType>vhdlSource</spirit:fileType>
```

for every VHDL file, and `getFileSetPaths()` reduced fileSet entries to bare path strings before they reached the renderer, discarding all metadata. Vivado interprets a plain `vhdlSource` fileType as VHDL-93 when the packaged IP is instantiated in a block design, so any VHDL-2008 construct in that file fails synthesis.

This was the one inconsistent path in the tool: every other flow already assumes VHDL-2008 globally —

- `src/generator/templates/vivado_project.tcl.j2` (`set_property file_type {VHDL 2008} $vhd_files`)
- `src/generator/templates/vivado_run_xpr.tcl.j2` (same)
- `src/generator/templates/quartus_project.tcl.j2` (`set_global_assignment -name VHDL_INPUT_VERSION VHDL_2008`)

component.xml, used when the IP is instantiated into a Vivado block design, was the exception.

## Design

### Spec: a generic `version` field on `File`

Added to `ipcraft-spec/schemas/ip_core.schema.json` `$defs/File`:

```json
"version": {
  "default": "",
  "description": "HDL language standard version. For type 'vhdl': '87', '93', '2002', '2008', '2019' (unset defaults to '2008' in generated Vivado packaging). For type 'verilog': '95', '2001'. Quote the value in YAML.",
  "title": "Version",
  "type": "string"
}
```

A free string rather than an extension of the `FileType` enum: extending the enum with values like `vhdl-2008` would break every `type === 'vhdl'` check across the generator, importers, and UI. The field's meaning is type-dependent (VHDL vs. Verilog standards), which a single flat enum can't express cleanly, and a free string lets future standards be added without a schema migration. The UI constrains the practical choices via a dropdown.

```yaml
fileSets:
  - name: RTL_Sources
    files:
      - path: rtl/my_core.vhd
        type: vhdl
        version: "2008"
      - path: rtl/legacy.vhd
        type: vhdl
        version: "93"
```

### Default: unset version means VHDL-2008

When a VHDL file has no `version`, generated component.xml now marks it as VHDL-2008. This matches every other synthesis path in the tool (see Root cause) and fixes the reported bug without requiring any YAML edits — files already written for VHDL-2008 (the vast majority, since that is what modern VHDL tooling and IPCraft's own generated RTL target) synthesize correctly by default. A file that genuinely needs VHDL-93 semantics is opted out explicitly with `version: "93"`.

### Emission form: Vivado's own convention

component.xml here uses the spirit **1685-2009** namespace (`xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"`). Versioned fileType values like `vhdlSource-2008` only exist starting with IP-XACT 1685-2014, so the 2009 fileType enum has no versioned VHDL variants. Vivado's own IP packager works around this by using `userFileType` instead, e.g.:

```xml
<spirit:file>
  <spirit:name>my_core.vhd</spirit:name>
  <spirit:userFileType>vhdlSource-2008</spirit:userFileType>
</spirit:file>
```

with no `spirit:fileType` element at all — confirmed against real Vivado-packaged component.xml files in the wild. IPCraft now emits this same form:

- `version` is `"93"` or `"87"` → `<spirit:fileType>vhdlSource</spirit:fileType>` (explicit opt-out, Vivado's VHDL-93 default).
- Any other value, including unset → `<spirit:userFileType>vhdlSource-${version ?? '2008'}</spirit:userFileType>`.

## Changes by layer

### ipcraft-spec submodule

- `schemas/ip_core.schema.json`: `version` property on `$defs/File`.
- `docs/ip_spec.md`: `version` row in the File Properties table, an example entry, and a new subsection explaining the per-toolchain mapping (Vivado packages per-file; Platform Designer/Quartus has no per-file concept — see below).

### Types

- `npm run generate-types` regenerates `src/domain/ipcore.types.ts` (`File.version?`).
- `src/webview/types/ipCore.d.ts` is not covered by that script (hand-synced historically) — updated by hand with the matching `version?` property.

### Generator: `src/generator/VivadoComponentXmlGenerator.ts`

- `buildVhdlVersionLookup(ipCore)`: collects `{ path → version }` for `type: 'vhdl'` files across all fileSets, matching by path suffix (generated/scaffold paths carry a `../` prefix; fileSets paths don't).
- `renderVhdlFile(filePath, version?)`: resolves the emission form described above.
- `renderFileSets(...)` threads the lookup through to `renderVhdlFile` for every file in the synthesis and simulation views.
- No change to `ComponentXmlOptions`/`ScaffoldOptions` (kept as plain `string[]`), `IpCoreScaffolder.ts`, Quartus files, or vivado/quartus project TCL templates — see Quartus note below. The legacy `amd_component_xml.j2` template is unused dead code and was left untouched.

### Importer: `src/parser/ComponentXmlParser.ts`

`mapFileTypeAndVersion(fileType, userFileTypes)` replaces the previous `mapFileType(fileType)`-only call, so round-tripping a Vivado-packaged component.xml preserves the version:

- `vhdlSource-<ver>` / `verilogSource-<ver>` in either `fileType` or any `userFileType` → `{ type, version }`.
- Legacy hand-authored spelling `fileType: vhdlSource` + `userFileType: "VHDL 2008"` (or `vhdl2008`) → `{ type: 'vhdl', version: '2008' }`.
- `CHECKSUM_*` and other unrelated `userFileType` markers are ignored.

`src/parser/HwTclParser.ts` needed no change — see Quartus note.

### UI

- `src/webview/ipcore/components/canvas/CanvasInspector.tsx` (`FileSetsSection`, the primary editing surface): a compact inline `<select>` on VHDL file rows only, offering `2008 (default)`, `93`, `2002`, `2019`, `87`. Selecting the default option removes the `version` key from the YAML entry (keeps generated YAML clean); any other choice sets it explicitly.
- `src/webview/ipcore/components/sections/FileSetsPanel.tsx`: the type badge for VHDL files now shows the resolved version (e.g. `VHDL 2008`) — display only, matching the primary editor.
- The unmounted, dead `FileSetsEditor.tsx` was left untouched.
- Verilog version editing is schema-ready (the field's description documents `95`/`2001`) but not exposed in the UI yet — no reported need.

### Quartus / Platform Designer — explicitly out of scope

Platform Designer's `add_fileset_file` file kinds (`VHDL`, `VERILOG`, `SYSTEM_VERILOG`, ...) have no per-file VHDL-standard variant. The VHDL standard is a single project-wide QSF assignment, `VHDL_INPUT_VERSION`, which `quartus_project.tcl.j2` already sets to `VHDL_2008`. So the `version` field has no effect on Quartus output, and `QuartusToolchain.ts` / `altera_hw_tcl.j2` / `HwTclParser.ts` were intentionally left unchanged.

## Tests

- `src/test/suite/generator/VivadoComponentXmlGenerator.test.ts`: default VHDL emission now asserts `userFileType vhdlSource-2008` (not `fileType vhdlSource`); explicit `93` → plain `vhdlSource`; explicit `2002` → `vhdlSource-2002`; version resolution works whether files come via `rtlFiles` (prefixed paths) or the fileSets fallback (unprefixed paths); SystemVerilog files are unaffected by any version metadata.
- `src/test/suite/parser/ComponentXmlParser.test.ts`: imports a Vivado-native userFileType-only `vhdlSource-2008` marker (with a `CHECKSUM_*` sibling), a versioned `fileType` value (`vhdlSource-93`), the legacy `fileType vhdlSource` + `userFileType "VHDL 2008"` spelling, and confirms a plain `vhdlSource` file with no marker leaves `version` unset.
- `src/test/suite/components/CanvasInspector.FileSetsSection.test.tsx` (new): the version dropdown appears only for `vhdl` files, defaults to unset, writes `version` on selection, and removes it when the default option is re-selected.
- Integration snapshot (`npm run test:integration:snapshots -- -u`): exactly 38 `vhdlSource` occurrences across Xilinx fixture snapshots changed to the `userFileType vhdlSource-2008` form — nothing else in the snapshot changed. `test:integration:ipxact` (xmllint well-formedness), `conformance`, and `roundtrip`/`parser-roundtrip` all pass unmodified.

## Verification

```bash
npm run lint
npm run type-check
npm run generate-types   # regenerate domain types from the updated schema
npm test                 # full unit suite
npm run test:integration:snapshots
npm run test:integration:ipxact
npm run compile
```

Manual (needs a local Vivado install, not run here): package an example IP with a user file containing a VHDL-2008-only construct (e.g. a `process(all)`), instantiate it in a Vivado block design, and confirm synthesis succeeds — this is the exact failure mode reported in the issue. `npm run test:integration:vivado` runs the automated version of this check (`scripts/integration/vivado/validate_bd.tcl`) but self-skips without `VIVADO_BIN` set.
