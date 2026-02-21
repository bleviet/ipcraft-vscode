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
 * Checks if name already exists in list
 */
export function validateUniqueName(
  name: string,
  existingNames: string[],
  currentName?: string
): string | null {
  if (name === currentName) {
    return null;
  } // Editing current item

  if (existingNames.includes(name)) {
    return 'Name must be unique';
  }

  return null;
}

/**
 * Version format validation
 * Format: X.Y.Z where X, Y, Z are numbers
 */
export function validateVersion(value: string): string | null {
  if (!value) {
    return 'Required';
  }

  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    return 'Format: X.Y.Z (e.g., "1.0.0")';
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
