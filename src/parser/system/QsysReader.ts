/**
 * Static reader for Platform Designer Standard `.qsys` files (XML). Reads the
 * direct children of `<system>` (`module`, `connection`, `interface`) into a
 * flat, vendor-neutral {@link SystemGraph}; nothing is executed or opened.
 */

import { DOMParser } from '@xmldom/xmldom';
import type { SystemDiagnostic, SystemGraph } from '../../domain/systemGraph';
import { buildQsysGraph, fileBaseName } from './qsysSystem';

const HANDLED = new Set(['module', 'connection', 'interface']);
const IGNORED = new Set(['component', 'parameter', 'interconnectRequirement']);

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function lineOf(element: Element): number {
  return (element as unknown as { lineNumber?: number }).lineNumber ?? 0;
}

/** Child `<parameter>` elements: `value` attribute, else the text (e.g. CDATA); key as written. */
function parametersOf(element: Element): Record<string, string> {
  const parameters: Record<string, string> = {};
  for (const child of childElements(element)) {
    const name = child.getAttribute('name');
    if (child.tagName === 'parameter' && name) {
      parameters[name] = child.getAttribute('value') ?? child.textContent ?? '';
    }
  }
  return parameters;
}

function systemName(root: Element, fileName: string): string {
  const declared = root.getAttribute('name');
  if (declared && !declared.includes('$${FILENAME}')) {
    return declared;
  }
  return fileBaseName(fileName);
}

/** Parses `text`; a malformed document throws the first xmldom message with its line, once. */
function parseRoot(text: string): Element {
  let first: Error | undefined;
  const throwOnError = (
    level: 'warning' | 'error' | 'fatalError',
    message: string,
    context?: { locator?: { lineNumber?: number } }
  ): void => {
    if (level !== 'warning') {
      const line = context?.locator?.lineNumber;
      first ??= new Error(line ? `${message} (line ${line})` : message);
      throw first;
    }
  };
  try {
    const doc = new DOMParser({ onError: throwOnError }).parseFromString(text, 'text/xml');
    return doc.documentElement as unknown as Element;
  } catch (error) {
    throw first ?? error;
  }
}

export function readQsys(text: string, fileName: string): SystemGraph {
  const root = parseRoot(text);
  if (root.tagName !== 'system') {
    throw new Error(`Not a Platform Designer system: the root element is <${root.tagName}>.`);
  }
  const children = childElements(root);
  const ofTag = (tag: string) => children.filter((child) => child.tagName === tag);

  const unsupported = new Map<string, number[]>();
  for (const element of children) {
    const tag = element.tagName;
    if (!HANDLED.has(tag) && !IGNORED.has(tag)) {
      unsupported.set(tag, [...(unsupported.get(tag) ?? []), lineOf(element)]);
    }
  }
  const diagnostics: SystemDiagnostic[] = [];
  if (unsupported.size > 0) {
    diagnostics.push({
      severity: 'info',
      message: `Skipped unsupported elements: ${[...unsupported.keys()].join(', ')}`,
      lines: [...unsupported.values()].flat().sort((a, b) => a - b),
    });
  }

  return buildQsysGraph(
    {
      name: systemName(root, fileName),
      modules: ofTag('module').map((element) => ({
        name: element.getAttribute('name') ?? '',
        kind: element.getAttribute('kind') ?? undefined,
        version: element.getAttribute('version') ?? undefined,
        parameters: parametersOf(element),
        enabled: element.getAttribute('enabled') !== '0',
        line: lineOf(element),
      })),
      connections: ofTag('connection').map((element) => ({
        start: element.getAttribute('start') ?? '',
        end: element.getAttribute('end') ?? '',
        kind: element.getAttribute('kind') ?? '',
        kindSource: 'declared',
        parameters: parametersOf(element),
        line: lineOf(element),
      })),
      interfaces: ofTag('interface').map((element) => ({
        name: element.getAttribute('name') ?? '',
        internal: element.getAttribute('internal') ?? '',
        type: element.getAttribute('type') ?? '',
        end: element.getAttribute('dir') === 'start' ? 'start' : 'end',
        line: lineOf(element),
      })),
      diagnostics,
    },
    fileName,
    'qsys'
  );
}
