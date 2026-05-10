import { execSync } from 'child_process';

/**
 * Resolves the vendor string for IP core import using a priority chain:
 * 1. Explicit value from VS Code settings (ipcraft.import.vendor), if not blank or "user"
 * 2. Domain extracted from git user.email (user@company.com -> company.com)
 * 3. Fallback: "ipcraft"
 */
export function resolveVendor(settingValue?: string): string {
  const trimmed = settingValue?.trim();
  if (trimmed && trimmed !== 'user') {
    return trimmed;
  }

  try {
    const email = execSync('git config user.email', { encoding: 'utf8', timeout: 2000 }).trim();
    const atIndex = email.lastIndexOf('@');
    if (atIndex !== -1) {
      const domain = email.slice(atIndex + 1);
      if (domain) {
        return domain;
      }
    }
  } catch {
    // git not available or not in a repo — fall through
  }

  return 'ipcraft';
}
