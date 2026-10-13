/**
 * VHDL identifier validation.
 * Must start with a letter, contain only letters, digits, and underscores,
 * with no consecutive underscores and no trailing underscore.
 */
export function validateVhdlIdentifier(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return 'Name is required';
  }

  const re = /^[A-Za-z](?:[A-Za-z0-9]*(_[A-Za-z0-9]+)*)?$/;
  if (!re.test(trimmed)) {
    return 'VHDL name must start with a letter and contain only letters, digits, and single underscores';
  }

  return null;
}

/**
 * Unique name validation
 * Checks if name already exists in list, case-insensitively (HDL identifiers
 * are case-insensitive, so ERROR_O and error_o collide).
 */
export function validateUniqueName(
  name: string,
  existingNames: string[],
  currentName?: string
): string | null {
  const lowerName = name.toLowerCase();

  if (lowerName === currentName?.toLowerCase()) {
    return null;
  } // Editing current item

  if (existingNames.some((existing) => existing.toLowerCase() === lowerName)) {
    return 'Name is already used';
  }

  return null;
}

/**
 * Non-empty validation
 */
export function validateRequired(value: string): string | null {
  if (!value || value.trim() === '') {
    return 'Required';
  }
  return null;
}
