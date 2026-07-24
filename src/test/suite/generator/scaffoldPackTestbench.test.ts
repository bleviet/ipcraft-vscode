import {
  packOwnsSimulationEnvironment,
  shouldGenerateFrameworkTestbench,
} from '../../../generator/scaffoldPackTestbench';
import type { ScaffoldPack } from '../../../generator/types';

function pack(overrides: Partial<ScaffoldPack> = {}): ScaffoldPack {
  return {
    name: 'test-pack',
    packDir: '/pack',
    fullGeneration: true,
    files: [],
    ...overrides,
  };
}

describe('scaffold pack testbench ownership', () => {
  it('recognizes a full-generation pack with a testbench and its own runner', () => {
    const subject = pack({
      files: [
        { source: 'custom_tb.vhd.j2', target: 'sim/{{ name }}_tb.vhd' },
        { source: 'Makefile.j2', target: 'sim/Makefile' },
      ],
    });

    expect(packOwnsSimulationEnvironment(subject)).toBe(true);
    expect(shouldGenerateFrameworkTestbench(subject)).toBe(false);
  });

  it('preserves the enabled default for packs with only supplemental simulation output', () => {
    const subject = pack({
      files: [{ source: 'wave.gtkw', target: 'sim/wave.gtkw' }],
    });

    expect(packOwnsSimulationEnvironment(subject)).toBe(false);
    expect(shouldGenerateFrameworkTestbench(subject)).toBe(true);
  });

  it('honors explicit choices even when inferred ownership disagrees', () => {
    const files = [
      { source: 'test.py.j2', target: 'tests/test_core.py' },
      { source: 'run.sh.j2', target: 'tests/run_sim.sh' },
    ];

    expect(
      shouldGenerateFrameworkTestbench(
        pack({
          files,
          generateFrameworkTestbench: true,
          generateFrameworkTestbenchDeclared: true,
        })
      )
    ).toBe(true);
    expect(
      shouldGenerateFrameworkTestbench(
        pack({
          files: [],
          generateFrameworkTestbench: false,
          generateFrameworkTestbenchDeclared: true,
          fullGeneration: false,
        })
      )
    ).toBe(false);
  });
});
