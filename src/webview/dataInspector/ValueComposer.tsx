import React from 'react';
import type { ValueInputState } from './hooks/useValueInput';

const VALUE_EXAMPLES = [
  { label: 'Known hex', literal: '0xDEAD_BEEF' },
  { label: 'Unknown states', literal: '0b0000_XXXX_0011_ZZZZ' },
  { label: 'Decimal', literal: '305419896' },
] as const;

interface ValueComposerProps {
  mobileActive: boolean;
  onDecoded: () => void;
  recipeError: string;
  valueInput: ValueInputState;
}

export function ValueComposer({
  mobileActive,
  onDecoded,
  recipeError,
  valueInput,
}: ValueComposerProps) {
  const parseDraft = () => {
    if (valueInput.parseValue(valueInput.draft)) {
      onDecoded();
    }
  };

  return (
    <section
      className={`di-composer di-mobile-panel ${mobileActive ? 'is-mobile-active' : ''}`}
      aria-labelledby="value-heading"
    >
      <div className="di-composer__title">
        <span className="di-step">1</span>
        <div>
          <span className="di-eyebrow">Paste any value</span>
          <h2 id="value-heading">Value composer</h2>
        </div>
      </div>
      <div className="di-input-row">
        <label className="di-value-input">
          <span>Literal</span>
          <input
            value={valueInput.draft}
            placeholder="0x0001_2000_0000_3F00"
            spellCheck={false}
            onChange={(event) => valueInput.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                parseDraft();
              }
            }}
          />
        </label>
        <label className="di-width-input">
          <span>Width</span>
          <input
            type="number"
            min={1}
            max={4096}
            value={valueInput.widthDraft}
            placeholder="auto"
            onChange={(event) => valueInput.setWidthDraft(event.target.value)}
          />
        </label>
        <button className="di-primary" onClick={parseDraft}>
          Decode
        </button>
        <button onClick={valueInput.clearValue}>Clear</button>
      </div>
      <div className="di-examples" aria-label="Example values">
        <span>Try an example</span>
        {VALUE_EXAMPLES.map((example) => (
          <button
            key={example.label}
            onClick={() => {
              valueInput.setDraft(example.literal);
              valueInput.setWidthDraft('');
              if (valueInput.parseValue(example.literal, '')) {
                onDecoded();
              }
            }}
          >
            <strong>{example.label}</strong>
            <code>{example.literal}</code>
          </button>
        ))}
      </div>
      {valueInput.error && <div className="di-message is-error">{valueInput.error}</div>}
      {recipeError && <div className="di-message is-error">{recipeError}</div>}
      {valueInput.warnings.map((warning) => (
        <div className="di-message is-warning" key={warning}>
          {warning}
        </div>
      ))}
    </section>
  );
}
