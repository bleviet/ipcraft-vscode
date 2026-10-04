import React from 'react';
import { render, screen } from '@testing-library/react';
import { GroupingMappingStep } from '../../../webview/ipcore/components/canvas/GroupingMappingStep';
import type { BusPortDef } from '../../../webview/ipcore/utils/busLibrary';
import type { IpCore } from '../../../webview/types/ipCore';

const PORT_DEFS: BusPortDef[] = [
  {
    name: 'read',
    direction: 'out',
    presence: 'required',
    role: 'control',
    polarity: {
      default: 'activeHigh',
      roles: { activeHigh: 'read', activeLow: 'read_n' },
    },
  },
];

describe('GroupingMappingStep', () => {
  it('aligns the assigned-port and polarity headers with their controls', () => {
    const ipCore: IpCore = {
      ports: [{ name: 'read_n', direction: 'in', width: 1 }],
    } as IpCore;
    render(
      <GroupingMappingStep
        ipCore={ipCore}
        busType="acme:bus:request:1.0"
        busLabel="Request"
        selectedPortIndices={[0]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        busDefs={() => PORT_DEFS}
      />
    );

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Logical', 'Assigned Port', 'Polarity', 'Dir', 'Req']);

    const row = screen.getByText('read').closest('tr');
    const cells = row?.querySelectorAll('td');
    expect(cells?.[1].querySelector('select')?.getAttribute('aria-label')).toBeNull();
    expect(cells?.[2].querySelector('select')?.getAttribute('aria-label')).toBe('read polarity');
  });
});
