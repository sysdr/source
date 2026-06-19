import { describe, it, expect } from 'vitest';
import { USD_TO_INR, ENTITIES } from './constants';

describe('constants', () => {
  describe('USD_TO_INR', () => {
    it('has a default exchange rate', () => {
      expect(typeof USD_TO_INR).toBe('number');
      expect(USD_TO_INR).toBeGreaterThan(0);
    });
  });

  describe('ENTITIES', () => {
    it('defines PARENT entity', () => {
      expect(ENTITIES.PARENT).toBeDefined();
      expect(ENTITIES.PARENT.name).toContain('India');
      expect(ENTITIES.PARENT.role).toBeDefined();
      expect(ENTITIES.PARENT.tax).toBeDefined();
    });

    it('defines SUBSIDIARY entity', () => {
      expect(ENTITIES.SUBSIDIARY).toBeDefined();
      expect(ENTITIES.SUBSIDIARY.name).toContain('US');
      expect(ENTITIES.SUBSIDIARY.role).toBeDefined();
      expect(ENTITIES.SUBSIDIARY.tax).toBeDefined();
    });
  });
});
