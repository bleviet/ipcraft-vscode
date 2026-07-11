## The staging overlay

Before anything is written to disk, IPCraft shows you exactly what will happen.

### File status indicators

| Status | Meaning |
|--------|---------|
| New | File does not exist yet — will be created |
| Modified | Existing file whose content differs — will be overwritten unless excluded |
| Unchanged | Generated content is identical to what's on disk — no write needed |
| Protected (lock icon) | User-owned file (`managed: false`) — excluded from Apply by default; use its **Overwrite** toggle to include it anyway |

### Before you accept

Click **View Diff** next to any modified file to open a side-by-side diff in VS Code's built-in diff editor. You can see exactly what changed before committing.

### Accepting the scaffold

Click **Confirm & Apply** to write all staged, non-excluded files to disk. Click **Cancel** to discard.

### User-owned files

Files are only protected from overwrite if something explicitly marks them `managed: false` — either a `fileSets` entry you add to the `.ip.yml` yourself, or a scaffold pack rule. **The default `builtin-ipcraft` pack does not mark any RTL file `managed: false`**, including `<name>_core.vhd` — every scaffold run regenerates it from the template, so custom logic you add there will be overwritten unless you protect it explicitly. To keep your hand-edited core logic safe, add a `fileSets` entry for it with `managed: false`, or switch to a pack that already protects it (e.g. `example-no-regfile`).

> **Tip:** To see which files a scaffold pack treats as user-owned, open the **Project Scaffold** section and look for the lock icon in the preview tree.
