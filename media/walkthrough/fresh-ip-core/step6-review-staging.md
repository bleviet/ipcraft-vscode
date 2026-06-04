## The staging overlay

Before anything is written to disk, IPCraft shows you exactly what will happen.

### File status indicators

| Indicator | Meaning |
|-----------|---------|
| 🟢 Green dot | New file — will be created |
| 🟠 Orange dot | Existing file that will be modified |
| ⚪ Grey dot | File is unchanged — no write needed |
| 🔒 Lock icon | User-owned file (`managed: false`) — IPCraft will **never** overwrite this |

### Before you accept

Click **View Diff** next to any modified file to open a side-by-side diff in VS Code's built-in diff editor. You can see exactly what changed before committing.

### Accepting the scaffold

Click **Apply** to write all staged files to disk. Click **Cancel** to discard.

### User-owned files

The `*_core.vhd` file is marked `managed: false` by default — it is yours to edit and IPCraft will never overwrite it on subsequent scaffolds. All other files (top, wrapper, regfile) are regenerated from your spec on every scaffold run.

> **Tip:** To see which files a scaffold pack treats as user-owned, open the **Project Scaffold** section and look for the lock icon in the preview tree.
