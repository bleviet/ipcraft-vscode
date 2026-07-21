#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

// Git-tracked source documentation is authoritative. These directory names are
// excluded deliberately in case generated or dependency content is ever tracked.
const excludedDirectories = new Set([
  '.git',
  '.venv',
  'build',
  'coverage',
  'dist',
  'generated',
  'ipcraft-spec',
  'node_modules',
  'out',
  'site',
  'vendor',
]);

function isExcluded(file) {
  return file.split('/').some((part) => excludedDirectories.has(part));
}

function trackedMarkdownFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--', '*.md', '*.markdown'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => !isExcluded(file));
}

function stripFencedCode(line, state) {
  const fence = line.match(/^\s*(```+|~~~+)/);
  if (fence) {
    if (!state.fence) {
      state.fence = fence[1][0];
    } else if (state.fence === fence[1][0]) {
      state.fence = null;
    }
    return '';
  }
  if (state.fence) {
    return '';
  }
  return line;
}

function linkTarget(raw) {
  const value = raw.trim();
  if (value.startsWith('<')) {
    const end = value.indexOf('>');
    return end >= 0 ? value.slice(1, end) : value;
  }
  return value.split(/\s+(?=["'(])/)[0];
}

function linksInFile(file) {
  const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const links = [];
  const state = { fence: null };

  for (const [index, originalLine] of content.split(/\r?\n/).entries()) {
    const line = stripFencedCode(originalLine, state).replace(/(`+)(.*?)\1/g, '');
    if (!line) {
      continue;
    }

    const patterns = [
      /!?\[[^\]]*\]\(([^)]+)\)/g,
      /^\s{0,3}\[[^\]]+\]:\s*(<?[^\s>]+>?)/g,
      /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
    ];
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        links.push({ line: index + 1, target: linkTarget(match[1]) });
      }
    }
  }
  return links;
}

function isExternal(target) {
  return (
    target === '' ||
    target.startsWith('//') ||
    target.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.includes('{{') ||
    target.includes('${')
  );
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function headingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
    .replace(/\s+/g, '-');
}

function anchorsInFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const anchors = new Set();
  const duplicates = new Map();
  const state = { fence: null };

  for (const originalLine of content.split(/\r?\n/)) {
    const line = stripFencedCode(originalLine, state);
    if (!line) {
      continue;
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const explicit = heading[1].match(/\s*\{#([^}]+)\}\s*$/);
      const base = explicit ? explicit[1] : headingSlug(heading[1]);
      if (base) {
        const count = duplicates.get(base) ?? 0;
        anchors.add(count === 0 ? base : `${base}-${count}`);
        duplicates.set(base, count + 1);
      }
    }

    for (const match of line.matchAll(/<(?:a|[^>]+)\s+(?:id|name)=["']([^"']+)["']/gi)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

function resolveLink(source, target) {
  const hashIndex = target.indexOf('#');
  const pathAndQuery = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const fragment = hashIndex >= 0 ? decode(target.slice(hashIndex + 1)) : '';
  const filePart = decode(pathAndQuery.split('?')[0]);
  const sourcePath = path.join(repoRoot, source);
  const targetPath = filePart ? path.resolve(path.dirname(sourcePath), filePart) : sourcePath;
  return { targetPath, fragment };
}

function main() {
  const markdownFiles = trackedMarkdownFiles();
  const errors = [];
  let externalLinks = 0;

  for (const source of markdownFiles) {
    for (const { line, target } of linksInFile(source)) {
      if (isExternal(target)) {
        externalLinks += 1;
        continue;
      }

      const { targetPath, fragment } = resolveLink(source, target);
      if (!targetPath.startsWith(`${repoRoot}${path.sep}`) && targetPath !== repoRoot) {
        errors.push(`${source}:${line}: unresolved local link "${target}" (outside repository)`);
        continue;
      }
      if (!fs.existsSync(targetPath)) {
        errors.push(`${source}:${line}: unresolved local link "${target}" (target does not exist)`);
        continue;
      }

      if (fragment && fs.statSync(targetPath).isFile() && /\.md(?:own)?$/i.test(targetPath)) {
        const anchors = anchorsInFile(targetPath);
        if (!anchors.has(fragment)) {
          errors.push(
            `${source}:${line}: unresolved local link "${target}" (anchor #${fragment} does not exist)`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`Local Markdown link check failed:\n${errors.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Checked ${markdownFiles.length} tracked Markdown files; ` +
      `skipped ${externalLinks} external or site-root links (no network requests).\n`
  );
}

main();
