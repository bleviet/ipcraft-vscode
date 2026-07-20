# IPCraft CLI

Headless HDL and FPGA vendor-project generation using the same generator as
the IPCraft VS Code extension.

Requires Node.js 20 or later.

```bash
ipcraft generate path/to/core.ip.yml --target quartus --lang vhdl --out gen/
ipcraft verify path/to/core.ip.yml gen/ --target quartus --lang vhdl
```

Run `ipcraft --help` for all options. Installing the VS Code extension does
not install this command; the CLI and extension are released separately from
the same [source repository](https://github.com/bleviet/ipcraft-vscode).

The standalone CLI was introduced by
[issue #72](https://github.com/bleviet/ipcraft-vscode/issues/72). Its npm
distribution is tracked by
[issue #116](https://github.com/bleviet/ipcraft-vscode/issues/116).
