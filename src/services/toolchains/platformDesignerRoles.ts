/**
 * Platform Designer defines the port roles of its standard interface types
 * (avalon, avalon_streaming, axi4lite, axi4, axi4stream) in lowercase and
 * rejects any other spelling as an unknown type (`AWADDR`). Conduit roles are
 * free-form, so they keep their configured spelling.
 *
 * Expects `altera_type` to be set on each interface. Returns copies; the shared
 * template context is not changed.
 */
export function applyPlatformDesignerRoleCase(
  interfaces: readonly Record<string, unknown>[],
  elaboratePortWidths: readonly Record<string, unknown>[]
): {
  interfaces: Record<string, unknown>[];
  elaboratePortWidths: Record<string, unknown>[];
} {
  const standardInterfaces = new Set(
    interfaces.filter((iface) => iface.altera_type !== 'conduit').map((iface) => iface.name)
  );
  const lowerRole = (port: Record<string, unknown>): Record<string, unknown> =>
    typeof port.interface_role === 'string'
      ? { ...port, interface_role: port.interface_role.toLowerCase() }
      : port;

  return {
    interfaces: interfaces.map((iface) =>
      standardInterfaces.has(iface.name) && Array.isArray(iface.ports)
        ? { ...iface, ports: (iface.ports as Record<string, unknown>[]).map(lowerRole) }
        : iface
    ),
    elaboratePortWidths: elaboratePortWidths.map((port) =>
      standardInterfaces.has(port.iface_name) ? lowerRole(port) : port
    ),
  };
}
