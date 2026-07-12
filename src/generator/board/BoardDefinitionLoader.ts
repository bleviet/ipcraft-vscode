import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { YamlValidator } from '../../services/YamlValidator';
import type { ResourceRoots } from '../../services/ResourceRoots';
import type { BoardDefinition } from './types';

const validator = new YamlValidator();

/**
 * Load and validate a board-definition YAML file against board.schema.json.
 * Throws with a clear, ajv-derived message when the file is invalid (e.g. missing `device`).
 */
export async function loadBoardDefinition(
  boardPath: string,
  resourceRoots: ResourceRoots
): Promise<BoardDefinition> {
  const content = await fs.readFile(boardPath, 'utf8');
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid board definition YAML: ${boardPath}`);
  }

  const schemaPath = path.join(resourceRoots.schemasDir, 'board.schema.json');
  const schemaResult = validator.validateAgainstSchema(parsed, schemaPath);
  if (!schemaResult.valid) {
    throw new Error(`Board definition schema validation failed: ${schemaResult.error}`);
  }

  const board = parsed as BoardDefinition;
  return {
    ...board,
    clocks: board.clocks ?? [],
    resets: board.resets ?? [],
    ios: board.ios ?? [],
  };
}

/** Path to a built-in board-definition file bundled under resourceRoots.boardsDir. */
export function builtinBoardPath(resourceRoots: ResourceRoots, fileName: string): string {
  return path.join(resourceRoots.boardsDir, fileName);
}
