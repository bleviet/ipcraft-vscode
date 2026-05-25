/* eslint-disable */
import { getToolchain, listAvailable, listAll } from '../../../../services/toolchains/registry';

jest.mock('../../../../services/toolchains/VivadoToolchain', () => ({
  VivadoToolchain: jest.fn().mockImplementation(() => ({
    id: 'vivado',
    displayName: 'Vivado (Xilinx/AMD)',
    outputSubdir: 'xilinx',
    contextKey: 'ipcraft.vivadoFound',
    isAvailable: jest.fn().mockReturnValue(false),
  })),
}));

jest.mock('../../../../services/toolchains/QuartusToolchain', () => ({
  QuartusToolchain: jest.fn().mockImplementation(() => ({
    id: 'quartus',
    displayName: 'Quartus (Intel/Altera)',
    outputSubdir: 'altera',
    contextKey: 'ipcraft.quartusFound',
    isAvailable: jest.fn().mockReturnValue(false),
  })),
}));

// Re-import after mocks are wired so the TOOLCHAINS array uses mock instances
// (jest.mock hoisting ensures the mocks are in place before the module loads)
import { VivadoToolchain } from '../../../../services/toolchains/VivadoToolchain';
import { QuartusToolchain } from '../../../../services/toolchains/QuartusToolchain';

function makeCfg() {
  return {
    get: jest.fn((_key: string, def?: unknown) => def),
  } as unknown as import('vscode').WorkspaceConfiguration;
}

describe('registry', () => {
  it('listAll() returns exactly vivado and quartus', () => {
    const all = listAll();
    expect(all.map((t) => t.id).sort()).toEqual(['quartus', 'vivado']);
  });

  it('getToolchain() returns the right toolchain by id', () => {
    expect(getToolchain('vivado')?.id).toBe('vivado');
    expect(getToolchain('quartus')?.id).toBe('quartus');
  });

  it('getToolchain() returns undefined for unknown id', () => {
    expect(getToolchain('questa')).toBeUndefined();
  });

  it('listAvailable() returns only toolchains where isAvailable() is true', () => {
    const all = listAll();
    const vivado = all.find((t) => t.id === 'vivado')!;
    const quartus = all.find((t) => t.id === 'quartus')!;

    (vivado.isAvailable as jest.Mock).mockReturnValue(true);
    (quartus.isAvailable as jest.Mock).mockReturnValue(false);

    const cfg = makeCfg();
    const available = listAvailable(cfg);
    expect(available.map((t) => t.id)).toEqual(['vivado']);
  });

  it('listAvailable() returns all when both are available', () => {
    const all = listAll();
    all.forEach((t) => (t.isAvailable as jest.Mock).mockReturnValue(true));

    const cfg = makeCfg();
    const available = listAvailable(cfg);
    expect(available.map((t) => t.id).sort()).toEqual(['quartus', 'vivado']);
  });

  it('listAvailable() returns empty when none available', () => {
    const all = listAll();
    all.forEach((t) => (t.isAvailable as jest.Mock).mockReturnValue(false));

    const cfg = makeCfg();
    expect(listAvailable(cfg)).toHaveLength(0);
  });
});
