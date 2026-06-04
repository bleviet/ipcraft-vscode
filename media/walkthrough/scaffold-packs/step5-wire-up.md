## Wire the pack to an IP core

Add one line to any `.ip.yml` file to activate your pack:

```yaml
vlnv:
  vendor: acme
  name: spi_controller
  version: "1.0"

scaffold_pack: "my-pack-name"   # ← matches the folder name under .vscode/ipcraft/packs/
```

Then run **IPCraft: Generate HDL** or **IPCraft: Scaffold Project** as usual.
The staging panel shows exactly which files will be written before anything
touches disk.

**Sharing packs across a team**

Commit `.vscode/ipcraft/packs/` to your repository.
Every engineer who clones the repo gets the same generation layout and
templates automatically — no configuration required.

**Using a pack without modifying the YAML**

Set `ipcraft.generate.scaffoldPack` in workspace settings to apply a pack to
all IP cores in the workspace without adding `scaffold_pack:` to individual
files.

---

You are ready to generate fully customised RTL output.
