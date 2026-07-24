import type * as vscode from 'vscode';
import { readGenerationIndentation } from '../../../generator/generationSettings';
import { DEFAULT_INDENT_SIZE, DEFAULT_INDENT_STYLE } from '../../../generator/reindent';

/** Minimal stub matching the subset of vscode.WorkspaceConfiguration this module reads. */
function stubConfiguration(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
  return {
    get: jest.fn((key: string, defaultValue: unknown) =>
      key in values ? values[key] : defaultValue
    ),
  } as unknown as vscode.WorkspaceConfiguration;
}

describe('readGenerationIndentation (issue #160)', () => {
  it('returns the configured style/size when present', () => {
    const configuration = stubConfiguration({ indentStyle: 'tab', indentSize: 4 });
    expect(readGenerationIndentation(configuration)).toEqual({ style: 'tab', size: 4 });
  });

  it('falls back to the built-in defaults under style/size keys when unset', () => {
    const configuration = stubConfiguration({});
    expect(readGenerationIndentation(configuration)).toEqual({
      style: DEFAULT_INDENT_STYLE,
      size: DEFAULT_INDENT_SIZE,
    });
  });

  it('returns an object with style/size keys, not indentStyle/indentSize (field-rename regression guard)', () => {
    const configuration = stubConfiguration({ indentStyle: 'tab', indentSize: 4 });
    const result = readGenerationIndentation(configuration);
    expect(result).toHaveProperty('style');
    expect(result).toHaveProperty('size');
    expect(result).not.toHaveProperty('indentStyle');
    expect(result).not.toHaveProperty('indentSize');
  });
});
