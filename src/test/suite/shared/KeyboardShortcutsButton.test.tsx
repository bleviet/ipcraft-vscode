import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsButton } from '../../../webview/shared/components/KeyboardShortcutsButton';

describe('KeyboardShortcutsButton', () => {
  it('renders button with keyboard icon', () => {
    render(<KeyboardShortcutsButton context="memoryMap" />);
    const button = screen.getByTitle(/Keyboard Shortcuts/i);
    expect(button).toBeInTheDocument();
  });

  it('opens modal when clicked', () => {
    render(<KeyboardShortcutsButton context="memoryMap" />);
    const button = screen.getByTitle(/Keyboard Shortcuts/i);

    fireEvent.click(button);
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Address Map Visualizer')).toBeInTheDocument();
  });

  it('closes modal when X button is clicked', () => {
    render(<KeyboardShortcutsButton context="memoryMap" />);
    const button = screen.getByTitle(/Keyboard Shortcuts/i);

    fireEvent.click(button);
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();

    const closeButton = screen.getByText('✕');
    fireEvent.click(closeButton);

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('opens modal when "?" key is pressed', () => {
    render(<KeyboardShortcutsButton context="memoryMap" />);
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('closes modal when Escape key is pressed', () => {
    render(<KeyboardShortcutsButton context="memoryMap" />);
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('does not open modal when typing "?" in an input', () => {
    render(
      <>
        <KeyboardShortcutsButton context="memoryMap" />
        <input data-testid="test-input" />
      </>
    );
    const input = screen.getByTestId('test-input');
    fireEvent.keyDown(input, { key: '?' });
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('renders correct shortcuts for memoryMap context', () => {
    render(<KeyboardShortcutsButton context="memoryMap" />);
    fireEvent.click(screen.getByTitle(/Keyboard Shortcuts/i));

    expect(screen.getByText('Address Map Visualizer')).toBeInTheDocument();
    expect(screen.getByText('Blocks Table')).toBeInTheDocument();
    expect(screen.queryByText('Bit Field Visualizer')).not.toBeInTheDocument();
  });

  it('renders correct shortcuts for register context', () => {
    render(<KeyboardShortcutsButton context="register" />);
    fireEvent.click(screen.getByTitle(/Keyboard Shortcuts/i));

    expect(screen.getByText('Bit Field Visualizer')).toBeInTheDocument();
    expect(screen.getByText('Fields Table')).toBeInTheDocument();
    expect(screen.queryByText('Address Map Visualizer')).not.toBeInTheDocument();
  });
});
