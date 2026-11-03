import React from 'react';

interface LineLinkProps {
  fileName: string;
  line: number;
  onReveal: (line: number) => void;
}

/** A `file:line` link that opens the script at that line. */
export function LineLink({ fileName, line, onReveal }: LineLinkProps) {
  const base = fileName.split('/').pop() ?? fileName;
  return (
    <button
      type="button"
      className="sd-link"
      title={`Open ${fileName} at line ${line}`}
      onClick={() => onReveal(line)}
    >
      {base}:{line}
    </button>
  );
}
