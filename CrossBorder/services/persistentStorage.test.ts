import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setIfChanged,
  get,
  remove,
  hasChanged,
  hashValue,
  clearHashes,
  PersistentKeys,
} from './persistentStorage';

const HASHES_KEY = 'suez_ps_hashes';
const ls: Record<string, string> = {};

beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => ls[key] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
    ls[key] = value;
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
    delete ls[key];
  });
  Object.keys(ls).forEach((k) => delete ls[k]);
});

describe('persistentStorage', () => {
  describe('hashValue', () => {
    it('produces same hash for same value', () => {
      expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    });
    it('produces different hash for different value', () => {
      expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
    });
  });

  describe('setIfChanged', () => {
    it('writes when key is new', () => {
      const written = setIfChanged('k1', { x: 1 });
      expect(written).toBe(true);
      expect(get<{ x: number }>('k1')).toEqual({ x: 1 });
    });
    it('skips write when value unchanged', () => {
      setIfChanged('k2', { a: 1 });
      const written = setIfChanged('k2', { a: 1 });
      expect(written).toBe(false);
      expect(get<{ a: number }>('k2')).toEqual({ a: 1 });
    });
    it('writes when value changed', () => {
      setIfChanged('k3', { a: 1 });
      const written = setIfChanged('k3', { a: 2 });
      expect(written).toBe(true);
      expect(get<{ a: number }>('k3')).toEqual({ a: 2 });
    });
    it('force option always writes', () => {
      setIfChanged('k4', { a: 1 });
      const written = setIfChanged('k4', { a: 1 }, { force: true });
      expect(written).toBe(true);
    });
  });

  describe('get', () => {
    it('returns null for missing key', () => {
      expect(get('missing')).toBeNull();
    });
    it('returns parsed value', () => {
      setIfChanged('g1', { n: 42 });
      expect(get<{ n: number }>('g1')).toEqual({ n: 42 });
    });
  });

  describe('remove', () => {
    it('removes key and its hash', () => {
      setIfChanged('r1', { x: 1 });
      remove('r1');
      expect(get('r1')).toBeNull();
      const hashes = JSON.parse(ls[HASHES_KEY] || '{}');
      expect(hashes.r1).toBeUndefined();
    });
  });

  describe('hasChanged', () => {
    it('returns true when key missing or value different', () => {
      expect(hasChanged('h1', { a: 1 })).toBe(true);
      setIfChanged('h1', { a: 1 });
      expect(hasChanged('h1', { a: 2 })).toBe(true);
    });
    it('returns false when value same', () => {
      setIfChanged('h2', { a: 1 });
      expect(hasChanged('h2', { a: 1 })).toBe(false);
    });
  });

  describe('clearHashes', () => {
    it('removes hash index', () => {
      setIfChanged('c1', 1);
      expect(ls[HASHES_KEY]).toBeDefined();
      clearHashes();
      expect(ls[HASHES_KEY]).toBeUndefined();
    });
  });

  describe('PersistentKeys', () => {
    it('fxRate key is deterministic', () => {
      expect(PersistentKeys.fxRate('2025-01-15', 'USD', 'INR')).toBe('suez_fx_2025-01-15_USD_INR');
    });
    it('investorMetrics key includes orgId', () => {
      expect(PersistentKeys.investorMetrics('org-123')).toBe('suez_calc_investor_metrics_org-123');
    });
  });
});
