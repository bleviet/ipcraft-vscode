/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import React, { useState } from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { VectorBoundingInput } from '../../../webview/shared/components/VectorBoundingInput';

function TestWrapper({ initialValue = '[15:8]', registerSize = 32 }) {
  const [val, setVal] = useState(initialValue);
  return (
    <VectorBoundingInput editKey="bits" value={val} registerSize={registerSize} onInput={setVal} />
  );
}

describe('VectorBoundingInput', () => {
  it('renders MSB and LSB fields correctly from bits value', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput editKey="bits" value="[15:8]" registerSize={32} onInput={onInput} />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    const lsbInput = screen.getByPlaceholderText('LSB') as HTMLInputElement;

    expect(msbInput.value).toBe('15');
    expect(lsbInput.value).toBe('8');
  });

  it('updates input values and propagates to onInput', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput editKey="bits" value="[15:8]" registerSize={32} onInput={onInput} />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    fireEvent.change(msbInput, { target: { value: '12' } });

    expect(onInput).toHaveBeenLastCalledWith('[12:8]');
  });

  it('blocks non-numeric keys', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput editKey="bits" value="[15:8]" registerSize={32} onInput={onInput} />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    const preventDefaultNumeric = jest.fn();
    const numericEvent = new KeyboardEvent('keydown', {
      key: '5',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(numericEvent, 'preventDefault', { value: preventDefaultNumeric });
    msbInput.dispatchEvent(numericEvent);
    expect(preventDefaultNumeric).not.toHaveBeenCalled();

    const preventDefaultAlpha = jest.fn();
    const alphaEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    Object.defineProperty(alphaEvent, 'preventDefault', { value: preventDefaultAlpha });
    msbInput.dispatchEvent(alphaEvent);
    expect(preventDefaultAlpha).toHaveBeenCalled();
  });

  it('swaps values on blur if MSB < LSB', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput editKey="bits" value="[5:8]" registerSize={32} onInput={onInput} />
    );

    const container = screen.getByPlaceholderText('MSB').parentElement!;
    fireEvent.blur(container, { relatedTarget: null });

    expect(onInput).toHaveBeenLastCalledWith('[8:5]');
  });

  it('clamps values on blur to registerSize-1', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput editKey="bits" value="[45:8]" registerSize={32} onInput={onInput} />
    );

    const container = screen.getByPlaceholderText('MSB').parentElement!;
    fireEvent.blur(container, { relatedTarget: null });

    expect(onInput).toHaveBeenLastCalledWith('[31:8]');
  });

  it('increments and decrements value on ArrowUp and ArrowDown keys', () => {
    render(<TestWrapper initialValue="[15:8]" />);

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    // ArrowUp on MSB
    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      msbInput.dispatchEvent(upEvent);
    });
    expect(msbInput.value).toBe('16');

    // ArrowDown on MSB
    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      msbInput.dispatchEvent(downEvent);
    });
    expect(msbInput.value).toBe('15');
  });

  it('prevents default event bubbles on ArrowUp and ArrowDown keys', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput editKey="bits" value="[15:8]" registerSize={32} onInput={onInput} />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    const stopPropagationMock = jest.fn();
    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(upEvent, 'stopPropagation', { value: stopPropagationMock });
    act(() => {
      msbInput.dispatchEvent(upEvent);
    });

    expect(stopPropagationMock).toHaveBeenCalled();
  });

  it('increments and decrements value on mouse wheel scroll and prevents default scroll', () => {
    render(<TestWrapper initialValue="[15:8]" />);

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    // Wheel scroll Up (deltaY < 0)
    const wheelUpEvent = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    const preventDefaultMock = jest.fn();
    Object.defineProperty(wheelUpEvent, 'preventDefault', { value: preventDefaultMock });
    act(() => {
      msbInput.dispatchEvent(wheelUpEvent);
    });

    expect(msbInput.value).toBe('16');
    expect(preventDefaultMock).toHaveBeenCalled();

    // Wheel scroll Down (deltaY > 0)
    const wheelDownEvent = new WheelEvent('wheel', {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultMock2 = jest.fn();
    Object.defineProperty(wheelDownEvent, 'preventDefault', { value: preventDefaultMock2 });
    act(() => {
      msbInput.dispatchEvent(wheelDownEvent);
    });

    expect(msbInput.value).toBe('15');
    expect(preventDefaultMock2).toHaveBeenCalled();
  });
});
