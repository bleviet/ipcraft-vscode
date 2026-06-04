## Your IP core lives in a .ip.yml file

An `.ip.yml` file is the single source of truth for your IP core — its name, version, clocks, resets, ports, bus interfaces, and code generation settings all live here.

IPCraft opens it in the visual canvas editor by default. You can switch to the raw YAML at any time with **Ctrl+Shift+V**.

### What you'll fill in

The file is created with sensible defaults:

```yaml
vlnv:
  vendor: your-company   # reverse-DNS style, e.g. com.acme
  library: ip
  name: my_core
  version: 1.0.0
description: ""
```

**VLNV** stands for Vendor · Library · Name · Version — the four-part identifier that uniquely names your IP core across tools and repositories.

> **Tip:** Set `ipcraft.import.vendor` and `ipcraft.import.library` in settings once and every new file will inherit those values.
