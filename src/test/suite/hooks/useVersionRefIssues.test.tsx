import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { normalizeMemoryMap } from '../../../domain/parse';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';
import type { VersionContext } from '../../../shared/versioning/versionContext';
import {
  computeVersionRefIssues,
  indexVersionRefIssues,
  useVersionRefIssues,
} from '../../../webview/hooks/useVersionRefIssues';
import {
  useMapVersionIssues,
  useRegisterVersionIssues,
  VersionRefIssuesProvider,
} from '../../../webview/hooks/useVersionRefIssuesContext';
import { VersionContextProvider } from '../../../webview/hooks/useVersionContext';

const resolved: VersionContext = {
  status: 'resolved',
  versionScheme: 'major.minor',
  version: '1.4',
};

const versionRegister = (offset: number) => ({
  name: 'VERSION',
  offset,
  fields: [
    { name: 'MAJOR', bits: '[15:8]', resetValue: '$version.major' },
    { name: 'MINOR', bits: '[7:0]', resetValue: '$version.minor' },
  ],
});

function mapOf(registers: unknown[], versionHistory?: unknown): NormalizedMemoryMap {
  return normalizeMemoryMap({
    name: 'm',
    addressBlocks: [{ name: 'B', baseAddress: 0, registers }],
    ...(versionHistory ? { versionHistory } : {}),
  });
}

describe('computeVersionRefIssues', () => {
  it('runs the scheme rules only when the scheme is resolved', () => {
    const map = mapOf([
      { name: 'V', fields: [{ name: 'PATCH', bits: '[7:0]', resetValue: '$version.patch' }] },
    ]);

    expect(computeVersionRefIssues(map, { status: 'none' })).toEqual([]);
    const issues = computeVersionRefIssues(map, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('$version.patch is not available');
    expect(issues[0].path).toEqual(['addressBlocks', 0, 'registers', 0, 'fields', 0]);
  });

  it('reports history warnings using the domain normalizer for snapshots', () => {
    const history = {
      registerSets: {
        h1: { addressBlocks: [{ name: 'B', baseAddress: 0, registers: [versionRegister(0)] }] },
      },
      versions: [{ version: '1.0', registerSet: 'h1' }],
    };
    const map = mapOf([versionRegister(4)], history);

    const issues = computeVersionRefIssues(map, resolved);
    const warning = issues.find((issue) => issue.severity === 'warning');
    expect(warning?.message).toContain('moved');
    expect(warning?.path).toEqual(['addressBlocks', 0, 'registers', 0]);
  });

  it('reports a version register that is gone on the map root', () => {
    const history = {
      registerSets: {
        h1: { addressBlocks: [{ name: 'B', baseAddress: 0, registers: [versionRegister(0)] }] },
      },
      versions: [{ version: '1.0', registerSet: 'h1' }],
    };
    const map = mapOf([{ name: 'OTHER', offset: 0 }], history);

    const issues = computeVersionRefIssues(map, resolved);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([]);
    expect(issues[0].message).toContain('No version register');
  });
});

describe('indexVersionRefIssues', () => {
  it('matches register and field issues to the register object by identity', () => {
    const map = mapOf([
      {
        name: 'V',
        resetValue: '$version',
        fields: [{ name: 'PATCH', bits: '[7:0]', resetValue: '$version.patch' }],
      },
      { name: 'PLAIN', offset: 4 },
    ]);
    const issues = computeVersionRefIssues(map, resolved);
    const { root, registers } = indexVersionRefIssues(map, issues);

    const [versionReg, plain] = map.addressBlocks[0].registers;
    expect(root).toEqual([]);
    expect(registers.has(plain)).toBe(false);
    const entry = registers.get(versionReg);
    expect(entry?.register.map((issue) => issue.message)).toEqual([
      expect.stringContaining('Use $version.* on the fields'),
    ]);
    expect(entry?.fields.get(0)?.[0].message).toContain('$version.patch is not available');
  });

  it('finds the registers nested in a register array', () => {
    const map = mapOf([
      {
        name: 'ARR',
        count: 2,
        stride: 4,
        registers: [{ name: 'INNER', resetValue: '$version' }],
      },
    ]);
    const { registers } = indexVersionRefIssues(map, computeVersionRefIssues(map, resolved));
    const array = map.addressBlocks[0].registers[0];
    const inner = array.registers?.[0] as object;
    expect(registers.get(inner)?.register[0].message).toContain('register arrays');
  });
});

describe('useVersionRefIssues and the issues context', () => {
  const map = mapOf([
    { name: 'V', resetValue: '$version', fields: [{ name: 'F', bits: '[7:0]' }] },
  ]);

  it('is empty without a map', () => {
    const { result } = renderHook(() => useVersionRefIssues(null, resolved));
    expect(result.current.root).toEqual([]);
    expect(result.current.registers.size).toBe(0);
  });

  it('recomputes the scheme rules when the version context arrives', () => {
    const patchMap = mapOf([
      { name: 'V', fields: [{ name: 'PATCH', bits: '[7:0]', resetValue: '$version.patch' }] },
    ]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VersionContextProvider>
        <VersionRefIssuesProvider memoryMap={patchMap}>{children}</VersionRefIssuesProvider>
      </VersionContextProvider>
    );
    const { result } = renderHook(
      () => useRegisterVersionIssues(patchMap.addressBlocks[0].registers[0]),
      { wrapper }
    );
    expect(result.current.fields.size).toBe(0);

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'versionContext', context: resolved } })
      );
    });
    expect(result.current.fields.get(0)?.[0].message).toContain('$version.patch is not available');
  });

  it('gives nothing outside a provider or for a foreign object', () => {
    const outside = renderHook(() => useRegisterVersionIssues(map.addressBlocks[0].registers[0]));
    expect(outside.result.current.register).toEqual([]);
    expect(outside.result.current.fields.size).toBe(0);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VersionRefIssuesProvider memoryMap={map}>{children}</VersionRefIssuesProvider>
    );
    const copy = renderHook(
      () => useRegisterVersionIssues({ ...map.addressBlocks[0].registers[0] }),
      { wrapper }
    );
    expect(copy.result.current.register).toEqual([]);
  });

  it('exposes the root issues through useMapVersionIssues', () => {
    const history = {
      registerSets: {
        h1: { addressBlocks: [{ name: 'B', baseAddress: 0, registers: [versionRegister(0)] }] },
      },
      versions: [{ version: '1.0', registerSet: 'h1' }],
    };
    const gone = mapOf([{ name: 'OTHER', offset: 0 }], history);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VersionRefIssuesProvider memoryMap={gone}>{children}</VersionRefIssuesProvider>
    );
    const { result } = renderHook(() => useMapVersionIssues(), { wrapper });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].message).toContain('No version register');
  });
});
