## Final validation in the native tool

After generating vendor packaging, open it in the native GUI for a final sanity check before checking it in or distributing.

### Vivado IP Packager

Run **IPCraft: Edit in IP Packager** (right-click the `.ip.yml` or from the Command Palette).

IPCraft opens the generated `component.xml` directly in Vivado's IP Packager GUI. In the IP Packager you can:
- Verify bus interface port maps in the **Ports and Interfaces** tab
- Check parameter constraints and GUI display names in **Customization Parameters**
- Run **Re-Package IP** to validate the descriptor structure

### Quartus Platform Designer

Run **IPCraft: Open in Platform Designer** (or right-click the `.ip.yml`).

IPCraft launches `qsys-edit` with the generated `_hw.tcl` loaded. In Platform Designer you can:
- Verify interface definitions and port assignments
- Test parameter validation logic
- Check clock and reset associations

### Workflow tip

Keep IPCraft as the source of truth and use the native tools only for validation. If you discover a mismatch, correct it in the `.ip.yml` and regenerate — by default, `component.xml`, `_hw.tcl`, and every generated RTL file (including `*_core.vhd`) are overwritten on the next scaffold.

To protect a file you've hand-edited — RTL or vendor packaging — add a `fileSets` entry for it in `.ip.yml` with `managed: false`. Without that, nothing is protected automatically.
