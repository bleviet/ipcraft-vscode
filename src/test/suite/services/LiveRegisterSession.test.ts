import { LiveRegisterSession } from '../../../services/LiveRegisterSession';
import type { RegisterTransport } from '../../../services/transport/RegisterTransport';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';

// Mirrors examples/led_avmm/led_controller_avmm.mm.yml: VERSION/LED_PATTERN/EVENTS
// at qsys base 0x00010010, offsets 0x00/0x04/0x08.
function makeMaps(): NormalizedMemoryMap[] {
  return [
    {
      name: 'led_controller_avmm',
      description: '',
      addressBlocks: [
        {
          rowId: 'blk1',
          name: 'regs',
          baseAddress: 0x00010010,
          usage: 'register',
          defaultRegWidth: 32,
          description: '',
          registers: [
            {
              rowId: 'r1',
              name: 'VERSION',
              offset: 0x00,
              size: 32,
              resetValue: 0x100,
              description: '',
              fields: [],
            },
            {
              rowId: 'r2',
              name: 'LED_PATTERN',
              offset: 0x04,
              size: 32,
              resetValue: 0,
              description: '',
              fields: [],
            },
            {
              rowId: 'r3',
              name: 'REG_ARRAY',
              offset: 0x10,
              size: 32,
              resetValue: 0,
              description: '',
              fields: [],
              __kind: 'array',
              count: 4,
              stride: 4,
              registers: [],
            },
          ],
        },
      ],
    },
  ];
}

function makeTransport(): jest.Mocked<RegisterTransport> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    read32: jest.fn(),
    write32: jest.fn(),
    dispose: jest.fn(),
  };
}

describe('LiveRegisterSession', () => {
  it('resolves plain register names to base + offset addresses', async () => {
    const transport = makeTransport();
    transport.read32.mockResolvedValue(0x100);
    const session = new LiveRegisterSession(transport, makeMaps());

    const result = await session.readRegister('VERSION');

    expect(transport.read32).toHaveBeenCalledWith(0x00010010);
    expect(result.value).toBe(0x100);
    expect(result.name).toBe('VERSION');
  });

  it('excludes register arrays from the resolved name set', () => {
    const session = new LiveRegisterSession(makeTransport(), makeMaps());
    expect(session.registerNames()).toEqual(['VERSION', 'LED_PATTERN']);
  });

  it('readRegister() rejects unknown register names without touching the transport', async () => {
    const transport = makeTransport();
    const session = new LiveRegisterSession(transport, makeMaps());

    await expect(session.readRegister('NOPE')).rejects.toThrow('Unknown register: NOPE');
    expect(transport.read32).not.toHaveBeenCalled();
  });

  it('writeRegister() writes then re-reads the same address (read-modify-write is the caller’s job)', async () => {
    const transport = makeTransport();
    transport.read32.mockResolvedValue(0xff);
    const session = new LiveRegisterSession(transport, makeMaps());

    const result = await session.writeRegister('LED_PATTERN', 0xff);

    expect(transport.write32).toHaveBeenCalledWith(0x00010014, 0xff);
    expect(transport.read32).toHaveBeenCalledWith(0x00010014);
    expect(result.value).toBe(0xff);
  });

  it('connect() and dispose() delegate to the transport', async () => {
    const transport = makeTransport();
    const session = new LiveRegisterSession(transport, makeMaps());

    await session.connect();
    expect(transport.connect).toHaveBeenCalledTimes(1);

    session.dispose();
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });
});
