import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupingMappingStep } from '../../../webview/ipcore/components/canvas/GroupingMappingStep';
import type { BusPortDef } from '../../../webview/ipcore/utils/busLibrary';
import type { IpCore } from '../../../webview/types/ipCore';
import type { GroupAsStandardOptions } from '../../../webview/ipcore/hooks/useGroupPorts';

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

  describe('port field metadata', () => {
    const STREAM_DEFS: BusPortDef[] = [
      { name: 'TDATA', width: 8, direction: 'out', presence: 'required', role: 'data' },
      { name: 'TVALID', width: 1, direction: 'out', presence: 'required', role: 'control' },
    ];
    const DATA_FIELDS = [{ name: 'low', bits: '[3:0]' }];
    const VALID_FIELDS = [{ name: 'v', bits: '[0]' }];

    function confirm(
      ports: unknown[],
      extra: { existingPortAssignments?: Record<string, string> } = {}
    ): GroupAsStandardOptions {
      const onConfirm = jest.fn<void, [GroupAsStandardOptions]>();
      render(
        <GroupingMappingStep
          ipCore={{ ports } as unknown as IpCore}
          busType="acme:bus:stream:1.0"
          busLabel="Stream"
          selectedPortIndices={ports.map((_, i) => i)}
          initialPrefix="s_"
          initialMode="slave"
          onConfirm={onConfirm}
          onCancel={jest.fn()}
          busDefs={() => STREAM_DEFS}
          {...extra}
        />
      );
      fireEvent.click(screen.getByText(/Confirm/));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      return onConfirm.mock.calls[0][0];
    }

    const ports = (dataFields?: unknown[], validFields?: unknown[]) => [
      { name: 's_tdata', direction: 'in', width: 8, ...(dataFields ? { fields: dataFields } : {}) },
      {
        name: 's_tvalid',
        direction: 'in',
        width: 1,
        ...(validFields ? { fields: validFields } : {}),
      },
    ];

    it('passes the fields of assigned ports keyed by logical name', () => {
      const opts = confirm(ports(DATA_FIELDS));
      expect(opts.portFields).toEqual({ TDATA: DATA_FIELDS });
    });

    it('passes no portFields option when no assigned port has fields', () => {
      const opts = confirm(ports(undefined, []));
      expect(opts.portFields).toBeUndefined();
    });

    it('lets locked rows of an existing bus contribute nothing', () => {
      const opts = confirm(ports(DATA_FIELDS, VALID_FIELDS), {
        existingPortAssignments: { TDATA: 's_tdata' },
      });
      expect(opts.portFields).toEqual({ TVALID: VALID_FIELDS });
      expect(opts.portIndices).toEqual([1]);
    });
  });
});
