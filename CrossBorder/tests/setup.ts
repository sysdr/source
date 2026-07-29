import '@testing-library/jest-dom/vitest';

/**
 * Node 25+ may expose a broken experimental localStorage (`--localstorage-file`
 * without a path) that shadows jsdom's Storage. Replace it with a Storage
 * subclass so `Storage.prototype` spies in unit tests still intercept calls.
 */
function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();

  class MemoryStorage implements Storage {
    get length() {
      return store.size;
    }

    clear(): void {
      store.clear();
    }

    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    }

    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    }

    removeItem(key: string): void {
      store.delete(key);
    }

    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    }
  }

  // Attach to Storage.prototype so vi.spyOn(Storage.prototype, 'getItem') works
  // the same way it does against jsdom's Storage instances.
  if (typeof Storage !== 'undefined') {
    Object.setPrototypeOf(MemoryStorage.prototype, Storage.prototype);
  }

  const local = new MemoryStorage();
  const session = new MemoryStorage();

  Object.defineProperty(globalThis, 'localStorage', {
    value: local,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: session,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: local,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: session,
      configurable: true,
      writable: true,
    });
  }
}

const ls = globalThis.localStorage;
if (!ls || typeof ls.setItem !== 'function' || typeof ls.getItem !== 'function') {
  installMemoryLocalStorage();
}
