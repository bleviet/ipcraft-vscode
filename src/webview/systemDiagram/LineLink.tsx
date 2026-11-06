import React from 'react';
import type { LevelSource } from './sourceFile';

interface LineLinkProps {
  source: LevelSource;
  line: number;
  onReveal: (line: number, uri?: string) => void;
}

/** A `file:line` link that opens the script at that line. */
export function LineLink({ source, line, onReveal }: LineLinkProps) {
  const base = source.fileName.split('/').pop() ?? source.fileName;
  return (
    <button
      type="button"
      className="sd-link"
      title={`Open ${source.fileName} at line ${line}`}
      onClick={() => onReveal(line, source.uri)}
    >
      {base}:{line}
    </button>
  );
}
