import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DiagramContextMenu,
  type ContextMenuItem,
} from '../../../../webview/systemDiagram/DiagramContextMenu';

function renderMenu(items: ContextMenuItem[], onClose = jest.fn()) {
  render(
    <>
      <button type="button">opener</button>
      <DiagramContextMenu
        x={5}
        y={5}
        canvasWidth={400}
        canvasHeight={300}
        items={items}
        onClose={onClose}
      />
    </>
  );
  return { menu: screen.getByRole('menu'), onClose };
}

const items = (): ContextMenuItem[] => [
  { label: 'First', onSelect: jest.fn() },
  { label: 'Middle', disabled: true, onSelect: jest.fn() },
  { label: 'Last', onSelect: jest.fn() },
];
const activeId = (menu: HTMLElement) => menu.getAttribute('aria-activedescendant');
const idOf = (name: string) => screen.getByRole('menuitem', { name }).id;

describe('DiagramContextMenu', () => {
  it('announces the active item and skips disabled ones', () => {
    const { menu } = renderMenu(items());
    expect(activeId(menu)).toBe(idOf('First'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(activeId(menu)).toBe(idOf('Last'));
  });

  it('jumps to the first and last enabled item with Home and End', () => {
    const { menu } = renderMenu(items());
    fireEvent.keyDown(menu, { key: 'End' });
    expect(activeId(menu)).toBe(idOf('Last'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(activeId(menu)).toBe(idOf('First'));
  });

  it('activates with Space and closes first', () => {
    const list = items();
    const { menu, onClose } = renderMenu(list);
    fireEvent.keyDown(menu, { key: ' ' });
    expect(onClose).toHaveBeenCalled();
    expect(list[0].onSelect).toHaveBeenCalled();
  });

  it('has no active item when every item is disabled', () => {
    const { menu } = renderMenu([{ label: 'Only', disabled: true, onSelect: jest.fn() }]);
    expect(activeId(menu)).toBeNull();
    expect(document.querySelector('.sd-menu-item-active')).toBeNull();
    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(activeId(menu)).toBeNull();
  });

  it('closes on Escape, Tab and when focus leaves', () => {
    const first = renderMenu(items());
    fireEvent.keyDown(first.menu, { key: 'Escape' });
    expect(first.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(first.menu, { key: 'Tab' });
    expect(first.onClose).toHaveBeenCalledTimes(2);
    fireEvent.blur(first.menu, { relatedTarget: screen.getByText('opener') });
    expect(first.onClose).toHaveBeenCalledTimes(3);
  });

  it('focuses the menu and gives focus back to the opener when it unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <DiagramContextMenu
        x={0}
        y={0}
        canvasWidth={400}
        canvasHeight={300}
        items={items()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole('menu')).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
