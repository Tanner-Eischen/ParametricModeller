/**
 * Generate a unique identifier using crypto.randomUUID
 */
export function generateId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

/**
 * Validate that a string is a valid UUID
 */
export function isValidId(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
