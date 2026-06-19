import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getDisplayCurrency, getBaseCurrency, type BaseCurrency } from '../services/currencyService';
import { getUIState, setUIState, StorageKeys } from '../services/storageService';

type DisplayCurrencyContextValue = {
  displayCurrency: BaseCurrency;
  setDisplayCurrency: (c: BaseCurrency) => void;
};

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null);

export function DisplayCurrencyProvider({ children }: { children: React.ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<BaseCurrency>(
    () => getUIState(StorageKeys.UI_DISPLAY_CURRENCY, getBaseCurrency()) as BaseCurrency
  );

  const setDisplayCurrency = useCallback((c: BaseCurrency) => {
    setUIState(StorageKeys.UI_DISPLAY_CURRENCY, c);
    setDisplayCurrencyState(c);
    window.dispatchEvent(new CustomEvent('suez_display_currency_changed', { detail: { displayCurrency: c } }));
  }, []);

  useEffect(() => {
    const sync = () => setDisplayCurrencyState(getDisplayCurrency());
    window.addEventListener('suez_display_currency_changed', sync);
    return () => window.removeEventListener('suez_display_currency_changed', sync);
  }, []);

  return (
    <DisplayCurrencyContext.Provider value={{ displayCurrency, setDisplayCurrency }}>
      {children}
    </DisplayCurrencyContext.Provider>
  );
}

export function useDisplayCurrency(): DisplayCurrencyContextValue {
  const ctx = useContext(DisplayCurrencyContext);
  if (!ctx) {
    return {
      displayCurrency: getDisplayCurrency(),
      setDisplayCurrency: (c: BaseCurrency) => {
        setUIState(StorageKeys.UI_DISPLAY_CURRENCY, c);
        window.dispatchEvent(new CustomEvent('suez_display_currency_changed', { detail: { displayCurrency: c } }));
      },
    };
  }
  return ctx;
}

export function CurrencySelector() {
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  return (
    <div
      className="flex p-1 rounded-xl font-heading font-semibold text-xs"
      style={{ background: 'var(--border-muted)' }}
      role="group"
      aria-label="Display currency"
    >
      <button
        type="button"
        onClick={() => setDisplayCurrency('INR')}
        className={`px-4 py-2 rounded-lg transition-all duration-200 ${
          displayCurrency === 'INR'
            ? 'text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
        style={displayCurrency === 'INR' ? { background: 'var(--bg-sidebar)' } : undefined}
      >
        INR
      </button>
      <button
        type="button"
        onClick={() => setDisplayCurrency('USD')}
        className={`px-4 py-2 rounded-lg transition-all duration-200 ${
          displayCurrency === 'USD'
            ? 'text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
        style={displayCurrency === 'USD' ? { background: 'var(--bg-sidebar)' } : undefined}
      >
        USD
      </button>
    </div>
  );
}
