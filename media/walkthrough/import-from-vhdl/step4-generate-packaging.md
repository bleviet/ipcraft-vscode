## Packaging for Vivado and Quartus

Once your `.ip.yml` is correct, generating vendor packaging files is one command each.

### Vivado — component.xml (IP-XACT)

**Generate Xilinx Vivado Component (component.xml)** generates an IP-XACT descriptor that Vivado's IP Catalog can consume directly. The file includes:

- VLNV identification
- Port declarations with direction and width
- Bus interface definitions with port maps
- Clock and reset associations
- Parameter declarations with types and ranges
- File sets pointing at your RTL sources

After generating, add the IP to the Vivado IP Catalog by pointing it at the directory containing `component.xml`.

### Quartus — _hw.tcl (Platform Designer)

**Generate Altera Platform Designer Component (_hw.tcl)** generates a Quartus Platform Designer component file that matches your `.ip.yml` spec.

The TCL file includes:
- `set_module_property` statements for name, version, and display name
- `add_interface` and `add_interface_port` for every bus and port
- File set declarations with your RTL paths

### Generating both simultaneously

Run **Scaffold Project** with both `vivado` and `quartus` listed in your targets (the `.ip.yml` `targets` field, or the `ipcraft.generate.targets` workspace setting). IPCraft generates both descriptors alongside the RTL in a single staging run.

```yaml
# In .ip.yml
targets: [vivado, quartus]
```

> **Tip:** You can open the generated `component.xml` in Vivado IP Packager directly with **Edit in IP Packager** for final tweaks. By default `component.xml` is regenerated (overwritten) on every scaffold — to keep manual IP Packager edits, add a `fileSets` entry for it in `.ip.yml` with `managed: false`, the same mechanism used to protect hand-edited RTL.
