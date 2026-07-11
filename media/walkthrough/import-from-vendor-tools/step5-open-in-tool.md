## Final validation in the native tool

After generating vendor packaging, open it in the native GUI for a final sanity check before checking it in or distributing.

### Vivado IP Packager

Run **IPCraft: Edit in IP Packager** (right-click the `.ip.yml` or from the Command Palette).

IPCraft opens the generated `component.xml` directly in Vivado's IP Packager GUI. In the IP Packager you can:
- Verify bus interface port maps in the **Ports and Interfaces** tab
- Check parameter constraints and GUI display names in **Customization Parameters**
- Run **Re-Package IP** to validate the descriptor structure
- Make small edits if needed — IPCraft preserves manual edits on subsequent scaffolds (for fields it does not manage)

### Quartus Platform Designer

Run **IPCraft: Open in Platform Designer** (or right-click the `.ip.yml`).

IPCraft launches `qsys-edit` with the generated `_hw.tcl` loaded. In Platform Designer you can:
- Verify interface definitions and port assignments
- Test parameter validation logic
- Check clock and reset associations

### Workflow tip

Keep IPCraft as the source of truth and use the native tools only for validation. If you discover a mismatch, correct it in the `.ip.yml` and regenerate — do not edit the vendor files directly, as they will be overwritten on the next scaffold.

The one exception is `*_core.vhd` / your RTL implementation files — those are user-owned (`managed: false`) and IPCraft never overwrites them.
