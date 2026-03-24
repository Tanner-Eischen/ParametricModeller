import { describe, it, expect } from 'vitest';
import { generateId, isValidId } from '../src/core/id';

describe('id', () => {
  describe('generateId', () => {
    it('should generate a valid UUID', () => {
      const id = generateId();
      expect(isValidId(id)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });

    it('should generate lowercase UUIDs', () => {
      const id = generateId();
      expect(id).toBe(id.toLowerCase());
    });
  });

  describe('isValidId', () => {
    it('should return true for valid UUIDs', () => {
      expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isValidId('')).toBe(false);
      expect(isValidId('not-a-uuid')).toBe(false);
      expect(isValidId('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isValidId('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
    });

    it('should accept uppercase UUIDs', () => {
      expect(isValidId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });
  });
});
