import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  IpCoreToolbar,
  type IpCoreToolbarProps,
} from '../../../webview/ipcore/components/IpCoreToolbar';

function props(overrides: Partial<IpCoreToolbarProps> = {}): IpCoreToolbarProps {
  return {
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
    issueErrorCount: 2,
    issueWarningCount: 3,
    onOpenIssues: jest.fn(),
    ...overrides,
  };
}

describe('IpCoreToolbar issue totals', () => {
  it('keeps error and warning counts distinct and opens Issues', () => {
    const onOpenIssues = jest.fn();
    render(<IpCoreToolbar {...props({ onOpenIssues })} />);
    const button = screen.getByRole('button', { name: '2 errors, 3 warnings' });
    fireEvent.click(button);
    expect(onOpenIssues).toHaveBeenCalledTimes(1);
  });
});
