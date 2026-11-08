import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExportImageButton } from '../../../../webview/shared/components/ExportImageButton';
import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportImageOptions,
} from '../../../../shared/messages/imageExport';

function setup(
  options: ExportImageOptions = DEFAULT_EXPORT_OPTIONS,
  features = { legend: true, wholeLabel: 'Whole level' }
) {
  const onOptionsChange = jest.fn();
  const onExport = jest.fn();
  const view = render(
    <ExportImageButton
      options={options}
      features={features}
      onOptionsChange={onOptionsChange}
      onExport={onExport}
    />
  );
  const button = screen.getByRole('button', { name: 'Export image' });
  return { ...view, button, onOptionsChange, onExport };
}

describe('ExportImageButton', () => {
  it('opens a popover with every option of the system viewer', () => {
    const { button } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    for (const label of ['Format', 'Area', 'Scale', 'Theme', 'Grid', 'Legend', 'Background']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('option', { name: 'Whole level' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Format'));
  });

  it('has no Legend for the IP core editor and calls the full drawing the whole diagram', () => {
    const { button } = setup(DEFAULT_EXPORT_OPTIONS, {
      legend: false,
      wholeLabel: 'Whole diagram',
    });
    fireEvent.click(button);
    expect(screen.queryByLabelText('Legend')).toBeNull();
    expect(screen.getByRole('option', { name: 'Whole diagram' })).toBeTruthy();
  });

  it('disables the background for JPG and the scale for SVG', () => {
    const { button, rerender, onOptionsChange, onExport } = setup({
      ...DEFAULT_EXPORT_OPTIONS,
      format: 'jpg',
    });
    fireEvent.click(button);
    expect(screen.getByLabelText('Background')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Scale')).toHaveProperty('disabled', false);

    rerender(
      <ExportImageButton
        options={{ ...DEFAULT_EXPORT_OPTIONS, format: 'svg' }}
        features={{ legend: true, wholeLabel: 'Whole level' }}
        onOptionsChange={onOptionsChange}
        onExport={onExport}
      />
    );
    expect(screen.getByLabelText('Scale')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Background')).toHaveProperty('disabled', false);
  });

  it('turns a transparent background opaque when JPG is chosen', () => {
    const { button, onOptionsChange } = setup({
      ...DEFAULT_EXPORT_OPTIONS,
      background: 'transparent',
    });
    fireEvent.click(button);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'jpg' } });
    expect(onOptionsChange).toHaveBeenCalledWith({
      ...DEFAULT_EXPORT_OPTIONS,
      format: 'jpg',
      background: 'editor',
    });
  });

  it('reports each changed option', () => {
    const { button, onOptionsChange } = setup();
    fireEvent.click(button);
    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: '4' } });
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_EXPORT_OPTIONS, scale: 4 });
    fireEvent.click(screen.getByLabelText('Grid'));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_EXPORT_OPTIONS, grid: false });
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: 'whole' } });
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_EXPORT_OPTIONS, area: 'whole' });
  });

  it('exports with the chosen options, closes and returns focus to the button', () => {
    const { button, onExport } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledWith(DEFAULT_EXPORT_OPTIONS);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape and returns focus to the button', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText('Theme'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on a click outside', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens when the command raises the open token', () => {
    const { rerender, onOptionsChange, onExport } = setup();
    rerender(
      <ExportImageButton
        options={DEFAULT_EXPORT_OPTIONS}
        features={{ legend: true, wholeLabel: 'Whole level' }}
        onOptionsChange={onOptionsChange}
        onExport={onExport}
        openToken={1}
      />
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
