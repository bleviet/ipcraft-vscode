import React, { useEffect, useState } from 'react';

interface SourceWidthInputProps {
  width: number;
  onChange: (width: number) => void;
}

export function SourceWidthInput({ width, onChange }: SourceWidthInputProps) {
  const [draft, setDraft] = useState(String(width));

  useEffect(() => {
    setDraft(String(width));
  }, [width]);

  return (
    <input
      type="number"
      min={1}
      max={4096}
      value={draft}
      onBlur={() => setDraft(String(width))}
      onChange={(event) => {
        const nextDraft = event.target.value;
        const nextWidth = Number(nextDraft);
        setDraft(nextDraft);
        if (
          nextDraft !== '' &&
          Number.isInteger(nextWidth) &&
          nextWidth >= 1 &&
          nextWidth <= 4096
        ) {
          onChange(nextWidth);
        }
      }}
    />
  );
}
