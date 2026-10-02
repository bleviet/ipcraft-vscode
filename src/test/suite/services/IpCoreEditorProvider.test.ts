import * as path from 'path';
import * as vscode from 'vscode';
import { IpCoreEditorProvider } from '../../../providers/IpCoreEditorProvider';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { normalizeBusLibrary } from '../../../shared/busContracts';
import type { BusDefinitionFile } from '../../../domain/busDefinition.types';

describe('IpCoreEditorProvider bus contract transport', () => {
  it('posts the normalized library unchanged in a revisioned update message', async () => {
    const definitions: BusDefinitionFile = {
      CUSTOM: {
        busType: {
          vendor: 'example.com',
          library: 'interface',
          name: 'custom',
          version: '1.0',
        },
        contract: {
          version: 1,
          interfaceKind: 'conduit',
          modePolicy: { producer: 'master', consumer: 'slave', aliases: {} },
          interfaceProperties: {},
          constraints: [],
        },
        ports: [{ name: 'payload', direction: 'out', role: 'data' }],
      },
    };
    const library = normalizeBusLibrary([
      { sourceFile: '/workspace/custom.yml', sourceKind: 'workspace', definitions },
    ]);
    const repoRoot = path.resolve(__dirname, '../../../..');
    const provider = Object.create(IpCoreEditorProvider.prototype) as IpCoreEditorProvider;
    const logger = { debug: jest.fn(), error: jest.fn() };
    Object.assign(provider as unknown as Record<string, unknown>, {
      logger,
      resourceRoots: devResourceRoots(repoRoot),
      importResolver: { resolveImports: jest.fn().mockResolvedValue({ busLibrary: library }) },
      yamlValidator: {
        validateAgainstSchema: jest.fn().mockReturnValue({ valid: true }),
        findDuplicatePhysicalPrefixes: jest.fn().mockReturnValue([]),
      },
    });
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, fallback?: unknown) => fallback,
    });
    const document = {
      getText: () => 'vlnv:\n  vendor: example.com\n  library: ip\n  name: demo\n  version: 1.0\n',
      version: 7,
      uri: { fsPath: '/workspace/demo.ip.yml' },
    } as unknown as vscode.TextDocument;
    const postUpdate = jest.fn();
    const postNotification = jest.fn();

    await (
      provider as unknown as {
        updateWebview: (
          document: vscode.TextDocument,
          router: { postUpdate: jest.Mock; postNotification: jest.Mock },
          disposed: () => boolean
        ) => Promise<void>;
      }
    ).updateWebview(document, { postUpdate, postNotification }, () => false);

    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ imports: { busLibrary: library } }),
      7
    );
    expect(postUpdate.mock.calls[0][0]).not.toHaveProperty('conformanceReport');
    expect(postNotification).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
