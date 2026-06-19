import React, { useState, useEffect, useRef } from 'react';
import { Transaction, RevenueCategory, type StripeAccountScope } from '../../types';
import {
  getRevenueData,
  setRevenueData,
  getStripeOrgConfig,
  setStripeOrgConfig,
  addStripeAccount,
  removeStripeAccount,
  updateStripeAccountName,
  updateStripeAccountScope,
  syncStripeAccountsFromApi,
  mergeStripeOrganisationAccountsFromApi,
  mergeStripeStandaloneAccountFromApi,
  mergeRevenueIntoTransactions,
  removeTransaction,
  getUIState,
  setUIState,
  StorageKeys,
} from '../../services/storageService';
import { getBaseCurrency, formatAmountInDisplay } from '../../services/currencyService';
import { runStripeSyncForAllAccounts, runStripeSyncForAccount, computeStripeActualsFromRevenue } from '../../services/stripeSyncService';
import { computeInvestorPitchMetrics } from '../../services/investorPitchMetricsService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';
import {
  parseSubstackCSV,
  importSubstackActuals,
  addSubstackManualEntry,
  computeSubstackActualsSummary,
} from '../../services/substackIngestionService';
import { useAllTransactions } from '../../hooks/useTransactions';
import AccountSettings from './AccountSettings';
import ReconcileView from './ReconcileView';
import SubstackImport from './SubstackImport';
import TransactionList from './TransactionList';

interface RevenueIngestionProps {
  stripeApiKey: string;
  setStripeApiKey: (key: string) => void;
  stripeAccountId: string;
  setStripeAccountId: (id: string) => void;
}

const buildStripeHeaders = (
  apiKey: string,
  contextAccountId: string | null | undefined,
  accountId?: string | null
): HeadersInit => {
  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': '2024-12-18.acacia',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const ctxId = contextAccountId?.trim();
  if (ctxId) {
    if (accountId?.trim() && accountId !== ctxId) {
      headers['Stripe-Context'] = `${ctxId}/${accountId.trim()}`;
    } else {
      headers['Stripe-Context'] = ctxId;
    }
  } else if (accountId?.trim()) {
    headers['Stripe-Account'] = accountId.trim();
  }
  return headers;
};

const fetchConnectedAccountsFromStripe = async (
  apiKey: string,
  onStatus: (msg: string) => void,
  contextAccountId?: string | null
): Promise<{ accounts: { id: string; name?: string }[]; source: 'connect' | 'standard' }> => {
  const allAccounts: { id: string; name?: string }[] = [];
  const headers = buildStripeHeaders(apiKey, contextAccountId);

  let lastId: string | null = null;
  let page = 1;

  while (true) {
    onStatus(`Fetching accounts page ${page}...`);
    const url = `https://api.stripe.com/v1/accounts?limit=100${lastId ? `&starting_after=${lastId}` : ''}`;
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Stripe API failed');
    }

    const result = await response.json();
    const batch = result.data || [];
    for (const acc of batch) {
      allAccounts.push({
        id: acc.id,
        name: acc.business_profile?.name || acc.settings?.dashboard?.display_name || acc.email || acc.id.slice(0, 12) + '...',
      });
    }
    if (!result.has_more || batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
    page++;
    if (page > 20) break;
  }

  if (allAccounts.length === 0) {
    onStatus('Fetching your account...');
    const accountResponse = await fetch('https://api.stripe.com/v1/account', { method: 'GET', headers });
    if (!accountResponse.ok) {
      const err = await accountResponse.json();
      throw new Error(err.error?.message || 'Stripe API failed');
    }
    const acc = await accountResponse.json();
    allAccounts.push({
      id: acc.id,
      name: acc.business_profile?.name || acc.settings?.dashboard?.display_name || acc.email || 'Primary',
    });
    return { accounts: allAccounts, source: 'standard' };
  }

  return { accounts: allAccounts, source: 'connect' };
};

const fetchOrganisationAccountsFromStripe = async (
  apiKey: string,
  onStatus: (msg: string) => void,
  contextAccountId: string | null
): Promise<{ id: string; name?: string }[]> => {
  if (!contextAccountId?.trim()) {
    throw new Error('Target account ID (acct_...) is required for organisation accounts. Add it in step 1b.');
  }
  const headers = buildStripeHeaders(apiKey, contextAccountId);
  const allAccounts: { id: string; name?: string }[] = [];
  let lastId: string | null = null;
  let page = 1;
  while (true) {
    onStatus(`Fetching organisation accounts page ${page}...`);
    const url = `https://api.stripe.com/v1/accounts?limit=100${lastId ? `&starting_after=${lastId}` : ''}`;
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Stripe API failed');
    }
    const result = await response.json();
    const batch = result.data || [];
    for (const acc of batch) {
      allAccounts.push({
        id: acc.id,
        name: acc.business_profile?.name || acc.settings?.dashboard?.display_name || acc.email || acc.id.slice(0, 12) + '...',
      });
    }
    if (!result.has_more || batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
    page++;
    if (page > 20) break;
  }
  return allAccounts;
};

const fetchStandardAccountFromStripe = async (
  apiKey: string,
  onStatus: (msg: string) => void
): Promise<{ id: string; name?: string }> => {
  onStatus('Fetching your account...');
  const headers = buildStripeHeaders(apiKey, null);
  const response = await fetch('https://api.stripe.com/v1/account', { method: 'GET', headers });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Stripe API failed');
  }
  const acc = await response.json();
  return {
    id: acc.id,
    name: acc.business_profile?.name || acc.settings?.dashboard?.display_name || acc.email || 'Primary',
  };
};

const fetchChargesFromStripe = async (
  apiKey: string,
  accountId: string | null,
  startTs: number,
  endTs: number,
  onStatus: (msg: string) => void,
  contextAccountId?: string | null
): Promise<any[]> => {
  const allCharges: any[] = [];
  let lastId: string | null = null;
  let page = 1;

  while (true) {
    onStatus(`Fetching page ${page}${accountId ? ` (${accountId.slice(0, 12)}...)` : ''}...`);
    const url = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${startTs}&created[lte]=${endTs}${lastId ? `&starting_after=${lastId}` : ''}&expand[]=data.customer&expand[]=data.balance_transaction`;
    const headers = buildStripeHeaders(apiKey, contextAccountId, accountId);

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Stripe API failed');
    }

    const result = await response.json();
    const batch = result.data || [];
    allCharges.push(...batch);
    if (!result.has_more || batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
    page++;
    if (page > 200) break; // safety cap — 200 pages × 100 = 20,000 charges max
  }
  return allCharges;
};

const RevenueIngestion: React.FC<RevenueIngestionProps> = ({
  stripeApiKey,
  setStripeApiKey,
  stripeAccountId,
  setStripeAccountId,
}) => {
  const savedRevenueData = getRevenueData();
  const stripeOrgConfig = getStripeOrgConfig();

  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetchingAccounts, setIsFetchingAccounts] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [reconcileResult, setReconcileResult] = useState<{ newInStripe: number; missingInStore: number; matched: number } | null>(null);

  const [startDate, setStartDate] = useState(savedRevenueData.startDate);
  const [endDate, setEndDate] = useState(savedRevenueData.endDate);

  const [transactions, setTransactionsState] = useState<Transaction[]>(() =>
    savedRevenueData.transactions
  );
  const [rawApiResponse, setRawApiResponse] = useState<string | null>(null);
  const [summary, setSummary] = useState({ export: 0, domestic: 0, risk: 0 });
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(savedRevenueData.lastSyncDate);

  const [contextAccountId, setContextAccountId] = useState(stripeOrgConfig.stripeContextAccountId || '');
  const isInitialMount = useRef(true);

  const [substackCsv, setSubstackCsv] = useState('');
  const [substackImporting, setSubstackImporting] = useState(false);
  const [substackImportResult, setSubstackImportResult] = useState<{ added: number; errors: string[] } | null>(null);
  const [showSubstackManual, setShowSubstackManual] = useState(false);
  const [substackManual, setSubstackManual] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', currency: 'USD', description: '', type: 'revenue' as 'revenue' | 'commission' | 'charge' });

  const [webhookEndpoints, setWebhookEndpoints] = useState<{ id: string; url: string; status: string; enabled_events?: string[] }[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookCreateUrl, setWebhookCreateUrl] = useState('');
  const [webhookCreateEvents, setWebhookCreateEvents] = useState('charge.succeeded, charge.updated');
  const [webhookCreateResult, setWebhookCreateResult] = useState<{ success: boolean; message: string; secret?: string } | null>(null);
  const [webhookSectionOpen, setWebhookSectionOpen] = useState(false);

  // useAllTransactions hook — React Query; used for the pitchMetrics memo so it always reflects latest data
  const { data: allTxnsFromQuery } = useAllTransactions();

  const getEffectiveContextForAccount = (accId: string | null): string | undefined => {
    const config = getStripeOrgConfig();
    if (accId === null) {
      return config.accountsSource === 'connect'
        ? config.stripeContextAccountId?.trim() || config.accounts[0]?.id || undefined
        : undefined;
    }
    const acc = config.accounts.find((a) => a.id === accId);
    return acc?.scope === 'organisation' ? config.stripeContextAccountId?.trim() || undefined : undefined;
  };

  useEffect(() => {
    if (showSettings) setContextAccountId(stripeOrgConfig.stripeContextAccountId || '');
  }, [showSettings, stripeOrgConfig.stripeContextAccountId]);

  const connectionStatus = (getStripeOrgConfig().apiKey || stripeApiKey).startsWith('sk_') ? 'connected' : 'disconnected';
  const accounts = stripeOrgConfig.accounts;

  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();

  const isCompleted = (t: Transaction) => t.status === 'Completed';

  const updateTable = (data: Transaction[], persist = true) => {
    setTransactionsState(data);
    const stats = data.filter(isCompleted).reduce(
      (acc, curr) => {
        const amt = curr.amount;
        if (curr.classification === RevenueCategory.EXPORT) acc.export += amt;
        else if (curr.classification === RevenueCategory.DOMESTIC_MOR) acc.domestic += amt;
        else if (curr.classification === RevenueCategory.OIDAR_RISK) acc.risk += amt;
        return acc;
      },
      { export: 0, domestic: 0, risk: 0 }
    );
    setSummary(stats);
    if (persist) {
      setRevenueData({
        transactions: data,
        lastSyncDate: new Date().toISOString(),
        startDate,
        endDate,
      });
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setRevenueData({ transactions, lastSyncDate, startDate, endDate });
  }, [startDate, endDate, transactions, lastSyncDate]);

  useEffect(() => {
    if (transactions.length > 0 && summary.export === 0 && summary.domestic === 0 && summary.risk === 0) {
      const stats = transactions.filter(isCompleted).reduce(
        (acc, curr) => {
          if (curr.classification === RevenueCategory.EXPORT) acc.export += curr.amount;
          else if (curr.classification === RevenueCategory.DOMESTIC_MOR) acc.domestic += curr.amount;
          else if (curr.classification === RevenueCategory.OIDAR_RISK) acc.risk += curr.amount;
          return acc;
        },
        { export: 0, domestic: 0, risk: 0 }
      );
      setSummary(stats);
    }
  }, []);

  useEffect(() => {
    setTransactionsState(savedRevenueData.transactions);
    setLastSyncDate(savedRevenueData.lastSyncDate);
    const stats = savedRevenueData.transactions.filter((t) => t.status === 'Completed').reduce(
      (acc, curr) => {
        if (curr.classification === RevenueCategory.EXPORT) acc.export += curr.amount;
        else if (curr.classification === RevenueCategory.DOMESTIC_MOR) acc.domestic += curr.amount;
        else if (curr.classification === RevenueCategory.OIDAR_RISK) acc.risk += curr.amount;
        return acc;
      },
      { export: 0, domestic: 0, risk: 0 }
    );
    setSummary(stats);
    if (savedRevenueData.transactions.length > 0) {
      mergeRevenueIntoTransactions(savedRevenueData.transactions);
      window.dispatchEvent(new Event('suez_data_updated'));
    }
  }, []);

  const handleSaveOrgConfig = () => {
    const config = getStripeOrgConfig();
    config.apiKey = stripeApiKey;
    config.stripeContextAccountId = contextAccountId.trim() || undefined;
    config.lastSavedAt = new Date().toISOString();
    if (stripeAccountId.trim() && !config.accounts.some((a) => a.id === stripeAccountId.trim())) {
      config.accounts = [...config.accounts, { id: stripeAccountId.trim(), name: 'Primary', addedAt: new Date().toISOString(), scope: 'standalone' }];
    }
    setStripeOrgConfig(config);
    setStripeAccountId(stripeAccountId);
    setShowSettings(false);
    alert('Stripe org config saved.');
  };

  const handleFetchAccounts = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) {
      setShowSettings(true);
      return;
    }
    setIsFetchingAccounts(true);
    setSyncStatus('Fetching connected accounts...');
    try {
      const { accounts: fetched, source } = await fetchConnectedAccountsFromStripe(config.apiKey, setSyncStatus, config.stripeContextAccountId);
      syncStripeAccountsFromApi(fetched, source);
      setSyncStatus(fetched.length > 0 ? `Found ${fetched.length} account(s).` : 'No accounts found.');
      if (fetched.length === 0) {
        alert('Could not fetch accounts. Please check your API key.');
      }
    } catch (error: any) {
      setSyncStatus(`Failed: ${error.message}`);
      const msg = error.message || '';
      if (msg.includes('Stripe-Context') || msg.includes('Organization API key')) {
        setShowSettings(true);
        alert('Organization API key detected. Please add your Target account ID (acct_...) in Settings, then try again.');
      } else {
        alert(`Stripe Error: ${error.message}`);
      }
    } finally {
      setIsFetchingAccounts(false);
    }
  };

  const handleFetchOrganisationAccounts = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) {
      setShowSettings(true);
      return;
    }
    setIsFetchingAccounts(true);
    setSyncStatus('Fetching organisation accounts...');
    try {
      const fetched = await fetchOrganisationAccountsFromStripe(config.apiKey, setSyncStatus, config.stripeContextAccountId ?? null);
      mergeStripeOrganisationAccountsFromApi(fetched);
      setSyncStatus(fetched.length > 0 ? `Found ${fetched.length} organisation account(s).` : 'No organisation accounts found.');
    } catch (error: any) {
      setSyncStatus(`Failed: ${error.message}`);
      const msg = error.message || '';
      if (msg.includes('Stripe-Context') || msg.includes('Organization API key') || msg.includes('Target account')) {
        setShowSettings(true);
        alert('Add your Target account ID (acct_...) in step 1b, then try again.');
      } else {
        alert(`Stripe Error: ${error.message}`);
      }
    } finally {
      setIsFetchingAccounts(false);
    }
  };

  const handleFetchStandardAccount = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) {
      setShowSettings(true);
      return;
    }
    setIsFetchingAccounts(true);
    setSyncStatus('Fetching your account...');
    try {
      const account = await fetchStandardAccountFromStripe(config.apiKey, setSyncStatus);
      mergeStripeStandaloneAccountFromApi(account);
      setSyncStatus(`Added account: ${account.name || account.id}.`);
    } catch (error: any) {
      setSyncStatus(`Failed: ${error.message}`);
      alert(`Stripe Error: ${error.message}`);
    } finally {
      setIsFetchingAccounts(false);
    }
  };

  const handleListWebhooks = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) return;
    setWebhookLoading(true);
    setWebhookCreateResult(null);
    try {
      const headers = buildStripeHeaders(config.apiKey, config.stripeContextAccountId) as Record<string, string>;
      delete headers['Content-Type'];
      const res = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=20', { method: 'GET', headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setWebhookEndpoints([]);
        setWebhookCreateResult({ success: false, message: (err as any).error?.message || 'Failed to list webhooks' });
        return;
      }
      const data = await res.json();
      const list = (data.data || []).map((e: any) => ({
        id: e.id,
        url: e.url || '',
        status: e.status || 'enabled',
        enabled_events: e.enabled_events || [],
      }));
      setWebhookEndpoints(list);
    } catch (e: any) {
      setWebhookEndpoints([]);
      setWebhookCreateResult({ success: false, message: e.message || 'Request failed' });
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleCreateWebhook = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_') || !webhookCreateUrl.trim()) {
      setWebhookCreateResult({ success: false, message: 'API key and webhook URL are required.' });
      return;
    }
    setWebhookLoading(true);
    setWebhookCreateResult(null);
    try {
      const events = webhookCreateEvents.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean);
      const body = new URLSearchParams();
      body.set('url', webhookCreateUrl.trim());
      events.forEach((e) => body.append('enabled_events[]', e));
      if (events.length === 0) body.append('enabled_events[]', 'charge.succeeded');
      const headers = buildStripeHeaders(config.apiKey, config.stripeContextAccountId) as Record<string, string>;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'POST', headers, body });
      const data = await res.json();
      if (data.error) {
        setWebhookCreateResult({ success: false, message: data.error.message || 'Create failed' });
        return;
      }
      setWebhookCreateResult({
        success: true,
        message: `Endpoint created: ${data.id}`,
        secret: data.secret ? `${data.secret.slice(0, 12)}...` : undefined,
      });
      setWebhookCreateUrl('');
      handleListWebhooks();
    } catch (e: any) {
      setWebhookCreateResult({ success: false, message: e.message || 'Request failed' });
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleFetch = async (accountId: string | null = null, forceFullSync?: boolean) => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) {
      setShowSettings(true);
      return;
    }

    setIsSyncing(true);
    setSyncStatus('Initiating...');
    setRawApiResponse(null);

    try {
      setRevenueData({ ...getRevenueData(), startDate, endDate });
      if (accountId) {
        setSyncStatus(`Fetching account ${accounts.find((a) => a.id === accountId)?.name || accountId}...`);
        const result = await runStripeSyncForAccount(accountId, { forceFullSync: forceFullSync ?? false });
        if (!result.success && result.error) throw new Error(result.error);
      } else {
        const result = await runStripeSyncForAllAccounts({ onStatus: setSyncStatus, forceFullSync: forceFullSync ?? false });
        if (!result.success && result.error && result.accountsSynced === 0) throw new Error(result.error);
        if (result.error && result.accountsSynced > 0) setSyncStatus(`Partial: ${result.accountsSynced} account(s) synced. ${result.error}`);
      }

      const rev = getRevenueData();
      updateTable(rev.transactions);
      setLastSyncDate(rev.lastSyncDate || new Date().toISOString());
      setRawApiResponse(
        JSON.stringify(
          {
            date_range: { start: startDate, end: endDate },
            transaction_count: rev.transactions.length,
          },
          null,
          2
        )
      );
      setSyncStatus('Sync complete. Data saved and populated across app.');
    } catch (error: any) {
      setSyncStatus(`Failed: ${error.message}`);
      const msg = error.message || '';
      if (msg.includes('Stripe-Context') || msg.includes('Organization API key')) {
        setShowSettings(true);
        alert('Organization API key detected. Please add your Target account ID (acct_...) in Settings, then try again.');
      } else {
        alert(`Stripe Error: ${error.message}`);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReconcile = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) {
      setShowSettings(true);
      return;
    }

    setIsReconciling(true);
    setShowReconcile(true);
    setReconcileResult(null);

    try {
      const startTs = Math.floor(new Date(startDate).getTime() / 1000);
      const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399;

      const config = getStripeOrgConfig();
      const idsToFetch = accounts.map((a) => a.id);
      const isStandardAccount = config.accountsSource === 'standard';
      const toFetch: (string | null)[] =
        isStandardAccount ? [null] : idsToFetch.length > 0 ? [null, ...idsToFetch] : [stripeAccountId.trim() || null];
      let liveCharges: any[] = [];

      for (const accId of toFetch) {
        const contextForAccount = getEffectiveContextForAccount(accId);
        const charges = await fetchChargesFromStripe(
          config.apiKey,
          accId,
          startTs,
          endTs,
          (msg) => setSyncStatus(msg),
          contextForAccount
        );
        liveCharges = [...liveCharges, ...charges];
      }

      const storedIds = new Set(transactions.filter((t) => t.stripeChargeId).map((t) => t.stripeChargeId));
      const liveIds = new Set(liveCharges.map((c) => c.id));

      const newInStripe = [...liveIds].filter((id) => !storedIds.has(id)).length;
      const missingInStore = [...storedIds].filter((id) => !liveIds.has(id)).length;
      const matched = liveCharges.filter((c) => storedIds.has(c.id)).length;

      setReconcileResult({ newInStripe, missingInStore, matched });
      setSyncStatus('Reconcile complete.');
    } catch (error: any) {
      setReconcileResult({ newInStripe: 0, missingInStore: 0, matched: 0 });
      alert(`Reconcile failed: ${error.message}`);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleReconcileAndMerge = async () => {
    await handleFetch(null);
    setShowReconcile(false);
    setReconcileResult(null);
  };

  // Use React Query data for pitch metrics when available, fall back to local state
  const txnsForMetrics = allTxnsFromQuery ?? transactions;

  const pitchMetrics = React.useMemo(
    () =>
      computeInvestorPitchMetrics(
        txnsForMetrics,
        getStripeOrgConfig().accounts,
        lastSyncDate,
        txnsForMetrics
      ),
    [txnsForMetrics, lastSyncDate]
  );

  const stripeActuals = React.useMemo(() => computeStripeActualsFromRevenue(transactions), [transactions]);
  const substackActuals = React.useMemo(() => computeSubstackActualsSummary(transactions), [transactions]);
  const combinedRevenue = stripeActuals.totalRevenue + substackActuals.totalRevenue;
  const combinedCommissions = stripeActuals.totalCommissions + substackActuals.totalCommissions;
  const combinedCharges = stripeActuals.totalCharges + substackActuals.totalCharges;

  const handleSubstackImport = async () => {
    const rows = parseSubstackCSV(substackCsv);
    if (rows.length === 0) { setSubstackImportResult({ added: 0, errors: ['No valid rows. Use CSV: date, amount [, currency] [, description] [, type]'] }); return; }
    setSubstackImporting(true);
    setSubstackImportResult(null);
    try {
      const result = await importSubstackActuals(rows);
      setSubstackImportResult(result);
      const rev = getRevenueData();
      updateTable(rev.transactions);
      setSubstackCsv('');
    } finally {
      setSubstackImporting(false);
    }
  };

  const handleSubstackManualAdd = async () => {
    const amount = parseFloat(substackManual.amount);
    if (!substackManual.date || isNaN(amount)) return;
    await addSubstackManualEntry({
      date: substackManual.date,
      amount,
      currency: substackManual.currency,
      description: substackManual.description || `Substack ${substackManual.type}`,
      type: substackManual.type,
    });
    const rev = getRevenueData();
    updateTable(rev.transactions);
    setSubstackManual({ date: new Date().toISOString().slice(0, 10), amount: '', currency: 'USD', description: '', type: 'revenue' });
    setShowSubstackManual(false);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
        <div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Revenue Ingestion</h2>
            <p className="text-slate-500 text-sm font-medium tracking-tight">FY 2025-26 Pipeline</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 px-2 border-r border-slate-100 last:border-0">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">From</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="text-xs font-bold text-slate-700 outline-none cursor-pointer" />
          </div>
          <div className="flex items-center gap-2 px-2 border-r border-slate-100 last:border-0">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">To</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="text-xs font-bold text-slate-700 outline-none cursor-pointer" />
          </div>
          <div className="flex gap-2 pl-2 flex-wrap">
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              {connectionStatus === 'disconnected' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping"></span>}
            </button>
            <button
              onClick={() => handleReconcile()}
              disabled={isSyncing || isReconciling || connectionStatus !== 'connected'}
              className="px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest border-2 border-slate-300 text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-50"
            >
              {isReconciling ? '...' : 'Reconcile'}
            </button>
            <button
              onClick={() => handleFetch(null, false)}
              disabled={isSyncing}
              className={`px-5 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-md flex items-center gap-2 ${isSyncing ? 'bg-slate-200 text-slate-400' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
              title="Fetch only new charges since last sync (efficient)"
            >
              {isSyncing ? <><span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>{syncStatus}</> : 'Sync new'}
            </button>
            <button
              onClick={() => handleFetch(null, true)}
              disabled={isSyncing}
              className="px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest border-2 border-slate-400 text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-50"
              title="Re-fetch full date range (use after changing dates or to fix data)"
            >
              Full refresh
            </button>
          </div>
        </div>
      </header>

      {/* Actuals summary: Stripe + Substack */}
      <div className="space-y-2">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Actuals (from Stripe &amp; Substack)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3">
          <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
            <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-0.5">Stripe · Charges</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(stripeActuals.totalCharges, baseCurrency, displayCurrency)}</p>
            <p className="text-[10px] text-slate-500">{stripeActuals.transactionCount} txns</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
            <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-0.5">Stripe · Commissions</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(stripeActuals.totalCommissions, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
            <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-0.5">Stripe · Revenue</p>
            <p className="text-lg font-black text-indigo-700">{formatAmountInDisplay(stripeActuals.totalRevenue, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Substack · Charges</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(substackActuals.totalCharges, baseCurrency, displayCurrency)}</p>
            <p className="text-[10px] text-slate-500">{substackActuals.count} txns</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Substack · Commissions</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(substackActuals.totalCommissions, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Substack · Revenue</p>
            <p className="text-lg font-black text-emerald-700">{formatAmountInDisplay(substackActuals.totalRevenue, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-slate-100 border-2 border-slate-300 p-4 rounded-xl col-span-2 md:col-span-3">
            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-0.5">Combined actuals</p>
            <p className="text-sm font-bold text-slate-700">Charges: {formatAmountInDisplay(combinedCharges, baseCurrency, displayCurrency)}</p>
            <p className="text-sm font-bold text-slate-700">Commissions: {formatAmountInDisplay(combinedCommissions, baseCurrency, displayCurrency)}</p>
            <p className="text-lg font-black text-slate-900 mt-1">Revenue: {formatAmountInDisplay(combinedRevenue, baseCurrency, displayCurrency)}</p>
          </div>
        </div>
      </div>

      {showSettings && (
        <AccountSettings
          stripeApiKey={stripeApiKey}
          setStripeApiKey={setStripeApiKey}
          stripeAccountId={stripeAccountId}
          setStripeAccountId={setStripeAccountId}
          contextAccountId={contextAccountId}
          setContextAccountId={setContextAccountId}
          isFetchingAccounts={isFetchingAccounts}
          isSyncing={isSyncing}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveOrgConfig}
          onFetchOrganisationAccounts={handleFetchOrganisationAccounts}
          onFetchStandardAccount={handleFetchStandardAccount}
          onFetchAccounts={handleFetchAccounts}
          onFetch={handleFetch}
          webhookEndpoints={webhookEndpoints}
          webhookLoading={webhookLoading}
          webhookCreateUrl={webhookCreateUrl}
          setWebhookCreateUrl={setWebhookCreateUrl}
          webhookCreateEvents={webhookCreateEvents}
          setWebhookCreateEvents={setWebhookCreateEvents}
          webhookCreateResult={webhookCreateResult}
          webhookSectionOpen={webhookSectionOpen}
          setWebhookSectionOpen={setWebhookSectionOpen}
          onListWebhooks={handleListWebhooks}
          onCreateWebhook={handleCreateWebhook}
        />
      )}

      {showReconcile && reconcileResult && (
        <ReconcileView
          reconcileResult={reconcileResult}
          onMerge={handleReconcileAndMerge}
          onClose={() => setShowReconcile(false)}
        />
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Key metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Gross Revenue</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(pitchMetrics.grossRevenue, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Net Revenue</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(pitchMetrics.netRevenue, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Gross Profit</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(pitchMetrics.grossProfit, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Net Profit</p>
            <p className="text-lg font-black text-slate-900">{formatAmountInDisplay(pitchMetrics.netProfit, baseCurrency, displayCurrency)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Paid subs</p>
            <p className="text-lg font-black text-slate-900">{pitchMetrics.paidSubscriberCount} <span className="text-xs font-bold text-emerald-600">({pitchMetrics.paidSubscriberGrowthPct >= 0 ? '+' : ''}{pitchMetrics.paidSubscriberGrowthPct.toFixed(1)}%)</span></p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Free subs</p>
            <p className="text-lg font-black text-slate-900">{pitchMetrics.freeSubscriberCount}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-indigo-500">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Next month (proj.)</p>
            <p className="text-lg font-black text-indigo-600">{pitchMetrics.futureProjections[0] ? formatAmountInDisplay(pitchMetrics.futureProjections[0].projectedRevenue, baseCurrency, displayCurrency) : '—'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Export Revenue (US/Global)</p>
          <h3 className="text-3xl font-black text-slate-900">{formatAmountInDisplay(summary.export, 'USD', displayCurrency)}</h3>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-indigo-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">MoR (Domestic)</p>
          <h3 className="text-3xl font-black text-slate-900">{formatAmountInDisplay(summary.domestic, 'USD', displayCurrency)}</h3>
        </div>
        <div className={`p-6 rounded-2xl border shadow-sm border-t-4 ${summary.risk > 0 ? 'bg-rose-50 border-rose-200 border-t-rose-600' : 'bg-white border-slate-200 border-t-slate-400'}`}>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">OIDAR GST Exposure</p>
          <h3 className={`text-3xl font-black ${summary.risk > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatAmountInDisplay(summary.risk, 'USD', displayCurrency)}</h3>
        </div>
      </div>

      <SubstackImport
        transactions={transactions}
        showSubstackManual={showSubstackManual}
        setShowSubstackManual={setShowSubstackManual}
        substackManual={substackManual}
        setSubstackManual={setSubstackManual}
        onManualAdd={handleSubstackManualAdd}
        substackCsv={substackCsv}
        setSubstackCsv={setSubstackCsv}
        substackImporting={substackImporting}
        substackImportResult={substackImportResult}
        onImportCsv={handleSubstackImport}
      />

      <TransactionList
        transactions={transactions}
        lastSyncDate={lastSyncDate}
        connectionStatus={connectionStatus}
        onShowSettings={() => setShowSettings(true)}
        onUpdateTable={updateTable}
      />

      {rawApiResponse && (
        <div className="bg-slate-900 rounded-2xl overflow-hidden">
          <div className="px-6 py-3 bg-slate-800 flex justify-between items-center">
            <span className="text-[10px] font-black text-indigo-400 uppercase">Sync Log</span>
            <button onClick={() => setRawApiResponse(null)} className="text-slate-500 hover:text-white text-xs">Hide</button>
          </div>
          <pre className="p-6 text-[10px] text-emerald-400 font-mono overflow-x-auto max-h-48">{rawApiResponse}</pre>
        </div>
      )}

      <div className="bg-indigo-900 p-8 rounded-3xl text-white">
        <h4 className="font-black text-xl mb-4 uppercase">Data flow</h4>
        <p className="text-slate-300 text-xs leading-relaxed">
          Fetched Stripe data is saved and merged into the main ledger. It appears in Dashboard, Accounting, Transfer Pricing, and Compliance Hub. Use Reconcile to compare stored data with live Stripe and merge any new charges.
        </p>
      </div>
    </div>
  );
};

export default RevenueIngestion;
