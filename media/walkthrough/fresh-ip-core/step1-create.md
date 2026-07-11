## Your IP core lives in a .ip.yml file

An `.ip.yml` file is the single source of truth for your IP core — its name, version, clocks, resets, ports, bus interfaces, and code generation settings all live here.

IPCraft opens it in the visual canvas editor by default. You can switch to the raw YAML at any time with **Ctrl+Shift+V**.

### What you'll fill in

The file is created with sensible defaults:

```yaml
vlnv:
  vendor: user            # from the ipcraft.import.vendor setting
  library: my_library
  name: my_core            # taken from the file name you chose
  version: 1.0.0
description: A new IP Core definition
```

**VLNV** stands for Vendor · Library · Name · Version — the four-part identifier that uniquely names your IP core across tools and repositories.

> **Tip:** Set `ipcraft.import.vendor` in settings once and every new blank IP core will inherit it as the default vendor.
