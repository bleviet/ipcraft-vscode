import React, { useEffect, useRef } from 'react';
import type { IssueFocusRequest } from '../../../../types/issues';
import type { BusContractEditModel } from '../../../../hooks/useBusContractEditor';
import { PropCheckbox, PropField, PropWidthField, Section } from '../controls/InspectorFields';

interface BusContractFieldsProps {
  busIndex: number;
  model: BusContractEditModel;
  paramNames: string[];
  paramValues: Record<string, number>;
  focusRequest?: IssueFocusRequest | null;
  onRootWidthChange: (name: string, value: number | string) => void;
  onPropertyChange: (name: string, value: number | string | boolean) => void;
}

const fieldId = (busIndex: number, kind: 'width' | 'property', name: string): string =>
  `bus-${busIndex}-${kind}-${name}`;

export const BusContractFields: React.FC<BusContractFieldsProps> = ({
  busIndex,
  model,
  paramNames,
  paramValues,
  focusRequest,
  onRootWidthChange,
  onPropertyChange,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const [, targetIndex, section, name] = focusRequest?.path ?? [];
    if (targetIndex !== busIndex || typeof name !== 'string') {
      return;
    }
    const kind = section === 'interfaceProperties' ? 'property' : 'width';
    const wrapper = rootRef.current?.querySelector<HTMLElement>(
      `#${fieldId(busIndex, kind, name)}`
    );
    const control = wrapper?.querySelector<HTMLElement>('input, select, button');
    const target = control ?? wrapper;
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [busIndex, focusRequest]);

  return (
    <div ref={rootRef}>
      {model.rootWidths.length > 0 && (
        <Section title="Contract Widths">
          {model.rootWidths.map((field) => (
            <div id={fieldId(busIndex, 'width', field.name)} key={field.name}>
              <PropWidthField
                label={field.name}
                value={(field.value as number | string | undefined) ?? 1}
                paramNames={paramNames}
                paramValues={paramValues}
                onSave={(value) => onRootWidthChange(field.name, value)}
              />
              {field.error && <div className="ci-field__error">{field.error}</div>}
            </div>
          ))}
          {model.derivedWidths.map((field) => (
            <div
              id={fieldId(busIndex, 'width', field.name)}
              className="ci-field"
              key={field.name}
              tabIndex={-1}
            >
              <label className="ci-field__label">{field.name}</label>
              <div className="ci-field__hint">
                {field.formula}
                {field.resolvedValue !== undefined
                  ? ` = ${field.resolvedValue}`
                  : ` (${field.state})`}
              </div>
            </div>
          ))}
        </Section>
      )}
      {model.properties.length > 0 && (
        <Section title="Interface Properties">
          {model.properties.map((field) => (
            <div id={fieldId(busIndex, 'property', field.name)} key={field.name}>
              {typeof field.value === 'boolean' ? (
                <PropCheckbox
                  label={field.name}
                  checked={field.value}
                  onChange={(value) => onPropertyChange(field.name, value)}
                />
              ) : (
                <PropField
                  label={field.name}
                  value={field.value === undefined ? '' : String(field.value)}
                  onSave={(raw) => {
                    const number = Number(raw);
                    onPropertyChange(
                      field.name,
                      raw.trim() !== '' && Number.isFinite(number) ? number : raw
                    );
                  }}
                  hasError={Boolean(field.error)}
                  errorMsg={field.error}
                  mono
                />
              )}
            </div>
          ))}
        </Section>
      )}
      {model.fixedWidths.length > 0 && (
        <details className="ci-section">
          <summary className="ci-section__title">Fixed Contract Widths</summary>
          {model.fixedWidths.map((field) => (
            <div
              id={fieldId(busIndex, 'width', field.name)}
              className="ci-field"
              key={field.name}
              tabIndex={-1}
            >
              <span className="ci-field__label">{field.name}</span>
              <span className="ci-field__hint">
                {field.formula} = {field.resolvedValue ?? field.state}
              </span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
};
