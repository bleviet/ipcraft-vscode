import type { NormalizedMemoryMap } from '../domain/internal.types';
import type { RegisterTransport } from './transport/RegisterTransport';

export interface RegisterReadResult {
  name: string;
  value: number;
  timestamp: number;
}

/**
 * Binds a RegisterTransport to a resolved .mm.yml register map for name-based
 * hardware access — the extension-side counterpart to RegisterDriver in
 * examples/led_avmm/altera/debug/debug_console.py. Values are read from the
 * in-memory domain model + transport; no generated-to-disk driver is used.
 *
 * Plain (non-array) registers only in this first slice — register arrays are
 * out of scope until a concrete workflow needs indexed access.
 */
export class LiveRegisterSession {
  private readonly offsetsByName = new Map<string, number>();

  constructor(
    private readonly transport: RegisterTransport,
    maps: NormalizedMemoryMap[]
  ) {
    for (const map of maps) {
      for (const block of map.addressBlocks) {
        for (const reg of block.registers) {
          if (reg.__kind === 'array') {
            continue;
          }
          this.offsetsByName.set(reg.name, block.baseAddress + reg.offset);
        }
      }
    }
  }

  /** Names of all plain registers this session can read/write. */
  registerNames(): string[] {
    return [...this.offsetsByName.keys()];
  }

  connect(): Promise<void> {
    return this.transport.connect();
  }

  async readRegister(name: string): Promise<RegisterReadResult> {
    const addr = this.requireOffset(name);
    const value = await this.transport.read32(addr);
    return { name, value, timestamp: Date.now() };
  }

  /** Read-modify-write is the caller's responsibility (mask + insert against a prior read); this writes the raw word. */
  async writeRegister(name: string, value: number): Promise<RegisterReadResult> {
    const addr = this.requireOffset(name);
    await this.transport.write32(addr, value);
    const readBack = await this.transport.read32(addr);
    return { name, value: readBack, timestamp: Date.now() };
  }

  dispose(): void {
    this.transport.dispose();
  }

  private requireOffset(name: string): number {
    const addr = this.offsetsByName.get(name);
    if (addr === undefined) {
      throw new Error(`Unknown register: ${name}`);
    }
    return addr;
  }
}
