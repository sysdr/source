import { describe, it, expect } from 'vitest';
import { ComplianceStatus, RevenueCategory } from './types';

describe('types', () => {
  describe('ComplianceStatus', () => {
    it('has expected values', () => {
      expect(ComplianceStatus.COMPLIANT).toBe('compliant');
      expect(ComplianceStatus.WARNING).toBe('warning');
      expect(ComplianceStatus.CRITICAL).toBe('critical');
    });
  });

  describe('RevenueCategory', () => {
    it('has expected values', () => {
      expect(RevenueCategory.EXPORT).toContain('Export');
      expect(RevenueCategory.DOMESTIC_MOR).toContain('Domestic');
      expect(RevenueCategory.OIDAR_RISK).toContain('OIDAR');
    });
  });
});
