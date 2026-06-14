/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import React, { useState } from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { VectorBoundingInput } from '../../../webview/shared/components/VectorBoundingInput';

function TestWrapper({ initialValue = '[15:8]', registerSize = 32, maxWidth = 32 }) {
  const [val, setVal] = useState(initialValue);
  return (
    <VectorBoundingInput
      editKey="bits"
      value={val}
      registerSize={registerSize}
      maxWidth={maxWidth}
      onInput={setVal}
    />
  );
}

describe('VectorBoundingInput', () => {
  it('renders MSB and LSB fields correctly from bits value', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    const lsbInput = screen.getByPlaceholderText('LSB') as HTMLInputElement;

    expect(msbInput.value).toBe('15');
    expect(lsbInput.value).toBe('8');
    expect(msbInput.getAttribute('data-edit-key')).toBe('bits');
    expect(msbInput.parentElement?.getAttribute('data-edit-key')).toBeNull();
  });

  it('updates input values and propagates to onInput', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    fireEvent.change(msbInput, { target: { value: '12' } });

    expect(onInput).toHaveBeenLastCalledWith('[12:8]');
  });

  it('blocks non-numeric keys', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
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
      <VectorBoundingInput
        editKey="bits"
        value="[5:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const container = screen.getByPlaceholderText('MSB').parentElement!;
    fireEvent.blur(container, { relatedTarget: null });

    expect(onInput).toHaveBeenLastCalledWith('[8:5]');
  });

  it('clamps values on blur to registerSize-1', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[45:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const container = screen.getByPlaceholderText('MSB').parentElement!;
    fireEvent.blur(container, { relatedTarget: null });

    expect(onInput).toHaveBeenLastCalledWith('[31:8]');
  });

  it('clamps values during typing to respect maxWidth', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[7:0]"
        registerSize={32}
        maxWidth={8}
        onInput={onInput}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    fireEvent.change(msbInput, { target: { value: '12' } });

    expect(onInput).toHaveBeenLastCalledWith('[7:0]');
  });

  it('clamps values during typing to respect registerSize-1 (maxBit)', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    fireEvent.change(msbInput, { target: { value: '45' } });

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
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
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

  it('clears one field mid-edit producing partial placeholder format', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    fireEvent.change(msbInput, { target: { value: '' } });

    expect(onInput).toHaveBeenLastCalledWith('[?:8]');
  });

  it('does not trigger onBlur when focus shifts between MSB and LSB fields (compound blur)', () => {
    const onBlur = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={jest.fn()}
        onBlur={onBlur}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    const lsbInput = screen.getByPlaceholderText('LSB') as HTMLInputElement;

    // Focus MSB
    fireEvent.focus(msbInput);
    // Focus LSB (representing a tab/shift within container)
    fireEvent.blur(msbInput, { relatedTarget: lsbInput });
    fireEvent.focus(lsbInput);

    expect(onBlur).not.toHaveBeenCalled();
  });

  it('correctly handles placeholder state [?:?]', () => {
    const onInput = jest.fn();
    const onBlur = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[?:?]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
        onBlur={onBlur}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    const lsbInput = screen.getByPlaceholderText('LSB') as HTMLInputElement;

    expect(msbInput.value).toBe('');
    expect(lsbInput.value).toBe('');

    // Change one field
    fireEvent.change(lsbInput, { target: { value: '4' } });
    expect(onInput).toHaveBeenLastCalledWith('[?:4]');

    // Blur container to commit
    const container = msbInput.parentElement!;
    fireEvent.blur(container, { relatedTarget: null });

    // Since LSB is 4, MSB defaults to LSB (4) -> [4:4] -> single-bit [4]
    expect(onBlur).toHaveBeenLastCalledWith('[4]');
  });

  it('skips onBlur commit if cancelEditRef.current is true', () => {
    const onBlur = jest.fn();
    const cancelEditRef = { current: true };
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={jest.fn()}
        onBlur={onBlur}
        cancelEditRef={cancelEditRef}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    fireEvent.change(msbInput, { target: { value: '20' } });

    const container = msbInput.parentElement!;
    fireEvent.blur(container, { relatedTarget: null });

    expect(onBlur).not.toHaveBeenCalled();
  });

  it('defaults to partner field value during ArrowUp/Down adjustments on empty fields', () => {
    render(<TestWrapper initialValue="[?:8]" />);

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;
    expect(msbInput.value).toBe('');

    // ArrowUp on empty MSB should default currentVal to LSB (8) and increment to 9
    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      msbInput.dispatchEvent(upEvent);
    });
    expect(msbInput.value).toBe('9');
  });

  it('commits onInput immediately on each step', () => {
    const onInput = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    const step = () => {
      const upEvent = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        msbInput.dispatchEvent(upEvent);
      });
    };

    step();
    step();
    step();

    // Each step fires onInput immediately.
    expect(msbInput.value).toBe('18');
    expect(onInput).toHaveBeenCalledTimes(3);
    expect(onInput).toHaveBeenLastCalledWith('[18:8]');
  });

  it('step fires onInput immediately and blur commits the final stepped value', () => {
    const onInput = jest.fn();
    const onBlur = jest.fn();
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[15:8]"
        registerSize={32}
        maxWidth={32}
        onInput={onInput}
        onBlur={onBlur}
      />
    );

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      msbInput.dispatchEvent(upEvent);
    });
    // Step fires onInput immediately.
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenLastCalledWith('[16:8]');

    const container = msbInput.parentElement!;
    act(() => {
      fireEvent.blur(container, { relatedTarget: null });
    });

    // Blur commits the value via onInput + onBlur.
    expect(onBlur).toHaveBeenCalledWith('[16:8]');
  });

  it('stepping MSB down never inverts below LSB', () => {
    render(<TestWrapper initialValue="[8:8]" />);

    const msbInput = screen.getByPlaceholderText('MSB') as HTMLInputElement;

    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      msbInput.dispatchEvent(downEvent);
    });

    // MSB cannot drop below LSB (8); it stays clamped at 8.
    expect(msbInput.value).toBe('8');
  });

  it('LSB cannot step below minBit (lower neighbor boundary)', () => {
    // CONTROL register scenario: STOP_ON_ERR [1:1] with RUN [0:0] as lower neighbor.
    // minBit=1 means LSB can never step below 1, preventing overlap with RUN.
    render(
      <VectorBoundingInput
        editKey="bits"
        value="[1:1]"
        registerSize={32}
        maxWidth={31}
        minBit={1}
        onInput={jest.fn()}
      />
    );

    const lsbInput = screen.getByPlaceholderText('LSB') as HTMLInputElement;

    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      lsbInput.dispatchEvent(downEvent);
    });

    // LSB must stay at 1; stepping into bit 0 (RUN's territory) is blocked.
    expect(lsbInput.value).toBe('1');
  });
});
