import { applyPlatformDesignerRoleCase } from '../../../../services/toolchains/platformDesignerRoles';

describe('applyPlatformDesignerRoleCase', () => {
  const interfaces = [
    {
      name: 's_axi',
      altera_type: 'axi4lite',
      ports: [{ name: 's_axi_awaddr', interface_role: 'AWADDR' }],
    },
    {
      name: 's_avmm',
      altera_type: 'avalon',
      ports: [{ name: 'avs_read_n', interface_role: 'read_n' }],
    },
    {
      name: 'custom',
      altera_type: 'conduit',
      ports: [{ name: 'custom_static', interface_role: 'StaticRole' }],
    },
  ];
  const elaboratePortWidths = [
    { iface_name: 's_axi', port_name: 's_axi_wdata', interface_role: 'WDATA' },
    { iface_name: 'custom', port_name: 'custom_p', interface_role: 'ParameterizedRole' },
    { iface_name: 'Rb_ByteEna', port_name: 'Rb_ByteEna', interface_role: 'Rb_ByteEna' },
  ];

  it('lowercases roles of standard interfaces and keeps conduit spelling', () => {
    const result = applyPlatformDesignerRoleCase(interfaces, elaboratePortWidths);

    expect(
      result.interfaces.map((iface) => (iface.ports as Array<{ interface_role: string }>)[0])
    ).toEqual([
      { name: 's_axi_awaddr', interface_role: 'awaddr' },
      { name: 'avs_read_n', interface_role: 'read_n' },
      { name: 'custom_static', interface_role: 'StaticRole' },
    ]);
    expect(result.elaboratePortWidths.map((port) => port.interface_role)).toEqual([
      'wdata',
      'ParameterizedRole',
      'Rb_ByteEna',
    ]);
  });

  it('does not change the shared template context', () => {
    applyPlatformDesignerRoleCase(interfaces, elaboratePortWidths);

    expect(interfaces[0].ports[0].interface_role).toBe('AWADDR');
    expect(elaboratePortWidths[0].interface_role).toBe('WDATA');
  });
});
