import * as vscode from 'vscode';
import { attachResourceReportCommand } from '../../../commands/attachResourceReport';

describe('attachResourceReportCommand', () => {
  it('asks the provider to attach and says nothing when a diagram is active', () => {
    const attachActive = jest.fn(() => true);
    expect(attachResourceReportCommand(attachActive)()).toBe(true);
    expect(attachActive).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('tells the user to open a system design when no diagram is active', () => {
    expect(attachResourceReportCommand(() => false)()).toBe(false);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Open a system design as a diagram to attach a resource report to it.'
    );
  });
});
