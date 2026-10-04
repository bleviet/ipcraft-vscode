#!/usr/bin/env node
import * as path from 'path';
import { resolveResourceRoots } from '../services/ResourceRoots';
import { runCliGenerate } from './generate';
import { runCliMigrate } from './migrate';
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

  if (parsed.kind === 'migrate') {
    return runMigrate(parsed.args, resourceRoots);
  }

  if (parsed.kind === 'verify') {
    const result = await runCliVerify(parsed.args, resourceRoots);
    if (!result.success && result.error) {
      console.error(`Verification failed: ${result.error}`);
      return 1;
    }
    printWarnings(result.warnings);
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
  printWarnings(result.warnings);

  console.log(`Generated ${result.files?.length ?? 0} file(s) into ${result.outputDir}`);
  for (const f of result.files ?? []) {
    console.log(`  ${f}`);
  }
  return 0;
}

/** Runs `ipcraft migrate`, printing one line per file; exit 1 on errors or (--check) pending upgrades. */
async function runMigrate(
  args: Parameters<typeof runCliMigrate>[0],
  resourceRoots: Parameters<typeof runCliMigrate>[1]
): Promise<number> {
  let exitCode = 0;
  for (const result of await runCliMigrate(args, resourceRoots)) {
    switch (result.status) {
      case 'upgraded':
        console.log(
          `Upgraded ${result.path} (${result.fromVersion} -> ${result.toVersion}, ${result.mutationCount} change(s))`
        );
        break;
      case 'needsUpgrade':
        console.log(`Needs upgrade: ${result.path} (${result.fromVersion} -> ${result.toVersion})`);
        exitCode = 1;
        break;
      case 'upToDate':
        console.log(`Up to date: ${result.path} (${result.version})`);
        break;
      case 'error':
        console.error(`Error: ${result.path}: ${result.error}`);
        exitCode = 1;
        break;
    }
  }
  return exitCode;
}

/** Prints non-fatal generation warnings (e.g. issue #156's framework-testbench ambiguity). */
function printWarnings(warnings: string[] | undefined): void {
  for (const w of warnings ?? []) {
    console.error(`Warning: ${w}`);
  }
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
