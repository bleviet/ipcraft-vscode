import * as fs from 'fs/promises';
import * as path from 'path';
import { candidateVivadoReleases } from '../../utils/toolchainVersions';

export type DetectionConfidence = 'exact' | 'ambiguous' | 'none';
export type DetectionSource = 'sidecar' | 'project-file' | 'none';

export interface ToolchainDetectionResult {
  confidence: DetectionConfidence;
  candidates: string[];
  source: DetectionSource;
}

export interface SidecarData {
  vendor: 'vivado' | 'quartus';
  version: string;
  sourcePath: string;
}

const SIDECAR_FILENAME = '.ipcraft-toolchain.json';

function isSidecarData(value: unknown): value is SidecarData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.vendor === 'vivado' || v.vendor === 'quartus') &&
    typeof v.version === 'string' &&
    typeof v.sourcePath === 'string'
  );
}

/**
 * Reads the sidecar next to a project file's directory. Returns undefined on
 * a missing file, invalid JSON, or a shape that doesn't match SidecarData —
 * detection always falls through to project-file parsing in every case.
 */
export async function readSidecar(projectDir: string): Promise<SidecarData | undefined> {
  try {
    const raw = await fs.readFile(path.join(projectDir, SIDECAR_FILENAME), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isSidecarData(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes the sidecar recording exactly which install/image produced the
 * project. Best-effort: a failed write (read-only directory, disk full) must
 * never reject and break createProject()'s graceful fallback path.
 */
export async function writeSidecar(projectDir: string, data: SidecarData): Promise<void> {
  try {
    await fs.writeFile(
      path.join(projectDir, SIDECAR_FILENAME),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  } catch {
    // Best-effort hint only — a failed write must never break createProject().
  }
}

export async function detectQuartusProjectVersion(
  qpfPath: string
): Promise<ToolchainDetectionResult> {
  const sidecar = await readSidecar(path.dirname(qpfPath));
  if (sidecar?.vendor === 'quartus') {
    return { confidence: 'exact', candidates: [sidecar.version], source: 'sidecar' };
  }

  try {
    const content = await fs.readFile(qpfPath, 'utf8');
    const match = content.match(/QUARTUS_VERSION\s*=\s*"([^"]+)"/);
    if (match?.[1]) {
      return { confidence: 'exact', candidates: [match[1]], source: 'project-file' };
    }
  } catch {
    // No project file yet, or unreadable — fall through to 'none'.
  }

  return { confidence: 'none', candidates: [], source: 'none' };
}

export async function detectVivadoProjectVersion(
  xprPath: string
): Promise<ToolchainDetectionResult> {
  const sidecar = await readSidecar(path.dirname(xprPath));
  if (sidecar?.vendor === 'vivado') {
    return { confidence: 'exact', candidates: [sidecar.version], source: 'sidecar' };
  }

  try {
    const content = await fs.readFile(xprPath, 'utf8');

    // Vivado stamps the exact release into a header comment, e.g.
    // "<!-- Product Version: Vivado v2024.2 (64-bit)              -->" —
    // verified present (same position, same wording) in real .xpr files
    // saved by Vivado 2014.2 through 2017.4. This is an exact, unambiguous
    // signal and needs no lookup table, so it's tried before the
    // Version/Minor format-version table.
    const productVersionMatch = content.match(/Product Version:\s*Vivado v(\d+\.\d+)/i);
    if (productVersionMatch?.[1]) {
      return { confidence: 'exact', candidates: [productVersionMatch[1]], source: 'project-file' };
    }

    const match = content.match(/<Project\b[^>]*\bVersion="(\d+)"[^>]*\bMinor="(\d+)"/);
    if (match) {
      const candidates = candidateVivadoReleases(match[1], match[2]);
      if (candidates.length === 1) {
        return { confidence: 'exact', candidates, source: 'project-file' };
      }
      if (candidates.length > 1) {
        return { confidence: 'ambiguous', candidates, source: 'project-file' };
      }
    }
  } catch {
    // No project file yet, or unreadable — fall through to 'none'.
  }

  return { confidence: 'none', candidates: [], source: 'none' };
}
