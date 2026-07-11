/**
 * Failure buckets for register-transport errors, per ipcraft-vscode issue #36 Part B:
 *  - setup: tool not in PATH, or no JTAG debug master built into the design.
 *  - connection: no target/board reachable (cable unplugged, no claimable service).
 *  - transaction: bad address, decode error, parse failure, or a per-request timeout.
 */
export type RegisterTransportErrorCategory = 'setup' | 'connection' | 'transaction';

export class RegisterTransportError extends Error {
  constructor(
    message: string,
    public readonly category: RegisterTransportErrorCategory
  ) {
    super(message);
    this.name = 'RegisterTransportError';
  }
}

/**
 * Read/write access to memory-mapped registers on real hardware, keyed by byte
 * address. Implementations spawn a vendor CLI (System Console, xsdb, …) and
 * frame each transaction against it — see SystemConsoleTransport for the
 * hardware-validated protocol.
 */
export interface RegisterTransport {
  /** Discover and claim the debug master. Must succeed before read32/write32. */
  connect(): Promise<void>;
  read32(addr: number): Promise<number>;
  write32(addr: number, value: number): Promise<void>;
  /** Kill any in-flight transaction and release resources. Idempotent. */
  dispose(): void;
}
