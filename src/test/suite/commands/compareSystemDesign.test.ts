import * as vscode from 'vscode';
import { compareSystemDesignCommand } from '../../../commands/compareSystemDesign';

describe('compareSystemDesignCommand', () => {
  it('asks the provider to compare and says nothing when a diagram is active', () => {
    const compareActive = jest.fn(() => true);
    expect(compareSystemDesignCommand(compareActive)()).toBe(true);
    expect(compareActive).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('tells the user to open a system design when no diagram is active', () => {
    expect(compareSystemDesignCommand(() => false)()).toBe(false);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Open a system design as a diagram to compare it with another revision.'
    );
  });
});
