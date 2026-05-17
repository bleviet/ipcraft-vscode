export type GeneratorId = 'nunjucks' | 'component-xml';

export interface ManifestOutput {
  generator?: GeneratorId;
  template?: string;
  path: string;
  group?: string;
  when?: string;
}

export interface TemplateManifest {
  version: string;
  templateDirs?: string[];
  groups?: Record<string, { enabled: boolean }>;
  outputs: ManifestOutput[];
}

export interface ResolvedManifest {
  templateDirs: string[];
  groups: Record<string, { enabled: boolean }>;
  outputs: ManifestOutput[];
  manifestDir: string;
}
