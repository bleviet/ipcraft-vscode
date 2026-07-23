import { useCallback, useState } from 'react';
import type { PackSummary, RegisteredToolchain } from '../components/IpCoreToolbar';
import type { IpCoreUpdateMessage } from '../types/messages';

/**
 * Toolbar/vendor-file settings mirrored from each `update` message: HDL
 * language, scaffold pack, target vendor toolchains, and which vendor
 * project files exist alongside the `.ip.yml` (sent by the extension on
 * every document update). Extracted from IpCoreApp (issue #129).
 */
export function useToolbarSettings() {
  const [hasComponentXml, setHasComponentXml] = useState(false);
  const [hasHwTcl, setHasHwTcl] = useState(false);
  const [hasXpr, setHasXpr] = useState(false);
  const [hasQpf, setHasQpf] = useState(false);
  const [hdlLanguage, setHdlLanguage] = useState<'vhdl' | 'systemverilog'>('vhdl');
  const [scaffoldPack, setScaffoldPack] = useState('builtin-minimal');
  const [availableScaffoldPacks, setAvailableScaffoldPacks] = useState<PackSummary[]>([
    { id: 'builtin-minimal', label: 'Minimal', description: '', category: 'builtin' },
    { id: 'builtin-ipcraft', label: 'IPCraft', description: '', category: 'builtin' },
  ]);
  const [toolbarTargets, setToolbarTargets] = useState<string[]>(['vivado', 'quartus']);
  const [allToolchains, setAllToolchains] = useState<RegisteredToolchain[]>([
    { id: 'vivado', displayName: 'Vivado (Xilinx/AMD)' },
    { id: 'quartus', displayName: 'Quartus (Intel/Altera)' },
  ]);
  const [isPreview, setIsPreview] = useState(false);

  const applyFromUpdateMessage = useCallback((message: IpCoreUpdateMessage) => {
    setHasComponentXml(message.hasComponentXml ?? false);
    setHasHwTcl(message.hasHwTcl ?? false);
    setHasXpr(message.hasXpr ?? false);
    setHasQpf(message.hasQpf ?? false);
    setHdlLanguage(message.hdlLanguage ?? 'vhdl');
    if (message.scaffoldPack !== undefined) {
      setScaffoldPack(message.scaffoldPack);
    }
    if (message.availableScaffoldPacks?.length) {
      setAvailableScaffoldPacks(message.availableScaffoldPacks);
    }
    setToolbarTargets(message.toolbarTargets ?? ['vivado', 'quartus']);
    if (message.allToolchains && message.allToolchains.length > 0) {
      setAllToolchains(message.allToolchains);
    }
    setIsPreview(message.isPreview ?? false);
  }, []);

  return {
    hasComponentXml,
    hasHwTcl,
    hasXpr,
    hasQpf,
    hdlLanguage,
    scaffoldPack,
    availableScaffoldPacks,
    toolbarTargets,
    allToolchains,
    isPreview,
    applyFromUpdateMessage,
  };
}
