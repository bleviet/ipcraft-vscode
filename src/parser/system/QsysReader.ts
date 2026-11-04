/**
 * Static reader for Platform Designer Standard `.qsys` files (XML). Reads the
 * direct children of `<system>` (`module`, `connection`, `interface`) into a
 * flat, vendor-neutral {@link SystemGraph}; nothing is executed or opened.
 */

import { DOMParser } from '@xmldom/xmldom';
import type { SystemGraph } from '../../domain/systemGraph';
import { QsysGraphBuilder, splitEndpoint } from './qsysGraphBuilder';

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
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^.]*$/, '');
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
  const builder = new QsysGraphBuilder(fileName, systemName(root, fileName));
  const children = childElements(root);
  const ofTag = (tag: string) => children.filter((child) => child.tagName === tag);

  const disabled = new Map<string, number>();
  const moduleLines = new Map<string, number>();
  for (const element of ofTag('module')) {
    const name = element.getAttribute('name') ?? '';
    const firstLine = moduleLines.get(name);
    if (firstLine !== undefined) {
      builder.warn(`Duplicate module ${name}; the first definition is used.`, [
        firstLine,
        lineOf(element),
      ]);
      continue;
    }
    moduleLines.set(name, lineOf(element));
    if (element.getAttribute('enabled') === '0') {
      disabled.set(name, lineOf(element));
      continue;
    }
    builder.addModule(
      name,
      element.getAttribute('kind') ?? undefined,
      element.getAttribute('version') ?? undefined,
      parametersOf(element),
      lineOf(element)
    );
  }

  /** The first module name that is neither enabled nor disabled, if any. */
  const unknownModule = (...instances: string[]): string | undefined =>
    instances.find((name) => !builder.hasModule(name) && !disabled.has(name));
  const touchesDisabled = (...instances: string[]): boolean =>
    instances.some((name) => disabled.has(name));

  // Connections first, so an exported interface can join a connection's net.
  for (const element of ofTag('connection')) {
    const startText = element.getAttribute('start') ?? '';
    const endText = element.getAttribute('end') ?? '';
    const start = splitEndpoint(startText);
    const end = splitEndpoint(endText);
    const unknown = unknownModule(start.instance, end.instance);
    if (unknown !== undefined) {
      builder.warn(
        `Connection ${startText} -> ${endText} refers to unknown module ${unknown}.`,
        lineOf(element)
      );
    } else if (!touchesDisabled(start.instance, end.instance)) {
      builder.connect(
        start,
        end,
        element.getAttribute('kind') ?? '',
        parametersOf(element),
        lineOf(element)
      );
    }
  }

  for (const element of ofTag('interface')) {
    const name = element.getAttribute('name') ?? '';
    const internal = splitEndpoint(element.getAttribute('internal') ?? '');
    const unknown = unknownModule(internal.instance);
    if (unknown !== undefined) {
      builder.warn(
        `Exported interface ${name} refers to unknown module ${unknown}.`,
        lineOf(element)
      );
      builder.exportInterface(
        name,
        undefined,
        element.getAttribute('type') ?? '',
        element.getAttribute('dir') === 'start' ? 'start' : 'end',
        lineOf(element)
      );
    } else if (!touchesDisabled(internal.instance)) {
      builder.exportInterface(
        name,
        internal,
        element.getAttribute('type') ?? '',
        element.getAttribute('dir') === 'start' ? 'start' : 'end',
        lineOf(element)
      );
    }
  }

  if (disabled.size > 0) {
    builder.info(`Skipped disabled modules: ${[...disabled.keys()].join(', ')}`, [
      ...disabled.values(),
    ]);
  }
  const unsupported = new Map<string, number[]>();
  for (const element of children) {
    const tag = element.tagName;
    if (!HANDLED.has(tag) && !IGNORED.has(tag)) {
      unsupported.set(tag, [...(unsupported.get(tag) ?? []), lineOf(element)]);
    }
  }
  if (unsupported.size > 0) {
    builder.info(
      `Skipped unsupported elements: ${[...unsupported.keys()].join(', ')}`,
      [...unsupported.values()].flat().sort((a, b) => a - b)
    );
  }
  return builder.finish();
}
