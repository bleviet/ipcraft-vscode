import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { IpCoreShell } from '../../../webview/ipcore/components/IpCoreShell';
import type { IpCoreToolbarProps } from '../../../webview/ipcore/components/IpCoreToolbar';

const toolbarProps: IpCoreToolbarProps = {
  canUndo: false,
  canRedo: false,
  onUndo: jest.fn(),
  onRedo: jest.fn(),
  toolbarTargets: [],
  allToolchains: [],
  hdlLanguage: 'vhdl',
  scaffoldPack: 'builtin-minimal',
  availableScaffoldPacks: [],
  hasHwTcl: false,
  hasQpf: false,
  hasComponentXml: false,
  hasXpr: false,
  consistencyChecking: false,
  hasConsistencyResult: false,
  consistencyBadge: { label: 'Not checked', color: 'gray', title: 'Not checked' },
  onCheckConsistency: jest.fn(),
  onToggleConsistencyOverlay: jest.fn(),
  issueErrorCount: 1,
  issueWarningCount: 0,
  onOpenIssues: jest.fn(),
};

describe('IpCoreShell preview conformance', () => {
  it('disables import Save for known errors and exposes Issues', () => {
    const onOpenIssues = jest.fn();
    render(
      <IpCoreShell
        fileName="preview.vhd"
        toolbarProps={toolbarProps}
        isPreview
        duplicatePrefixes={[]}
        parseError={null}
        hasIpCore={false}
        editorPanelProps={{ ipCore: null, onUpdate: jest.fn() }}
        rightPanel={null}
        importIssues={{ saveBlocked: true, hasWarnings: false, onOpen: onOpenIssues }}
        toast={null}
      />
    );

    expect(screen.getByRole('button', { name: /Save as .ip.yml/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Issues' }));
    expect(onOpenIssues).toHaveBeenCalledTimes(1);
  });

  it('keeps import Save enabled for unresolved warnings', () => {
    render(
      <IpCoreShell
        fileName="preview.vhd"
        toolbarProps={{ ...toolbarProps, issueErrorCount: 0, issueWarningCount: 1 }}
        isPreview
        duplicatePrefixes={[]}
        parseError={null}
        hasIpCore={false}
        editorPanelProps={{ ipCore: null, onUpdate: jest.fn() }}
        rightPanel={null}
        importIssues={{ saveBlocked: false, hasWarnings: true, onOpen: jest.fn() }}
        toast={null}
      />
    );

    expect(screen.getByRole('button', { name: /Save as .ip.yml/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open Issues' })).toBeEnabled();
  });
});
