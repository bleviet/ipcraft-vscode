# Build and Verify a Scaffold Pack

This tutorial starts from a built-in scaffold pack, adds a generated Markdown
file, and verifies the result.

You will learn how to:

- export a pack into the workspace;
- add one template and output rule;
- preview the generated file tree;
- generate and compile the project.

## Prerequisites

- IPCraft installed or running in an Extension Development Host
- a workspace containing an `.ip.yml` file
- GHDL for VHDL verification, or Icarus Verilog for SystemVerilog

If you need a sample core, first follow
[Creating your first IP core](../how-to/create-your-first-ip-core.md).

## Workflow

```mermaid
flowchart LR
    A[Export built-in pack] --> B[Add template]
    B --> C[Add output rule]
    C --> D[Preview]
    D --> E[Generate]
    E --> F[Compile and inspect]
```

## 1. Export a starting pack

1. Open the Command Palette.
2. Run **IPCraft: Export Built-in Scaffold Pack**.
3. Select `builtin-ipcraft`.
4. Name the copy `ipcraft-with-docs`.

IPCraft creates:

```text
.vscode/ipcraft/packs/ipcraft-with-docs/
├── scaffold.yml
└── ... copied templates
```

Open `scaffold.yml`. The Scaffold Pack Preview shows which files the selected
IP core would generate.

![Selecting a scaffold pack in the IP Core editor](../images/scaffold-template-picker-light.png)

## 2. Add a documentation template

Create `.vscode/ipcraft/packs/ipcraft-with-docs/registers.md.j2`:

```jinja2
# {{ display_name }} Register Map

{% if description %}{{ description }}{% endif %}

{% for register in registers %}
## {{ register.name }}

Offset: `{{ register.offset }}`

| Field | Bits | Access | Reset |
|---|---:|---|---:|
{% for field in register.fields %}
| `{{ field.name }}` | `{{ field.bits }}` | {{ field.access }} | `{{ field.resetValue }}` |
{% endfor %}

{% endfor %}
```

Template variable names in Nunjucks may use snake case. TypeScript and schema
properties elsewhere in IPCraft use camel case.

## 3. Add an output rule

Append this entry to `files` in `scaffold.yml`:

```yaml
  - source: "registers.md.j2"
    target: "docs/{{ name }}-registers.md"
    condition: "has_memory_mapped_slave"
```

The condition skips the file when the IP core has no memory-mapped slave
interface.

To let users edit the generated document without later replacement, add:

```yaml
    managed: false
```

A file with `managed: false` is created once and then treated as user-owned.

## 4. Preview before generation

Open `registers.md.j2` and run **IPCraft: Preview Template Output**. If the
workspace contains several IP cores, choose the one to use as preview data.

Also check the Scaffold Pack Preview beside `scaffold.yml`. The new file should
appear as generated. If it appears as skipped, confirm that the selected core
has a memory-mapped slave.

The two previews answer different questions:

| Preview | What to check |
|---|---|
| Template output | The contents of one rendered file |
| Scaffold Pack Preview | Output paths, conditions, and protected files |

## 5. Select and generate

1. Open the IP core in the visual editor.
2. Select `ipcraft-with-docs` from **Scaffold Template**.
3. Run **IPCraft: Scaffold Project**.
4. Review the staged file list.
5. Accept the output.

The project should now contain a file similar to:

```text
docs/<core-name>-registers.md
```

Open it and confirm that register names, offsets, fields, access, and reset
values match the linked memory map.

## 6. Compile the generated HDL

Use the build command supplied by the generated project, or run the relevant
HDL integration test in the IPCraft repository:

```bash
npm run test:integration:hdl
```

The Markdown file can look correct even when another template produces invalid
HDL, so both checks matter.

## 7. Test regeneration behavior

Change a description in the source YAML and generate again.

- With the default `managed: true`, the Markdown output should show the new
  description in the staging review.
- With `managed: false`, an existing Markdown file should remain unchanged.

This verifies that the pack's ownership rule matches your intent.

## Common problems

| Problem | Likely cause |
|---|---|
| Template is missing | `source` does not match the `.j2` filename |
| Documentation file is skipped | `has_memory_mapped_slave` is false |
| Output path is unexpected | `target` uses the wrong template value |
| Preview uses another core | Pin the intended file with **IPCraft: Pin Preview IP Core** |
| Hand edits disappear | Set `managed: false` for user-owned output |
| Pack is not listed | Check `.vscode/ipcraft/packs/<name>/scaffold.yml` |

## What to do next

- Add only the templates your organization needs to change.
- Keep conditions short and visible in the file-tree preview.
- Generate both HDL languages if the pack claims to support both.
- Run vendor integration tests when the pack creates Vivado or Quartus files.

See [Customizing generated files with scaffold packs](../how-to/customizing-generated-files-with-scaffold-packs.md)
for the manifest and template-value reference.
