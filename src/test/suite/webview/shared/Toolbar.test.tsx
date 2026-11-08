import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ToolbarGroup } from '../../../../webview/shared/components/Toolbar';

describe('ToolbarGroup', () => {
  it('renders a labelled group with its children and caption', () => {
    render(
      <ToolbarGroup label="View">
        <button type="button">Fit</button>
      </ToolbarGroup>
    );
    const group = screen.getByRole('group', { name: 'View' });
    expect(within(group).getByRole('button', { name: 'Fit' })).toBeInTheDocument();
    expect(within(group).getByText('View')).toBeInTheDocument();
  });
});
