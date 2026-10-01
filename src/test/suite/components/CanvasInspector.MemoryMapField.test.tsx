import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const selected: CanvasElement = { kind: 'busInterface', index: 0, id: 'bus:0' };

function avmmCore(memoryMaps: unknown, memoryMapRef = 'REGMAP_CSR'): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'regmap', version: '1.0' },
    busInterfaces: [
      { name: 'S_AVMM', type: 'ipcraft:busif:avalon_mm:1.0', mode: 'slave', memoryMapRef },
    ],
    memoryMaps,
  } as unknown as IpCore;
}

function renderInspector(ipCore: IpCore, onUpdate = jest.fn()) {
  render(
    <CanvasInspector
      selected={selected}
      ipCore={ipCore}
      imports={{ busLibrary: builtinBusLibrary(), memoryMaps: [{ name: 'REGMAP_CSR' }] }}
      onUpdate={onUpdate}
      batchUpdate={jest.fn()}
      onClose={jest.fn()}
    />
  );
  return onUpdate;
}

describe('CanvasInspector MemoryMapField', () => {
  it('shows the file of an array-form map entry', () => {
    renderInspector(avmmCore([{ name: 'REGMAP_CSR', import: 'regmap.mm.yml' }]));

    expect(screen.getByText('regmap.mm.yml')).toBeInTheDocument();
  });

  it('shows the file of an object-form import that defines the referenced map', () => {
    renderInspector(avmmCore({ import: 'regmap.mm.yml' }));

    expect(screen.getByText('regmap.mm.yml')).toBeInTheDocument();
    expect(screen.queryByText('No file linked')).not.toBeInTheDocument();
  });

  it('shows no file when the object-form import does not define the referenced map', () => {
    renderInspector(avmmCore({ import: 'regmap.mm.yml' }, 'OTHER_MAP'));

    expect(screen.getByText('No file linked')).toBeInTheDocument();
  });

  it('removes an object-form import that no other interface uses when cleared', () => {
    const onUpdate = renderInspector(avmmCore({ import: 'regmap.mm.yml' }));

    fireEvent.click(screen.getByTitle('Remove file link'));

    expect(onUpdate.mock.calls).toEqual([
      [['memoryMaps'], undefined],
      [['busInterfaces', 0, 'memoryMapRef'], null],
    ]);
  });

  it('keeps an object-form import that another interface still uses when cleared', () => {
    const ipCore = avmmCore({ import: 'regmap.mm.yml' });
    ipCore.busInterfaces!.push({
      name: 'S_DEBUG',
      type: 'ipcraft:busif:avalon_mm:1.0',
      mode: 'slave',
      memoryMapRef: 'DEBUG_CSR',
    } as never);
    const onUpdate = jest.fn();
    render(
      <CanvasInspector
        selected={selected}
        ipCore={ipCore}
        imports={{
          busLibrary: builtinBusLibrary(),
          memoryMaps: [{ name: 'REGMAP_CSR' }, { name: 'DEBUG_CSR' }],
        }}
        onUpdate={onUpdate}
        batchUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Remove file link'));

    expect(onUpdate.mock.calls).toEqual([[['busInterfaces', 0, 'memoryMapRef'], null]]);
  });
});
