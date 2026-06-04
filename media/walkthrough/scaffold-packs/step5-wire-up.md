## Activate the pack

The active scaffold pack is a **workspace setting**, not something stored in the `.ip.yml`
spec. This keeps IP core definitions independent of tooling preferences.

**Option A — Canvas dropdown (fastest)**

Open any `.ip.yml` in the visual editor and pick your pack from the
**Code Generation Methodology** dropdown in the toolbar. The setting is saved immediately.

**Option B — settings.json**

```json
{
  "ipcraft.generate.scaffoldPack": "my-pack-name"
}
```

The pack name matches the folder under `.vscode/ipcraft/packs/`.

Then run **IPCraft: Generate HDL** or **IPCraft: Scaffold Project** as usual.
The staging panel shows exactly which files will be written before anything
touches disk.

**Sharing packs across a team**

Commit `.vscode/ipcraft/packs/` to your repository.
Every engineer who clones the repo gets the same generation layout and
templates automatically — no configuration required beyond setting
`ipcraft.generate.scaffoldPack` in their workspace settings.

---

You are ready to generate fully customised RTL output.
