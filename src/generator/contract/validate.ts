import Ajv from 'ajv';
import type { TemplateContext } from './templateContext.types';
import schema from './template_context.schema.json';

const ajv = new Ajv({ allErrors: true, strict: false });
const validator = ajv.compile<TemplateContext>(schema);

export class ContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

export function assertValidContext(ctx: unknown): asserts ctx is TemplateContext {
  if (validator(ctx)) {
    return;
  }
  const detail = (validator.errors ?? [])
    .map((e) => `  - context${e.instancePath || ''} ${e.message}`)
    .join('\n');
  const version =
    ctx !== null && typeof ctx === 'object' && 'contract_version' in ctx
      ? String((ctx as Record<string, unknown>).contract_version)
      : '?';
  throw new ContractViolationError(
    `Template context failed contract v${version} validation:\n${detail}`
  );
}
