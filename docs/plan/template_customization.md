# Template Customization — Manifest-Driven Code Generation

> **Goal:** Let production teams replace IPcraft's built-in code generation with their
> own folder structure, coding style, and Jinja2 templates — without forking the
> extension. A new visual template editor (split-pane webview) lets users browse the
> output tree, edit templates with live preview, and manage the manifest that drives
> generation.
>
> **Motivation:** The current scaffolder (`IpCoreScaffolder.generateAll`) hardcodes
> every template-to-output-path mapping in TypeScript. Prototyping users are fine with
> this; production teams need their own conventions. The solution is a
> `ipcraft.templates.yml` manifest that replaces the hardcoded logic, backed by a
> template editor webview.

---

## Scope — what changes and what does not

### What stays exactly the same

Every existing user-facing trigger is unchanged. The table below lists them all:

| Trigger | Location | `GenerateOptions` it sets |
|---|---|---|
| **Generate Files** button | `GeneratorPanel` webview (IP Core editor) | `vendor`, `includeVhdl`, `includeRegs`, `includeTestbench` |
| **Generate VHDL** | Command palette | VHDL + register file only |
| **Scaffold Project** | Command palette | All groups, picks Vivado part + Quartus device |
| **Export Altera** | Command palette | `vendor: altera`, no VHDL |
| **Export Xilinx** | Command palette | `vendor: xilinx`, no VHDL |
| **Generate Vivado Project** | Command palette | `includeVivadoProject`, picks target part |
| **Generate Quartus Project** | Command palette | `includeQuartusProject`, picks device |
| **Generate Testbench** | Command palette | `includeTestbench` only |

The folder picker, progress notification, `fileSets` update in the `.ip.yml`, and
"Open Folder" post-generation action are all unchanged.

### What changes

Only one thing changes: `IpCoreScaffolder.generateAll()` gains a manifest gate. When
an `ipcraft.templates.yml` is present, the hardcoded template-to-output-path map is
replaced by the manifest. The `GenerateOptions` flags continue to control which groups
are active — the manifest groups just give those flags named targets instead of
hardcoded `if` branches.

---

## Architecture Overview

### Existing Stack (generation layer)

| Component | File | Role |
|---|---|---|
| Scaffolder | `src/generator/IpCoreScaffolder.ts` | Hardcoded template → output-path map |
| Template loader | `src/generator/TemplateLoader.ts` | Nunjucks env, single `templatesPath` |
| Built-in templates | `src/generator/templates/*.j2` | Jinja2 source files |
| Generate handler | `src/providers/IpCoreGenerateHandler.ts` | VSCode command entry point |

### New Components

| Component | File | Role |
|---|---|---|
| Manifest type | `src/generator/templateManifest.ts` | TypeScript types for `ipcraft.templates.yml` |
| Manifest loader | `src/generator/ManifestLoader.ts` | Parse, validate, and resolve manifest |
| Manifest scaffolder | `src/generator/ManifestDrivenScaffolder.ts` | Render outputs defined in manifest |
| Template editor provider | `src/providers/TemplateEditorProvider.ts` | `WebviewPanel` command entry point |
| Template editor webview | `src/webview/templateEditor/` | React split-pane UI |

---

## Manifest Format

The manifest file is named `ipcraft.templates.yml` and lives adjacent to the `.ip.yml`
(project-scoped) or in `~/.config/ipcraft/` (user-scoped). Resolution order:
project dir → `~/.config/ipcraft/` → built-in defaults. A project manifest fully
overrides a user manifest (no merge); a user manifest fully overrides the defaults.

```yaml
# ipcraft.templates.yml
version: '1.0'

# Template search order — first directory that contains the file wins.
# "ipcraft://builtin" is a sentinel resolved to src/generator/templates/ at runtime.
templateDirs:
  - ./templates        # project-local overrides
  - ipcraft://builtin  # built-in fallback

# Named groups — each maps to a GenerateOptions flag.
# enabled: initial default when no .ip.yml override is present.
groups:
  rtl:             { enabled: true }
  regs:            { enabled: true }
  testbench:       { enabled: true }
  altera:          { enabled: false }   # _hw.tcl — maps to vendor: altera/both
  xilinx:          { enabled: false }   # component.xml + xgui — maps to vendor: xilinx/both
  vivado-project:  { enabled: false }   # project.tcl + OOC scripts — maps to includeVivadoProject
  quartus-project: { enabled: false }   # project.tcl + .sdc — maps to includeQuartusProject

# Output entries — both `template` and `path` are Jinja2 expressions
# rendered with the full template context before use.
outputs:
  # RTL
  - template: top.vhdl.j2
    path: "rtl/{{ entity_name }}.vhd"
    group: rtl

  - template: package.vhdl.j2
    path: "rtl/{{ entity_name }}_pkg.vhd"
    group: rtl
    when: "{{ has_memory_mapped_slave }}"

  - template: core.vhdl.j2
    path: "rtl/{{ entity_name }}_core.vhd"
    group: rtl
    when: "{{ has_memory_mapped_slave }}"

  - template: "bus_{{ bus_type }}.vhdl.j2"
    path: "rtl/{{ entity_name }}_{{ bus_type }}.vhd"
    group: rtl
    when: "{{ has_memory_mapped_slave }}"

  # Registers
  - template: register_file.vhdl.j2
    path: "rtl/{{ entity_name }}_regs.vhd"
    group: regs

  # Testbench
  - template: mm_loader.py.j2
    path: tb/mm_loader.py
    group: testbench

  - template: cocotb_test.py.j2
    path: "tb/{{ entity_name }}_test.py"
    group: testbench

  - template: cocotb_conftest.py.j2
    path: tb/conftest.py
    group: testbench

  - template: cocotb_pytest.py.j2
    path: "tb/test_{{ entity_name }}_sim.py"
    group: testbench

  - template: cocotb_makefile.j2
    path: tb/Makefile
    group: testbench

  - template: vscode_settings.json.j2
    path: .vscode/settings.json
    group: testbench

  # Altera
  - template: altera_hw_tcl.j2
    path: "altera/{{ entity_name }}_hw.tcl"
    group: altera

  # Xilinx — Nunjucks templates
  - template: amd_xgui.j2
    path: "xilinx/xgui/{{ entity_name }}_v{{ version | replace('.', '_') }}.tcl"
    group: xilinx

  # Xilinx — component.xml is generated by a dedicated TypeScript generator,
  # not a Jinja2 template. The `generator` field selects the renderer.
  - generator: component-xml
    path: xilinx/component.xml
    group: xilinx

  # Vivado project (includeVivadoProject) — needs target_part and rtl_files in context
  - template: vivado_project.tcl.j2
    path: "xilinx/{{ entity_name }}_project.tcl"
    group: vivado-project

  - template: vivado_ooc.xdc.j2
    path: "xilinx/{{ entity_name }}_ooc.xdc"
    group: vivado-project

  - template: vivado_run_ooc.tcl.j2
    path: "xilinx/{{ entity_name }}_run_ooc.tcl"
    group: vivado-project

  - template: vivado_run_xpr.tcl.j2
    path: "xilinx/{{ entity_name }}_run_xpr.tcl"
    group: vivado-project

  # Quartus project (includeQuartusProject) — needs target_device, device_family, rtl_files
  - template: quartus_project.tcl.j2
    path: "altera/{{ entity_name }}_project.tcl"
    group: quartus-project

  - template: quartus_sdc.j2
    path: "altera/{{ entity_name }}.sdc"
    group: quartus-project
```

The `generator` field is optional and defaults to `nunjucks`. When present, `template`
is omitted. Currently defined generators:

| `generator` value | Renderer | Replaces |
|---|---|---|
| `nunjucks` (default) | `TemplateLoader.render()` | — |
| `component-xml` | `VivadoComponentXmlGenerator.generateComponentXml()` | hardcoded call in scaffolder |

### Manifest resolution rules

1. `path` and `template` are rendered as Jinja2 expressions using the same context
   object that `IpCoreScaffolder.buildTemplateContext()` already produces.
2. `when` is a Jinja2 expression that must evaluate to a truthy string (`"true"`,
   `"1"`, non-empty) to include the entry. An absent `when` is always included.
3. `templateDirs` are searched in order; the first directory that contains a file
   matching the rendered `template` name wins. This lets a single custom template
   shadow the built-in without copying the rest.
4. A manifest entry whose rendered `template` name does not exist in any `templateDir`
   is an error reported to the user, not a silent skip.

---

## Backend Changes

### 1. `TemplateLoader` — multi-directory search

**Current:** single `templatesPath: string` constructor argument, single
`nunjucks.FileSystemLoader`.

**Change:** accept `templatesPath: string | string[]`. When an array is given, create
one `FileSystemLoader` per directory and pass them as an array to the `nunjucks.Environment`
constructor (Nunjucks resolves loaders in order). No other behaviour changes.

```typescript
// Before
new nunjucks.Environment(
  new nunjucks.FileSystemLoader(this.templatesPath, { noCache: true }),
  { ... }
)

// After
const loaders = dirs.map(d => new nunjucks.FileSystemLoader(d, { noCache: true }));
new nunjucks.Environment(loaders, { ... })
```

The `ipcraft://builtin` sentinel is resolved to the extension's bundled templates path
inside `ManifestLoader` before the array reaches `TemplateLoader`.

### 2. `ManifestLoader`

Responsible for:
- Finding the manifest file: project dir → `~/.config/ipcraft/` → return `null` if absent.
- Parsing and validating the YAML against the `TemplateManifest` TypeScript type.
- Resolving `ipcraft://builtin` in `templateDirs` to the real filesystem path.
- Returning a ready-to-use `ResolvedManifest` object.

```typescript
type GeneratorId = 'nunjucks' | 'component-xml';

interface ManifestOutput {
  generator?: GeneratorId;  // defaults to 'nunjucks'
  template?: string;        // Jinja2 expression; required when generator === 'nunjucks'
  path: string;             // Jinja2 expression for the output file path
  group?: string;
  when?: string;            // Jinja2 expression; absent means always include
}

interface TemplateManifest {
  version: string;
  templateDirs?: string[];
  groups?: Record<string, { enabled: boolean }>;
  outputs: ManifestOutput[];
}
```

### 3. `ManifestDrivenScaffolder`

Replaces the hardcoded `files` map construction in `IpCoreScaffolder.generateAll()`.
Algorithm:

1. Build `context` via the existing `buildTemplateContext()` — no change here.
2. Determine active groups from `manifest.groups` merged with `GenerateOptions`.
   `GenerateOptions` flags override manifest defaults so that all existing commands
   continue to work without any manifest changes:

   | `GenerateOptions` flag | Group(s) activated |
   |---|---|
   | `includeVhdl: true` | `rtl` |
   | `includeRegs: true` | `regs` |
   | `includeTestbench: true` | `testbench` |
   | `vendor: 'altera'` or `'both'` | `altera` |
   | `vendor: 'xilinx'` or `'both'` | `xilinx` |
   | `includeVivadoProject: true` | `vivado-project` |
   | `includeQuartusProject: true` | `quartus-project` |
3. For each `output` entry in the manifest:
   a. Skip if `group` is inactive.
   b. Render `when` expression; skip if falsy.
   c. Render `path` expression to get the output path.
   d. Dispatch on `generator` (default `nunjucks`):
      - `nunjucks`: render `template` expression → call `templateLoader.render(name, context)`
      - `component-xml`: call `VivadoComponentXmlGenerator.generateComponentXml(ipCoreData, busDefinitions, rtlFiles)`
   e. Add result to `files` map.
4. Write `files` map to disk (identical logic to current scaffolder).

### 4. `IpCoreScaffolder.generateAll()` — manifest gate

```typescript
const manifest = await ManifestLoader.find(inputPath);
if (manifest) {
  return new ManifestDrivenScaffolder(this.logger, this.templates, manifest)
    .generate(context, options, outputDir);
}
// existing hardcoded logic unchanged — fallback for projects without a manifest
```

This preserves full backwards compatibility: projects without a manifest behave
exactly as before.

---

## Template Editor Webview

### Layout

The lock icon (🔒) marks templates backed by `ipcraft://builtin`. They are
viewable but not editable; a "Copy to project" banner replaces the save button.

```
┌──────────────────┬───────────────────────────────────┬──────────────────────┐
│  OUTPUT TREE     │  TEMPLATE EDITOR (Monaco)         │  LIVE PREVIEW        │
│                  │                                   │                      │
│  rtl/            │  ┌─ 🔒 top.vhdl.j2 (built-in) ─┐ │  library ieee;       │
│  ├ top.vhd  ←●   │  │ {# VHDL Top-Level #}         │ │  use ieee.std_...   │
│  ├ _pkg.vhd ○    │  │ entity {{ entity_name }} is  │ │                      │
│  ├ _core.vhd○    │  │   port (                     │ │  entity my_ip is     │
│  ├ _axil.vhd○    │  │   {{ clock_port }} : in ...  │ │    port (            │
│  ├ _regs.vhd○    │  │   ...                        │ │    clk : in std_...  │
│  tb/             │  └──────────────────────────────┘ │    ...               │
│  ├ Makefile  ○   │                                   │                      │
│  └ test.py   ○   │  ╔══════════════════════════════╗ │                      │
│                  │  ║ Built-in template — read only ║ │                      │
│  altera/ [off]   │  ║ [Copy to ./templates/]        ║ │                      │
│  xilinx/ [off]   │  ╚══════════════════════════════╝ │                      │
│                  │                                   │                      │
│  [+ add output]  │  ─ Context Variables ───────────  │                      │
│                  │  entity_name   "my_ip"            │                      │
│                  │  bus_type      "axil"             │                      │
│                  │  registers     [3 items]  ▶       │                      │
└──────────────────┴───────────────────────────────────┴──────────────────────┘
```

### Component breakdown

| Component | File | Responsibility |
|---|---|---|
| `TemplateEditorApp` | `src/webview/templateEditor/TemplateEditorApp.tsx` | Root layout, panel wiring |
| `OutputTree` | `.../OutputTree.tsx` | File tree from manifest, group toggles, add/remove |
| `TemplatePane` | `.../TemplatePane.tsx` | Monaco editor + output path chip + variables panel |
| `PreviewPane` | `.../PreviewPane.tsx` | Read-only rendered output, language-matched syntax |
| `useTemplateEditorState` | `.../useTemplateEditorState.ts` | Manifest state, selected entry, context variables |
| `useTemplatePreview` | `.../useTemplatePreview.ts` | Debounced render requests to extension host |

### Message protocol (webview ↔ extension host)

```typescript
// Webview → host
type TemplateEditorRequest =
  | { type: 'saveTemplate';   templateName: string; content: string; }
  | { type: 'saveManifest';   manifest: TemplateManifest; }
  | { type: 'copyBuiltin';    templateName: string; }   // copy built-in to ./templates/
  | { type: 'ready'; }

// Host → webview
type TemplateEditorMessage =
  | { type: 'init';          manifest: TemplateManifest; context: Record<string, unknown>;
                              builtinTemplates: Record<string, string>; }
  | { type: 'copiedBuiltin'; templateName: string; localPath: string; content: string; }
  | { type: 'error';         message: string; }
```

`init` sends the full template context and the raw source of every built-in template
so the webview has everything it needs to render previews locally. The live preview
runs **Nunjucks in the webview** (pure JS, ~150 KB bundle cost) — no per-keystroke
host round-trip. `useTemplatePreview` calls `nunjucks.renderString()` directly,
debounced 300 ms.

`copiedBuiltin` carries the full file content so the webview can immediately switch
Monaco to edit mode without a second round-trip to read the newly written file.

### Built-in template read-only policy

Templates resolved from `ipcraft://builtin` (i.e., shipped inside the extension)
are **viewable but never editable**. This prevents accidental modification of files
that live inside the extension's install directory and would be lost on upgrade.

The workflow for customising a built-in template is explicit copy-on-write:

1. User selects a built-in-backed node in the output tree.
2. Monaco opens in **read-only mode**. A persistent banner ("Built-in template —
   read only") replaces the save button. The live preview still works normally.
3. User clicks **"Copy to ./templates/"**. The extension host:
   a. Reads the built-in file from the bundled path.
   b. Writes it to `<projectRoot>/templates/<templateName>` (creating the directory
      if needed).
   c. If no manifest exists yet, creates `ipcraft.templates.yml` from the built-in
      default and updates the matching `outputs` entry so its `template` name now
      resolves to the project copy (since `./templates/` precedes `ipcraft://builtin`
      in `templateDirs`, no manifest edit is actually required — the shadow takes
      effect automatically).
4. Monaco switches to **edit mode** on the now-local copy. The lock icon disappears
   from the tree node; the node is annotated "custom" instead.

A node backed by a project-local file is always editable regardless of whether it
shadows a built-in name.

### Output Tree behaviour

- Nodes are built by rendering each manifest entry's `path` expression against the
  live context, then grouping by directory prefix.
- Nodes whose `when` evaluates to false are shown greyed-out (visible but annotated
  "skipped"); clicking them still opens the template for viewing or editing.
- Built-in-backed nodes show a lock icon (🔒) and a "built-in" badge. Clicking
  opens the template read-only with the copy banner described above.
- Custom (project-local) nodes show no icon; they open directly in edit mode.
- Group headers (`rtl/`, `tb/`, `altera/`) have a toggle checkbox that writes back
  to `manifest.groups[name].enabled` and saves the manifest immediately.
- "Add output" opens an inline form with three fields: template filename, output path
  expression (Jinja2 autocomplete from context keys), group picker. Pressing Enter
  appends to `manifest.outputs` and saves.

### Monaco setup

- Language: `jinja2` alias is not built-in. Register a minimal TextMate grammar for
  Jinja2 block/variable/comment tokens, or re-use the `django-html` grammar that
  ships with VS Code (adequate for `.j2` files in practice).
- Autocomplete provider: on `{{` or `}}` trigger, offer context variable names from
  the live `context` object sent by the host during `init`.
- The output-path chip above the editor is a small `contenteditable` span (or a
  second single-line Monaco instance) with the same autocomplete provider.
- Monaco `readOnly` option is set to `true` whenever the selected template resolves
  to `ipcraft://builtin`. It is set to `false` on the same editor instance after a
  successful "Copy to ./templates/" — no panel reload required.

---

## Implementation Stages

Each stage is independently shippable and tested before starting the next.

### Stage 1 — Manifest backend (no UI)

**Deliverables:**
- `src/generator/templateManifest.ts` — types
- `src/generator/ManifestLoader.ts` — find + parse + validate
- `src/generator/ManifestDrivenScaffolder.ts` — render loop
- Updated `TemplateLoader` to accept `string[]`
- Manifest gate in `IpCoreScaffolder.generateAll()`
- Unit tests in `src/test/suite/generator/ManifestDrivenScaffolder.test.ts`

**Acceptance:** running "Generate" on a project with an `ipcraft.templates.yml`
produces the correct file tree; without a manifest the output is identical to today.

### Stage 2 — Custom template directory (no UI)

**Deliverables:**
- `templateDirs` resolution in `ManifestLoader` including `ipcraft://builtin` sentinel
- Integration test: a project with `./templates/top.vhdl.j2` override generates the
  custom file; all other files still use built-ins

**Acceptance:** user can drop a custom `.j2` file in `./templates/`, add a matching
entry (or just override an existing one) in the manifest, and see their file generated.

### Stage 3 — Template editor webview

**Deliverables:**
- `src/providers/TemplateEditorProvider.ts` — including `copyBuiltin` handler
- `src/webview/templateEditor/` — all components listed above
- Built-in read-only enforcement: `TemplatePane` checks template origin and sets
  Monaco `readOnly` accordingly; banner component shown for built-in templates
- "Copy to ./templates/" action: writes file to disk, posts `copiedBuiltin`, webview
  unlocks editor in place
- New command: `ipcraft.openTemplateEditor`
- Registered in `package.json` command palette

**Acceptance:** command opens the editor, clicking a tree node loads the correct
template and renders a live preview, saving writes the file to disk.

### Stage 4 — Manifest authoring from the UI

**Deliverables:**
- "Add output" inline form in `OutputTree`
- Group toggle checkboxes persist to `ipcraft.templates.yml`
- "Initialise manifest" action that writes a default manifest matching the current
  built-in behaviour (lets users start from a known baseline and modify from there)

**Acceptance:** a user can go from zero to a fully custom manifest without ever
hand-editing YAML.

---

## Decisions

| # | Decision |
|---|---|
| 1 | User-level manifest is supported at `~/.config/ipcraft/ipcraft.templates.yml`. Resolution: project → user → built-in defaults. |
| 2 | Non-Nunjucks generators (e.g. `component-xml`) are expressible in the manifest via the `generator` field. See manifest format and `ManifestDrivenScaffolder` dispatch above. |
| 3 | **Command-launched panel** (`ipcraft.openTemplateEditor`), not a `CustomTextEditorProvider`. Background: VS Code offers two integration points — a *custom editor* that hijacks double-clicking `.j2` files everywhere in the explorer, or a *command panel* opened only via the command palette or a button. The 3-column split-pane layout does not fit naturally into the single-file editor slot; a full-width panel is the better host. A future `.j2` file association can always be added on top. |
| 4 | Nunjucks runs **in the webview** (~150 KB, pure JS). The extension host sends built-in template sources and the full context on `init`; the webview renders previews locally with no round-trips. |
