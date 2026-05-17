export interface ManifestOutput {
  template?: string;
  path: string;
  group?: string;
  when?: string;
  generator?: string;
}

export interface ManifestData {
  templateDirs: string[];
  groups: Record<string, { enabled: boolean }>;
  outputs: ManifestOutput[];
}

export type HostMessage =
  | {
      type: 'init';
      builtinTemplates: Record<string, string>;
      customTemplates: Record<string, string>;
      manifest: ManifestData | null;
      context: Record<string, unknown>;
      manifestPath: string | null;
      customTemplateDir: string | null;
    }
  | { type: 'copiedBuiltin'; templateName: string; content: string }
  | { type: 'previewResult'; preview: string; error: string | null }
  | { type: 'error'; message: string };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'initManifest' }
  | { type: 'renderPreview'; source: string }
  | { type: 'copyBuiltin'; templateName: string }
  | { type: 'saveTemplate'; templateName: string; content: string }
  | {
      type: 'saveManifest';
      groups: Record<string, { enabled: boolean }>;
      outputs: ManifestOutput[];
    };
