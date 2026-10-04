import type { IpcraftIssue } from './issues';

interface SchemaValidationInput {
  valid: boolean;
  error?: string;
  details?: readonly {
    path: readonly (string | number)[];
    keyword: string;
    message: string;
  }[];
}

export function schemaIssuesFromValidation(result: SchemaValidationInput): readonly IpcraftIssue[] {
  if (result.valid) {
    return [];
  }
  if (!result.details?.length) {
    return [
      {
        code: 'SCHEMA_VALIDATION',
        severity: 'error',
        source: 'schema',
        path: [],
        message: result.error ?? 'Schema validation failed.',
      },
    ];
  }
  return result.details.map((detail) => ({
    code: `SCHEMA_${detail.keyword.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`,
    severity: 'error',
    source: 'schema',
    path: detail.path,
    message: `${detail.path.length > 0 ? `${detail.path.join('.')}: ` : ''}${detail.message}`,
  }));
}
