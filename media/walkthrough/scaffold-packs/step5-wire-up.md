## Activate the pack

The active scaffold pack can come from the IP-core document or from settings.
A non-empty `ipcraft.generate.scaffoldPack` setting is an explicit override;
when that setting is empty, generation uses `scaffold_pack` from `.ip.yml`,
then falls back to `builtin-minimal`.

**Option A — Canvas dropdown**

Open any `.ip.yml` in the visual editor and pick your pack from the
**Scaffold Template** dropdown in the toolbar. IPCraft writes
`scaffold_pack` into the current `.ip.yml` and also remembers the selection in
the global `ipcraft.generate.scaffoldPack` setting.

**Option B — Per-core YAML**

For a selection that travels with the IP core, add:

```yaml
scaffold_pack: my-pack-name
```

Keep `ipcraft.generate.scaffoldPack` empty when different IP cores should use
different YAML-selected packs.

**Option C — settings.json override**

```json
{
  "ipcraft.generate.scaffoldPack": "my-pack-name"
}
```

The pack name matches the folder under `.vscode/ipcraft/packs/`. A non-empty
setting applies to generation regardless of the `scaffold_pack` value in the
current file.

Then run **IPCraft: Generate Top-Level HDL** or **IPCraft: Scaffold Project** as usual.
The staging panel shows exactly which files will be written before anything
touches disk.

**Sharing packs across a team**

Commit `.vscode/ipcraft/packs/` to your repository.
Every engineer who clones the repo gets the same generation layout and
templates. Commit `scaffold_pack` in each `.ip.yml` for a shared per-core
selection, or commit an `ipcraft.generate.scaffoldPack` workspace setting when
one pack should override every core.

---

You are ready to generate fully customised RTL output.
