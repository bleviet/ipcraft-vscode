import * as vscode from 'vscode';
import { runConsistencyCheck, summarize } from '../../../commands/ConsistencyCheckCommands';
import type { HdlCrossCheckFinding } from '../../../generator/validation/hdlCrossCheck';
import { loadIpCoreData } from '../../../generator/loadIpCore';
import {
  crossCheckIpCoreAgainstTopLevelHdl,
  crossCheckIpCoreAgainstVendor,
} from '../../../generator/validation/hdlCrossCheck';
import { loadRuntimeBusLibrary } from '../../../services/loadRuntimeBusLibrary';
import { checkBusConformance } from '../../../shared/busConformance';
import type { ResourceRoots } from '../../../services/ResourceRoots';

jest.mock('../../../generator/loadIpCore');
jest.mock('../../../generator/validation/hdlCrossCheck', () => ({
  crossCheckIpCoreAgainstTopLevelHdl: jest.fn(),
  crossCheckIpCoreAgainstVendor: jest.fn(),
}));
jest.mock('../../../services/loadRuntimeBusLibrary');
jest.mock('../../../shared/busConformance', () => ({
  checkBusConformance: jest.fn(),
}));

function finding(overrides: Partial<HdlCrossCheckFinding> = {}): HdlCrossCheckFinding {
  return {
    kind: 'missing-port',
    message: 'test',
    ipYmlPath: ['ports', 0],
    hdlFile: 'rtl/core.sv',
    hdlEntity: 'core',
    severity: 'red',
    source: 'hdl',
    ...overrides,
  };
}

describe('summarize', () => {
  it('buckets extra-* kinds as added', () => {
    const summary = summarize([
      finding({ kind: 'extra-port' }),
      finding({ kind: 'extra-parameter' }),
    ]);
    expect(summary).toEqual({ added: 2, removed: 0, changed: 0, ambiguous: 0 });
  });

  it('buckets missing-* kinds as removed', () => {
    const summary = summarize([
      finding({ kind: 'missing-port' }),
      finding({ kind: 'missing-register' }),
    ]);
    expect(summary).toEqual({ added: 0, removed: 2, changed: 0, ambiguous: 0 });
  });

  it('buckets mismatch kinds as changed', () => {
    const summary = summarize([finding({ kind: 'width-mismatch' })]);
    expect(summary).toEqual({ added: 0, removed: 0, changed: 1, ambiguous: 0 });
  });

  // issue #161: a top-level-ambiguity finding means no comparison happened at all — it must
  // never be counted as "changed", which would misrepresent it as confirmed interface drift.
  it('buckets top-level-ambiguity as ambiguous, not changed', () => {
    const summary = summarize([finding({ kind: 'top-level-ambiguity', severity: 'amber' })]);
    expect(summary).toEqual({ added: 0, removed: 0, changed: 0, ambiguous: 1 });
  });

  it('buckets a mix of kinds independently', () => {
    const summary = summarize([
      finding({ kind: 'extra-port' }),
      finding({ kind: 'missing-port' }),
      finding({ kind: 'width-mismatch' }),
      finding({ kind: 'top-level-ambiguity', severity: 'amber' }),
    ]);
    expect(summary).toEqual({ added: 1, removed: 1, changed: 1, ambiguous: 1 });
  });
});

describe('runConsistencyCheck protocol boundary', () => {
  it('reports protocol conformance before implementation findings', async () => {
    const protocolIssue = {
      code: 'BUS_PROPERTY_RANGE',
      severity: 'error' as const,
      source: 'protocol' as const,
      path: ['busInterfaces', 0, 'interfaceProperties', 'readyLatency'],
      message: 'readyLatency is outside its allowed range.',
    };
    (loadIpCoreData as jest.Mock).mockResolvedValue({
      vlnv: { name: 'example' },
      busInterfaces: [],
    });
    (loadRuntimeBusLibrary as jest.Mock).mockResolvedValue({ contracts: [] });
    (checkBusConformance as jest.Mock).mockReturnValue({
      issues: [protocolIssue],
      hasKnownErrors: true,
      hasUnresolved: false,
    });
    (crossCheckIpCoreAgainstTopLevelHdl as jest.Mock).mockResolvedValue([]);
    (crossCheckIpCoreAgainstVendor as jest.Mock).mockResolvedValue([]);

    const result = await runConsistencyCheck(
      { fsPath: '/workspace/example.ip.yml' } as vscode.Uri,
      {} as ResourceRoots
    );

    expect(result.issues).toEqual([protocolIssue]);
    expect(result.summary).toEqual({ added: 0, removed: 0, changed: 0, ambiguous: 0 });
  });
});
