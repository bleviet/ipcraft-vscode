import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WidthField } from '../../../webview/shared/components/WidthField';
import { WIDTH_FUNCTION_HELP } from '../../../webview/shared/utils/widthFunctionHelp';

const TOGGLE_TO_EXPR_TITLE = 'Use a parameter or expression as width';
const INFO_TITLE = 'Show width expression functions';

function WidthFieldHarness({
  initialValue,
  onChange,
  onSave,
}: {
  initialValue: number | string;
  onChange: (value: number | string) => void;
  onSave: () => void;
}) {
  const [value, setValue] = useState<number | string>(initialValue);
  return (
    <WidthField
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      onSave={onSave}
    />
  );
}

describe('WidthField help menu', () => {
  it('does not render the info icon in number mode', () => {
    render(<WidthFieldHarness initialValue={8} onChange={jest.fn()} onSave={jest.fn()} />);

    expect(screen.queryByTitle(INFO_TITLE)).not.toBeInTheDocument();
  });

  it('shows the info icon after switching to expression mode and opens a popover listing all functions', () => {
    render(<WidthFieldHarness initialValue={8} onChange={jest.fn()} onSave={jest.fn()} />);

    fireEvent.click(screen.getByTitle(TOGGLE_TO_EXPR_TITLE));
    expect(screen.getByTitle(INFO_TITLE)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(INFO_TITLE));

    for (const name of Object.keys(WIDTH_FUNCTION_HELP) as Array<
      keyof typeof WIDTH_FUNCTION_HELP
    >) {
      expect(screen.getByText(WIDTH_FUNCTION_HELP[name].signature)).toBeInTheDocument();
    }
  });

  it('closes the popover on Escape', () => {
    render(<WidthFieldHarness initialValue={8} onChange={jest.fn()} onSave={jest.fn()} />);

    fireEvent.click(screen.getByTitle(TOGGLE_TO_EXPR_TITLE));
    fireEvent.click(screen.getByTitle(INFO_TITLE));
    expect(screen.getByText(WIDTH_FUNCTION_HELP.clog2.signature)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText(WIDTH_FUNCTION_HELP.clog2.signature)).not.toBeInTheDocument();
  });

  it('closes the popover on an outside click', () => {
    render(<WidthFieldHarness initialValue={8} onChange={jest.fn()} onSave={jest.fn()} />);

    fireEvent.click(screen.getByTitle(TOGGLE_TO_EXPR_TITLE));
    fireEvent.click(screen.getByTitle(INFO_TITLE));
    expect(screen.getByText(WIDTH_FUNCTION_HELP.clog2.signature)).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText(WIDTH_FUNCTION_HELP.clog2.signature)).not.toBeInTheDocument();
  });

  it('does not alter the committed value when opening or closing the popover', () => {
    const onChange = jest.fn();
    const onSave = jest.fn();
    render(<WidthFieldHarness initialValue={8} onChange={onChange} onSave={onSave} />);

    fireEvent.click(screen.getByTitle(TOGGLE_TO_EXPR_TITLE));
    onChange.mockClear();
    onSave.mockClear();

    fireEvent.click(screen.getByTitle(INFO_TITLE));
    expect(screen.getByText(WIDTH_FUNCTION_HELP.clog2.signature)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(WIDTH_FUNCTION_HELP.clog2.signature)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
