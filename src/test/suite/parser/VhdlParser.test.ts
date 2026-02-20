import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { VhdlParser } from '../../../parser/VhdlParser';

describe('VhdlParser', () => {
  it('parses an entity with ports', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'my_module.vhd');
    const vhdl = `
      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;

      entity my_module is
        port (
          clk     : in  std_logic;
          reset_n : in  std_logic;
          data_o  : out std_logic_vector(7 downto 0)
        );
      end entity my_module;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const parser = new VhdlParser();
    const result = await parser.parseFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    expect(result.entityName).toBe('my_module');
    expect((parsed.ports as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('detects AXI-like bus interface patterns', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'axi_slave.vhd');
    const vhdl = `
      entity axi_slave is
        port (
          S_AXI_ACLK    : in  std_logic;
          S_AXI_ARESETN : in  std_logic;
          S_AXI_AWADDR  : in  std_logic_vector(31 downto 0);
          S_AXI_AWVALID : in  std_logic;
          S_AXI_AWREADY : out std_logic;
          S_AXI_WDATA   : in  std_logic_vector(31 downto 0)
        );
      end entity axi_slave;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const parser = new VhdlParser();
    const result = await parser.parseFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    expect((parsed.busInterfaces as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
  });
});
