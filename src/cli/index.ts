#!/usr/bin/env node
import * as path from 'path';
import { resolveResourceRoots } from '../services/ResourceRoots';
import { runCliGenerate } from './generate';
import { runCliVerify } from './verify';
import { parseArgs, usageText } from './argv';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    console.log(usageText());
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    console.log(usageText());
    return 1;
  }

  let resourceRoots;
  try {
    // dist/cli.js lives one level under the package root.
    resourceRoots = resolveResourceRoots(path.resolve(__dirname, '..'));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (parsed.kind === 'verify') {
    const result = await runCliVerify(parsed.args, resourceRoots);
    if (!result.success && result.error) {
      console.error(`Verification failed: ${result.error}`);
      return 1;
    }
    if (!result.success) {
      console.error(
        `Stale: ${result.staleFiles?.length ?? 0} file(s) differ from a fresh generation:`
      );
      for (const f of result.staleFiles ?? []) {
        console.error(`  ${f}`);
      }
      return 1;
    }
    console.log(
      `Up to date: ${path.resolve(parsed.args.generatedDir)} matches a fresh generation.`
    );
    return 0;
  }

  const result = await runCliGenerate(parsed.args, resourceRoots);
  if (!result.success) {
    console.error(`Generation failed: ${result.error}`);
    return 1;
  }

  console.log(`Generated ${result.files?.length ?? 0} file(s) into ${result.outputDir}`);
  for (const f of result.files ?? []) {
    console.log(`  ${f}`);
  }
  return 0;
}

/* istanbul ignore next -- exercised via the built dist/cli.js, not unit tests */
if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (err) => {
      console.error('Unexpected error:', err instanceof Error ? (err.stack ?? err.message) : err);
      process.exitCode = 1;
    }
  );
}
