export interface VivadoBoard {
  label: string;
  vendor: string;
  part: string;
  family: string;
}

export interface QuartusBoard {
  label: string;
  vendor: string;
  device: string;
  family: string;
}

export const VIVADO_BOARDS: VivadoBoard[] = [
  // ── Digilent ──────────────────────────────────────────────────────────────
  { label: 'Arty A7-35T', vendor: 'Digilent', part: 'xc7a35ticsg324-1L', family: 'Artix-7' },
  { label: 'Arty A7-100T', vendor: 'Digilent', part: 'xc7a100tcsg324-1', family: 'Artix-7' },
  { label: 'Basys 3', vendor: 'Digilent', part: 'xc7a35tcpg236-1', family: 'Artix-7' },
  { label: 'Nexys A7-50T', vendor: 'Digilent', part: 'xc7a50tcsg324-1', family: 'Artix-7' },
  { label: 'Nexys A7-100T', vendor: 'Digilent', part: 'xc7a100tcsg324-1', family: 'Artix-7' },
  { label: 'Cmod A7-35T', vendor: 'Digilent', part: 'xc7a35tcpg236-1', family: 'Artix-7' },
  { label: 'Arty S7-25', vendor: 'Digilent', part: 'xc7s25csga324-1', family: 'Spartan-7' },
  { label: 'Arty S7-50', vendor: 'Digilent', part: 'xc7s50csga324-1', family: 'Spartan-7' },
  { label: 'Zybo Z7-10', vendor: 'Digilent', part: 'xc7z010clg400-1', family: 'Zynq-7000' },
  { label: 'Zybo Z7-20', vendor: 'Digilent', part: 'xc7z020clg400-1', family: 'Zynq-7000' },
  { label: 'Arty Z7-10', vendor: 'Digilent', part: 'xc7z010clg400-1', family: 'Zynq-7000' },
  { label: 'Arty Z7-20', vendor: 'Digilent', part: 'xc7z020clg400-1', family: 'Zynq-7000' },
  // ── AMD/Xilinx ────────────────────────────────────────────────────────────
  { label: 'ZC702', vendor: 'AMD/Xilinx', part: 'xc7z020clg484-1', family: 'Zynq-7000' },
  { label: 'ZC706', vendor: 'AMD/Xilinx', part: 'xc7z045ffg900-2', family: 'Zynq-7000' },
  { label: 'KC705', vendor: 'AMD/Xilinx', part: 'xc7k325tffg900-2', family: 'Kintex-7' },
  { label: 'VC707', vendor: 'AMD/Xilinx', part: 'xc7vx485tffg1761-2', family: 'Virtex-7' },
  {
    label: 'ZCU102',
    vendor: 'AMD/Xilinx',
    part: 'xczu9eg-ffvb1156-2-e',
    family: 'Zynq UltraScale+ MPSoC',
  },
  {
    label: 'ZCU104',
    vendor: 'AMD/Xilinx',
    part: 'xczu7ev-ffvc1156-2-e',
    family: 'Zynq UltraScale+ EV',
  },
  {
    label: 'KCU116',
    vendor: 'AMD/Xilinx',
    part: 'xcku5p-ffvb676-2-e',
    family: 'Kintex UltraScale+',
  },
  // ── Alchitry ──────────────────────────────────────────────────────────────
  { label: 'Au', vendor: 'Alchitry', part: 'xc7a35tftg256-1', family: 'Artix-7' },
  { label: 'Au+', vendor: 'Alchitry', part: 'xc7a100tftg256-1', family: 'Artix-7' },
  // ── TUL / Pynq ────────────────────────────────────────────────────────────
  { label: 'Pynq-Z1', vendor: 'TUL', part: 'xc7z020clg400-1', family: 'Zynq-7000' },
  { label: 'Pynq-Z2', vendor: 'TUL', part: 'xc7z020clg400-1', family: 'Zynq-7000' },
];

export const QUARTUS_BOARDS: QuartusBoard[] = [
  // ── Terasic ───────────────────────────────────────────────────────────────
  { label: 'DE10-Nano', vendor: 'Terasic', device: '5CSEBA6U23I7', family: 'Cyclone V SoC' },
  { label: 'DE10-Standard', vendor: 'Terasic', device: '5CSXFC6D6F31C8', family: 'Cyclone V SoC' },
  { label: 'DE1-SoC', vendor: 'Terasic', device: '5CSEMA5F31C6', family: 'Cyclone V SoC' },
  { label: 'DE0-CV', vendor: 'Terasic', device: '5CEBA4F23C7', family: 'Cyclone V' },
  { label: 'DE10-Lite', vendor: 'Terasic', device: '10M50DAF484C7G', family: 'MAX 10' },
  { label: 'DE2-115', vendor: 'Terasic', device: 'EP4CE115F29C7', family: 'Cyclone IV E' },
  { label: 'DE0-Nano', vendor: 'Terasic', device: 'EP4CE22F17C6', family: 'Cyclone IV E' },
  // ── Arrow ─────────────────────────────────────────────────────────────────
  { label: 'SoCKit', vendor: 'Arrow', device: '5CSXFC6D6F31C8', family: 'Cyclone V SoC' },
  // ── Intel ─────────────────────────────────────────────────────────────────
  {
    label: 'Cyclone 10 LP Eval Kit',
    vendor: 'Intel',
    device: '10CL025YU256C8G',
    family: 'Cyclone 10 LP',
  },
  { label: 'MAX 10 Dev Kit', vendor: 'Intel', device: '10M08SAE144C8G', family: 'MAX 10' },
  {
    label: 'Arria 10 GX Dev Kit',
    vendor: 'Intel',
    device: '10AX115S2F45I1SG',
    family: 'Arria 10 GX',
  },
];
