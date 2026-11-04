import React from 'react';
import type { DiagramProblem } from './messageState';

function bannerText(problem: DiagramProblem): string {
  return problem.kind === 'error'
    ? `The design could not be read: ${problem.message.replace(/\.+$/, '')}. Showing the last valid version.`
    : 'This file is no longer recognized as a Vivado block design script. Showing the last valid version.';
}

/** Non-blocking notice that the latest edit could not be read. */
export function ProblemBanner({ problem }: { problem: DiagramProblem }) {
  return (
    <div
      role="status"
      className="px-3 py-1"
      style={{
        color: 'var(--vscode-foreground)',
        background:
          'var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background))',
        borderBottom:
          '1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground))',
      }}
    >
      {bannerText(problem)}
    </div>
  );
}
