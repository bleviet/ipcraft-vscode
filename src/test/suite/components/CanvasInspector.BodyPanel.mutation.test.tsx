/**
 * BodyPanel edits that remove an optional key must go through the REAL IP Core mutation path
 * (`useIpCoreState.updateIpCore` -> `applyYamlMutation`) and still produce schema-valid YAML.
 * `applyYamlMutation` deletes a key only for `undefined`; `null` is written literally and the
 * schema rejects `versionScheme: null` and `subcores: null`.
 */
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import * as yaml from 'js-yaml';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';
import { useIpCoreState } from '../../../webview/ipcore/hooks/useIpCoreState';
import { YamlValidator } from '../../../services/YamlValidator';

const IP_CORE_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/ip_core.schema.json'
);
const bodySelection: CanvasElement = { kind: 'body', index: 0, id: 'body' };

const NUMERIC_SCHEME_YAML = `vlnv:
  vendor: acme
  library: user
  name: my_core
  version: "1.0.0"
  versionScheme: major.minor.patch
subcores:
  - acme:user:child:1.0.0
`;

function Harness({ state }: { state: ReturnType<typeof useIpCoreState> }) {
  return (
    <CanvasInspector
      selected={bodySelection}
      ipCore={state.ipCore as unknown as IpCore}
      onUpdate={state.updateIpCore}
      onClose={jest.fn()}
    />
  );
}

function renderWithRealState() {
  const hook = renderHook(() => useIpCoreState());
  act(() => hook.result.current.updateFromYaml(NUMERIC_SCHEME_YAML, 'my_core.ip.yml'));
  const ui = render(<Harness state={hook.result.current} />);
  const rerender = () => ui.rerender(<Harness state={hook.result.current} />);
  return { hook, rerender };
}

function expectSchemaValid(rawYaml: string): Record<string, unknown> {
  const parsed = yaml.load(rawYaml) as Record<string, unknown>;
  const result = new YamlValidator().validateAgainstSchema(parsed, IP_CORE_SCHEMA_PATH);
  expect(result).toEqual({ valid: true });
  return parsed;
}

describe('CanvasInspector BodyPanel - optional key removal through the real mutation path', () => {
  it('starts from schema-valid YAML with a numeric scheme', () => {
    const { hook } = renderWithRealState();
    const parsed = expectSchemaValid(hook.result.current.rawYaml);
    expect((parsed.vlnv as Record<string, unknown>).versionScheme).toBe('major.minor.patch');
  });

  it('choosing Free text removes vlnv.versionScheme and the YAML stays schema-valid', () => {
    const { hook, rerender } = renderWithRealState();

    fireEvent.change(screen.getByLabelText('Version scheme'), { target: { value: 'free' } });
    rerender();

    const rawYaml = hook.result.current.rawYaml;
    expect(rawYaml).not.toContain('versionScheme');
    const parsed = expectSchemaValid(rawYaml);
    expect(Object.keys(parsed.vlnv as object)).not.toContain('versionScheme');
    expect(screen.getByLabelText('Version scheme')).toHaveValue('free');
  });

  it('removing the last dependency removes subcores and the YAML stays schema-valid', () => {
    const { hook } = renderWithRealState();

    fireEvent.click(screen.getByTitle('Remove acme:user:child:1.0.0'));

    const rawYaml = hook.result.current.rawYaml;
    expect(rawYaml).not.toContain('subcores');
    expectSchemaValid(rawYaml);
  });
});
