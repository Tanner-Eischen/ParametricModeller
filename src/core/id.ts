/**
 * Generate a unique identifier using crypto.randomUUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Validate that a string is a valid UUID
 */
export function isValidId(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
