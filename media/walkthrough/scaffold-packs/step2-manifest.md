## The scaffold.yml manifest

After exporting, choose **Open scaffold.yml** in the confirmation notification.
IPCraft opens `.vscode/ipcraft/packs/<your-pack>/scaffold.yml` and the
**Scaffold Pack Preview** panel beside it. Opening the manifest manually does
not create the panel, but an already-open panel refreshes whenever you save
`scaffold.yml`.

A manifest entry looks like this:

```yaml
- source: "core.vhdl.j2"       # template to render
  target: "rtl/{{ name }}_core.vhd"  # output path (Nunjucks expression)
  condition: "not is_systemverilog"   # skip this file when generating SV
  managed: false                # never overwrite after first generation
```

**Key fields:**

- **`source`** — template filename. Searched in the pack directory first, then
  the built-in library. Can contain `{{ bus_type }}` or other variables.
- **`target`** — output path relative to the generation directory.
  `{{ name }}` expands to the IP core's VLNV name.
- **`condition`** — Nunjucks boolean expression. Leave it out to always include
  the file. Common values: `not is_systemverilog`, `has_memory_mapped_slave`,
  `includeRegs and has_memory_mapped_slave`.
- **`managed: false`** — write once, never overwrite. Use this for user logic
  stubs and documentation files that engineers edit by hand.

Save the file — the preview panel refreshes immediately.
