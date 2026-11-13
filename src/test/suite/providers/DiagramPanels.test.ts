import type * as vscode from 'vscode';
import { DiagramPanels } from '../../../providers/systemDiagram/DiagramPanels';

describe('DiagramPanels', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps one timer when a request is told to expire twice', () => {
    jest.useFakeTimers();
    const panels = new DiagramPanels();
    const requester = {} as vscode.WebviewPanel;
    panels.request('file:///b.bd', { text: 't', label: 'a.bd' }, requester);
    panels.expireLater('file:///b.bd', requester);
    panels.expireLater('file:///b.bd', requester);
    expect(jest.getTimerCount()).toBe(1);
    panels.take('file:///b.bd');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the timer of a request that a newer request for the same URI replaces', () => {
    jest.useFakeTimers();
    const panels = new DiagramPanels();
    const requester = {} as vscode.WebviewPanel;
    panels.request('file:///b.bd', { text: 'old', label: 'a.bd' }, requester);
    panels.expireLater('file:///b.bd', requester);
    panels.request('file:///b.bd', { text: 'new', label: 'a.bd' }, requester);
    expect(jest.getTimerCount()).toBe(0);
    expect(panels.take('file:///b.bd')?.text).toBe('new');
  });
});
