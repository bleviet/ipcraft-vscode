type FileEntry = {
  path?: string;
  type?: string;
};

export type FileSetEntry = {
  name?: string;
  description?: string;
  files?: FileEntry[];
};

function updateFileSet(
  fileSets: FileSetEntry[],
  setNames: string[],
  setDescription: string,
  newFiles: string[],
  fileTypeMap: (filePath: string) => string
): void {
  if (newFiles.length === 0) {
    return;
  }

  let targetSetIndex = fileSets.findIndex((fs) => fs?.name && setNames.includes(fs.name));

  if (targetSetIndex === -1) {
    fileSets.push({
      name: setNames[0],
      description: setDescription,
      files: [],
    });
    targetSetIndex = fileSets.length - 1;
  }

  fileSets[targetSetIndex].files ??= [];

  const existingFiles = fileSets[targetSetIndex].files as FileEntry[];

  for (const filePath of newFiles) {
    const exists = existingFiles.some((f) => f.path === filePath);
    if (!exists) {
      existingFiles.push({
        path: filePath,
        type: fileTypeMap(filePath),
      });
    }
  }
}

export function updateFileSets(
  existingFileSets: FileSetEntry[] | undefined,
  yamlRelativeFiles: string[]
): FileSetEntry[] {
  const fileSets = [...(existingFileSets ?? [])];

  const rtlFiles = yamlRelativeFiles.filter(
    (file) => file.endsWith('.vhd') && !file.endsWith('_regs.vhd') && !file.endsWith('_tb.vhd')
  );
  const simFiles = yamlRelativeFiles.filter(
    (file) => file.endsWith('.py') || file.endsWith('Makefile') || file.endsWith('_tb.vhd')
  );
  const integrationFiles = yamlRelativeFiles.filter(
    (file) => file.endsWith('.tcl') || file.endsWith('.xml') || file.endsWith('_regs.vhd')
  );

  updateFileSet(
    fileSets,
    ['RTL_Sources', 'rtl_sources', 'rtl', 'RTL'],
    'RTL Sources',
    rtlFiles,
    () => 'vhdl'
  );
  updateFileSet(
    fileSets,
    ['Simulation_Resources', 'simulation', 'tb'],
    'Simulation Files',
    simFiles,
    (file: string) => {
      if (file.endsWith('Makefile')) {
        return 'unknown';
      }
      if (file.endsWith('.py')) {
        return 'python';
      }
      return 'vhdl';
    }
  );
  updateFileSet(
    fileSets,
    ['Integration', 'integration'],
    'Integration Files',
    integrationFiles,
    (file: string) => {
      if (file.endsWith('.tcl')) {
        return 'tcl';
      }
      if (file.endsWith('.xml')) {
        return 'unknown';
      }
      return 'vhdl';
    }
  );

  return fileSets;
}
