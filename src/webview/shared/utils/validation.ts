/**
 * VHDL identifier validation
 * Must start with letter, contain only letters, numbers, and underscores
 */
export function validateVhdlIdentifier(value: string): string | null {
  if (!value) {
    return 'Required';
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
    return 'Must start with letter, contain only letters, numbers, and underscores';
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
 * Frequency validation
 * Format: number + optional space + optional unit (Hz, KHz, MHz, GHz)
 */
export function validateFrequency(value: string): string | null {
  if (!value) {
    return null;
  } // Optional field

  if (!/^\d+(\.\d+)?\s*(Hz|KHz|MHz|GHz)?$/i.test(value)) {
    return 'Format: number + unit (e.g., "100 MHz")';
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

/**
 * Positive number validation
 */
export function validatePositiveNumber(value: number): string | null {
  if (value < 0) {
    return 'Must be positive';
  }
  return null;
}
