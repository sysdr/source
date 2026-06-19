import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storage, StorageKeys } from './storageService';

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

describe('storageService', () => {
  describe('storage.get', () => {
    it('returns null for missing key', () => {
      expect(storage.get(StorageKeys.COMPANY_PROFILE)).toBeNull();
    });

    it('returns parsed JSON for stored value', () => {
      const value = { foo: 'bar', count: 42 };
      storage.set(StorageKeys.COMPANY_PROFILE, value);
      expect(storage.get(StorageKeys.COMPANY_PROFILE)).toEqual(value);
    });

    it('returns null for invalid JSON', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      ls[StorageKeys.COMPANY_PROFILE] = 'not json {';
      expect(storage.get(StorageKeys.COMPANY_PROFILE)).toBeNull();
      spy.mockRestore();
    });
  });

  describe('storage.set', () => {
    it('stores value as JSON', () => {
      const value = { id: '1', name: 'Test' };
      storage.set(StorageKeys.COMPANY_PROFILE, value);
      expect(ls[StorageKeys.COMPANY_PROFILE]).toBe(JSON.stringify(value));
    });

    it('stores primitives', () => {
      storage.set(StorageKeys.ONBOARDED, true);
      expect(storage.get(StorageKeys.ONBOARDED)).toBe(true);
    });
  });

  describe('storage.remove', () => {
    it('removes key', () => {
      storage.set(StorageKeys.COMPANY_PROFILE, { x: 1 });
      expect(storage.get(StorageKeys.COMPANY_PROFILE)).not.toBeNull();
      storage.remove(StorageKeys.COMPANY_PROFILE);
      expect(storage.get(StorageKeys.COMPANY_PROFILE)).toBeNull();
    });
  });

  describe('storage.clear', () => {
    it('removes all storage keys', () => {
      storage.set(StorageKeys.COMPANY_PROFILE, { a: 1 });
      storage.set(StorageKeys.ONBOARDED, true);
      storage.clear();
      expect(storage.get(StorageKeys.COMPANY_PROFILE)).toBeNull();
      expect(storage.get(StorageKeys.ONBOARDED)).toBeNull();
    });
  });
});
