import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OutlineTree } from '../../../../webview/systemDiagram/OutlineTree';
import { archGraph } from './archGraph';

const graph = archGraph();
const pills = () => screen.getByRole('group', { name: 'Outline filter' });

function renderOutline() {
  render(
    <OutlineTree
      graph={graph}
      levelPath="/"
      selection={null}
      review={null}
      clocks={null}
      onSelect={jest.fn()}
    />
  );
}

const pill = (name: string) => screen.getByRole('button', { name });

describe('the outline kind filter', () => {
  beforeEach(renderOutline);

  it('offers All, Subsystems, IP / RTL and Ports, All pressed', () => {
    for (const name of ['All', 'Subsystems', 'IP / RTL', 'Ports']) {
      expect(pills()).toContainElement(pill(name));
    }
    expect(pill('All')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('External ports')).toBeInTheDocument();
  });

  it('keeps only the hierarchy blocks for Subsystems', () => {
    fireEvent.click(pill('Subsystems'));
    expect(pill('Subsystems')).toHaveAttribute('aria-pressed', 'true');
    expect(pill('All')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(screen.queryByText('src')).toBeNull();
    expect(screen.queryByText('External ports')).toBeNull();
  });

  it('keeps the other blocks for IP / RTL, with the hierarchy above the inner ones', () => {
    fireEvent.click(pill('IP / RTL'));
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('dst')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(screen.getByText('lone')).toBeInTheDocument();
    expect(screen.queryByText('External ports')).toBeNull();
  });

  it('keeps only the external ports for Ports, and everything again for All', () => {
    fireEvent.click(pill('Ports'));
    expect(screen.getByText('External ports')).toBeInTheDocument();
    expect(screen.queryByText('src')).toBeNull();
    expect(screen.queryByText('sub')).toBeNull();
    fireEvent.click(pill('All'));
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
  });

  it('opens the kept rows without toggles while a filter is on, and restores them on All', () => {
    expect(screen.getAllByRole('button', { name: /^(Collapse|Expand) / }).length).toBeGreaterThan(
      0
    );
    fireEvent.click(pill('IP / RTL'));
    expect(screen.queryAllByRole('button', { name: /^(Collapse|Expand) / })).toHaveLength(0);
    expect(screen.getByText('lone')).toBeInTheDocument();
    fireEvent.click(pill('All'));
    expect(screen.getAllByRole('button', { name: /^(Collapse|Expand) / }).length).toBeGreaterThan(
      0
    );
  });
});
