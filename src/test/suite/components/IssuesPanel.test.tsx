import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { IpcraftIssue } from '../../../shared/issues';
import { IssuesPanel } from '../../../webview/ipcore/components/canvas/IssuesPanel';

describe('IssuesPanel', () => {
  it('groups issues in actionable source order and selects rows', () => {
    const issues: IpcraftIssue[] = [
      { code: 'H', severity: 'warning', source: 'hdl', path: ['ports'], message: 'HDL drift' },
      {
        code: 'P',
        severity: 'error',
        source: 'protocol',
        path: ['busInterfaces', 0],
        message: 'Bad bus',
      },
      { code: 'S', severity: 'error', source: 'schema', path: [], message: 'Bad schema' },
      { code: 'V', severity: 'warning', source: 'componentXml', path: [], message: 'Vendor drift' },
      { code: 'R', severity: 'error', source: 'references', path: [], message: 'Bad reference' },
    ];
    const onSelect = jest.fn();
    render(<IssuesPanel issues={issues} onSelect={onSelect} onClose={jest.fn()} />);

    const labels = screen
      .getAllByText(/Schema|Protocol|References|HDL consistency|Vendor artifact consistency/)
      .map((node) => node.textContent);
    expect(labels).toEqual([
      'Schema',
      'Protocol',
      'References',
      'HDL consistency',
      'Vendor artifact consistency',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Bad bus/ }));
    expect(onSelect).toHaveBeenCalledWith(issues[1]);
  });
});
