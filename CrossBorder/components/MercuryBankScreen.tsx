/**
 * MercuryBankScreen – Mercury Bank integration management screen.
 *
 * Handles API token setup, account overview, transaction viewing/filtering,
 * and incremental sync for the US entity (Mercury operates in USD).
 *
 * Design: CrossBorder Design System
 *   CSS tokens — var(--surface-base), var(--n-200), var(--accent), etc.
 *   .form-input, .btn, .btn-primary, .btn-danger, .badge, .card, .data-table
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getTransactions } from '../services/storageService';
import {
  getMercuryConfig,
  setMercuryConfig,
  getMercuryCursors,
  fetchMercuryAccounts,
  syncMercuryAccount,
  runMercurySyncForAllAccounts,
  clearMercuryCursors,
  type MercuryAccount,
  type MercuryConfig,
} from '../services/mercuryService';
import type { Transaction } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const Spinner: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <span
    className="spinner"
    style={{ width: size, height: size, flexShrink: 0, display: 'inline-block' }}
    aria-hidden="true"
  />
);

// ── Main Component ────────────────────────────────────────────────────────────

const MercuryBankScreen: React.FC = () => {
  // ── State ──────────────────────────────────────────────────────────────────

  const [apiToken, setApiToken] = useState<string>('');
  const [tokenInput, setTokenInput] = useState<string>('');
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
  const [showTokenSetup, setShowTokenSetup] = useState<boolean>(false);
  const [accounts, setAccounts] = useState<MercuryAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [syncSuccess, setSyncSuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string>('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Filters
  const [filterAccount, setFilterAccount] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'Income' | 'Expense'>('all');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Settings
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [forceFullSync, setForceFullSync] = useState<boolean>(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState<boolean>(false);

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadTransactions = useCallback(() => {
    const all = getTransactions();
    setTransactions(all.filter((t) => t.source === 'Mercury'));
  }, []);

  const loadConfig = useCallback(async () => {
    const config = getMercuryConfig();
    setApiToken(config.apiToken);
    setLastSyncAt(config.lastSyncAt);
    setShowTokenSetup(!config.apiToken);

    if (config.apiToken) {
      try {
        const accs = await fetchMercuryAccounts(config.apiToken);
        setAccounts(accs);
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadTransactions();
  }, [loadConfig, loadTransactions]);

  useEffect(() => {
    const handler = () => {
      loadTransactions();
      const config = getMercuryConfig();
      setLastSyncAt(config.lastSyncAt);
    };
    window.addEventListener('suez_data_updated', handler);
    return () => window.removeEventListener('suez_data_updated', handler);
  }, [loadTransactions]);

  // ── Connect token ──────────────────────────────────────────────────────────

  const handleConnect = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setError('');
    setIsSyncing(true);
    try {
      const accs = await fetchMercuryAccounts(token);
      const config: MercuryConfig = {
        apiToken: token,
        lastSyncAt: null,
        accounts: accs.map((a) => ({
          id: a.id,
          name: a.nickname || a.name,
          addedAt: new Date().toISOString(),
        })),
      };
      setMercuryConfig(config);
      setApiToken(token);
      setAccounts(accs);
      setShowTokenSetup(false);
      setTokenInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Sync all accounts ──────────────────────────────────────────────────────

  const handleSyncAll = async () => {
    setIsSyncing(true);
    setSyncStatus('Starting sync…');
    setSyncSuccess(null);
    setError('');
    try {
      const result = await runMercurySyncForAllAccounts({
        forceFullSync,
        onStatus: setSyncStatus,
      });
      if (result.success) {
        setSyncSuccess(true);
        setSyncStatus(`Synced ${result.transactionsAdded} new transaction${result.transactionsAdded !== 1 ? 's' : ''} across ${result.accountsSynced} account${result.accountsSynced !== 1 ? 's' : ''}`);
      } else {
        setSyncSuccess(false);
        setError(result.error || 'Sync failed');
        setSyncStatus('');
      }
      loadTransactions();
      const config = getMercuryConfig();
      setLastSyncAt(config.lastSyncAt);
    } catch (err) {
      setSyncSuccess(false);
      setError(err instanceof Error ? err.message : String(err));
      setSyncStatus('');
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Sync single account ────────────────────────────────────────────────────

  const handleSyncAccount = async (accountId: string, accountName: string) => {
    setSyncingAccountId(accountId);
    setSyncStatus(`Syncing ${accountName}…`);
    setSyncSuccess(null);
    setError('');
    try {
      const result = await syncMercuryAccount(apiToken, accountId, accountName, { forceFullSync });
      setSyncSuccess(true);
      setSyncStatus(`${accountName}: +${result.added} new transaction${result.added !== 1 ? 's' : ''}`);
      loadTransactions();
      const config = getMercuryConfig();
      setLastSyncAt(config.lastSyncAt);
    } catch (err) {
      setSyncSuccess(false);
      setError(err instanceof Error ? err.message : String(err));
      setSyncStatus('');
    } finally {
      setSyncingAccountId(null);
    }
  };

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const handleDisconnect = () => {
    setMercuryConfig({ apiToken: '', lastSyncAt: null, accounts: [] });
    clearMercuryCursors();
    setApiToken('');
    setAccounts([]);
    setShowTokenSetup(true);
    setShowDisconnectConfirm(false);
    setSyncStatus('');
    setSyncSuccess(null);
    setError('');
  };

  // ── Filtered transactions ──────────────────────────────────────────────────

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (filterAccount && t.id !== filterAccount) {
        // filter by account: check if the transaction matches the account
        const inAccount = accounts.find((a) =>
          filterAccount ? t.narration?.includes(a.id) || filterAccount === '' : true,
        );
        if (filterAccount && !inAccount) {
          // Simple approach: filter by transaction description containing account name
          const acc = accounts.find((a) => a.id === filterAccount);
          if (acc) {
            const matchesAcc =
              t.description.toLowerCase().includes(acc.name.toLowerCase()) ||
              (acc.nickname && t.description.toLowerCase().includes(acc.nickname.toLowerCase()));
            if (!matchesAcc) return false;
          }
        }
      }
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        if (
          !t.description.toLowerCase().includes(q) &&
          !t.category.toLowerCase().includes(q) &&
          !(t.narration || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, filterAccount, filterType, dateFrom, dateTo, filterSearch, accounts]);

  const totalCredits = useMemo(
    () => filteredTransactions.filter((t) => t.type === 'Income').reduce((s, t) => s + t.amount, 0),
    [filteredTransactions],
  );
  const totalDebits = useMemo(
    () => filteredTransactions.filter((t) => t.type === 'Expense').reduce((s, t) => s + t.amount, 0),
    [filteredTransactions],
  );

  // ── Export CSV ─────────────────────────────────────────────────────────────

  const handleExportCsv = () => {
    const header = 'Date,Description,Category,Amount,Type,Status,Narration';
    const rows = filteredTransactions.map((t) =>
      [
        t.date,
        `"${t.description.replace(/"/g, '""')}"`,
        `"${t.category}"`,
        t.amount.toFixed(2),
        t.type,
        t.status,
        `"${(t.narration || '').replace(/"/g, '""')}"`,
      ].join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mercury-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Cursors for last-synced display ───────────────────────────────────────

  const cursors = getMercuryCursors();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Page header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Mercury Bank
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {lastSyncAt
              ? `Last synced ${fmtDate(lastSyncAt)}`
              : 'Not yet synced'}
          </p>
        </div>

        {apiToken && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isSyncing && <Spinner size={16} />}
            <button
              className="btn btn-primary"
              onClick={handleSyncAll}
              disabled={isSyncing}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {isSyncing ? 'Syncing…' : 'Sync All'}
            </button>
          </div>
        )}
      </div>

      {/* ── Sync status message ── */}
      {syncStatus && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            background: syncSuccess === true
              ? 'var(--success-soft, #ecfdf5)'
              : syncSuccess === false
                ? 'var(--danger-soft, #fef2f2)'
                : 'var(--surface-raised, #f8fafc)',
            color: syncSuccess === true
              ? 'var(--success, #059669)'
              : syncSuccess === false
                ? 'var(--danger, #dc2626)'
                : 'var(--text-secondary)',
            border: `1px solid ${syncSuccess === true ? 'var(--success-border, #a7f3d0)' : syncSuccess === false ? 'var(--danger-border, #fecaca)' : 'var(--border)'}`,
          }}
        >
          {syncSuccess === true && '✓ '}{syncStatus}
        </div>
      )}

      {/* ── Error message ── */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            background: 'var(--danger-soft, #fef2f2)',
            color: 'var(--danger, #dc2626)',
            border: '1px solid var(--danger-border, #fecaca)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Token setup panel ── */}
      {showTokenSetup && (
        <div
          className="card"
          style={{
            marginBottom: 24,
            padding: 24,
            border: '1px solid var(--accent-soft, #dbeafe)',
            background: 'var(--accent-surface, #eff6ff)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'var(--accent, #1246D6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#fff',
                fontSize: 18,
              }}
            >
              🏦
            </div>
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                Connect Mercury Bank
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                Connect your Mercury bank account to automatically sync US entity revenue and expenses.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                className="form-input"
                type={showTokenInput ? 'text' : 'password'}
                placeholder="Mercury API Token (generate at app.mercury.com/settings/api)"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                style={{ width: '100%', paddingRight: 40, boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowTokenInput((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: 'var(--text-muted)',
                  fontSize: 14,
                }}
                aria-label={showTokenInput ? 'Hide token' : 'Show token'}
              >
                {showTokenInput ? '🙈' : '👁'}
              </button>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={isSyncing || !tokenInput.trim()}
            >
              {isSyncing ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {/* ── Accounts section ── */}
      {apiToken && (
        <div style={{ marginBottom: 28 }}>
          <h2
            style={{
              margin: '0 0 12px',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Accounts
          </h2>

          {accounts.length === 0 ? (
            <div
              className="card"
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No accounts found. Check your API token has read permissions.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 12,
                overflowX: 'auto',
                paddingBottom: 4,
              }}
            >
              {accounts.map((account) => {
                const isSyncingThis = syncingAccountId === account.id;
                return (
                  <div
                    key={account.id}
                    className="card"
                    style={{
                      minWidth: 220,
                      maxWidth: 260,
                      flex: '0 0 auto',
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {account.nickname || account.name}
                      </span>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background:
                            account.status === 'active'
                              ? '#059669'
                              : account.status === 'suspended'
                                ? '#dc2626'
                                : 'var(--n-200)',
                          flexShrink: 0,
                        }}
                        title={account.status}
                      />
                    </div>

                    <div>
                      <span
                        className="badge"
                        style={{
                          fontSize: 10,
                          textTransform: 'capitalize',
                          background: 'var(--surface-raised)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                          padding: '1px 6px',
                          borderRadius: 4,
                        }}
                      >
                        {account.type.replace('_', ' ')}
                      </span>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 800,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--text-primary)',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {fmtUsd(account.availableBalance)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                        Available balance
                      </div>
                    </div>

                    {account.currentBalance !== account.availableBalance && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Current: {fmtUsd(account.currentBalance)}
                      </div>
                    )}

                    {cursors[account.id] && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        Synced to {fmtDate(cursors[account.id])}
                      </div>
                    )}

                    <button
                      className="btn"
                      style={{ marginTop: 4, fontSize: 11, padding: '4px 10px' }}
                      onClick={() => handleSyncAccount(account.id, account.nickname || account.name)}
                      disabled={isSyncingThis || isSyncing}
                    >
                      {isSyncingThis ? <><Spinner /> Syncing…</> : 'Sync'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Transactions section ── */}
      {apiToken && (
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Transactions
            </h2>
            <button
              className="btn"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={handleExportCsv}
              disabled={filteredTransactions.length === 0}
            >
              Export CSV
            </button>
          </div>

          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {accounts.length > 0 && (
              <select
                className="form-input"
                style={{ fontSize: 12, padding: '6px 10px', minWidth: 140 }}
                value={filterAccount}
                onChange={(e) => setFilterAccount(e.target.value)}
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nickname || a.name}
                  </option>
                ))}
              </select>
            )}

            {/* Type toggle */}
            <div
              style={{
                display: 'flex',
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}
            >
              {(['all', 'Income', 'Expense'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12,
                    border: 'none',
                    cursor: 'pointer',
                    background: filterType === t ? 'var(--accent, #1246D6)' : 'var(--surface-base)',
                    color: filterType === t ? '#fff' : 'var(--text-secondary)',
                    fontWeight: filterType === t ? 700 : 400,
                    transition: 'background 0.15s',
                  }}
                >
                  {t === 'all' ? 'All' : t === 'Income' ? 'Credits' : 'Debits'}
                </button>
              ))}
            </div>

            <input
              className="form-input"
              type="date"
              style={{ fontSize: 12, padding: '6px 10px' }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="From date"
            />
            <input
              className="form-input"
              type="date"
              style={{ fontSize: 12, padding: '6px 10px' }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
            />

            <input
              className="form-input"
              type="search"
              placeholder="Search…"
              style={{ fontSize: 12, padding: '6px 10px', minWidth: 160 }}
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
          </div>

          {/* Summary chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 20,
                background: 'var(--surface-raised)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
            </span>
            <span
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 20,
                background: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
              }}
            >
              + {fmtUsd(totalCredits)}
            </span>
            <span
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 20,
                background: '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
              }}
            >
              - {fmtUsd(totalDebits)}
            </span>
          </div>

          {/* Transactions table */}
          {transactions.length === 0 ? (
            <div
              className="card"
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No transactions synced yet. Click Sync to fetch transactions.
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div
              className="card"
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No transactions match your filters.
            </div>
          ) : (
            <div className="card" style={{ overflow: 'auto', padding: 0 }}>
              <table
                className="data-table"
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Description</th>
                    <th style={thStyle}>Category</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <React.Fragment key={t.id}>
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={tdStyle}>{fmtDate(t.date)}</td>
                        <td style={{ ...tdStyle, maxWidth: 240 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.description}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: 'var(--surface-raised)',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.category}
                          </span>
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 700,
                            color: t.type === 'Income' ? '#059669' : '#dc2626',
                          }}
                        >
                          {t.type === 'Income' ? '+' : '-'}
                          {fmtUsd(t.amount)}
                        </td>
                        <td style={tdStyle}>
                          <StatusBadge status={t.status as 'Completed' | 'Pending' | 'Failed'} />
                        </td>
                      </tr>
                      {t.narration && (
                        <tr style={{ background: 'var(--surface-raised)' }}>
                          <td colSpan={5} style={{ padding: '2px 12px 6px 12px' }}>
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--text-muted)',
                                fontStyle: 'italic',
                              }}
                            >
                              {t.narration}
                            </span>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Settings section ── */}
      {apiToken && (
        <div>
          <button
            className="btn"
            style={{
              fontSize: 11,
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 12,
            }}
            onClick={() => setShowSettings((v) => !v)}
          >
            <span>{showSettings ? '▲' : '▼'}</span>
            Sync Settings
          </button>

          {showSettings && (
            <div
              className="card"
              style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {/* Force full re-sync toggle */}
              <div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={forceFullSync}
                    onChange={(e) => setForceFullSync(e.target.checked)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      Force full re-sync
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--warning, #d97706)',
                        marginTop: 2,
                      }}
                    >
                      Re-fetches all historical transactions. May create duplicates if transactions
                      were manually edited.
                    </div>
                  </div>
                </label>
              </div>

              {/* Per-account last synced */}
              {accounts.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      marginBottom: 8,
                    }}
                  >
                    Last synced per account
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {accounts.map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          padding: '6px 10px',
                          borderRadius: 6,
                          background: 'var(--surface-raised)',
                        }}
                      >
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {a.nickname || a.name}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {cursors[a.id] ? fmtDate(cursors[a.id]) : 'Never'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disconnect button */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                {!showDisconnectConfirm ? (
                  <button
                    className="btn btn-danger"
                    style={{ fontSize: 12 }}
                    onClick={() => setShowDisconnectConfirm(true)}
                  >
                    Disconnect Mercury
                  </button>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      This will remove the API token and all account links. Synced transactions will
                      remain.
                    </span>
                    <button
                      className="btn btn-danger"
                      style={{ fontSize: 12 }}
                      onClick={handleDisconnect}
                    >
                      Confirm Disconnect
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 12 }}
                      onClick={() => setShowDisconnectConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Status badge helper ───────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: 'Completed' | 'Pending' | 'Failed' }> = ({ status }) => {
  const styles: Record<string, React.CSSProperties> = {
    Completed: {
      background: '#ecfdf5',
      color: '#059669',
      border: '1px solid #a7f3d0',
    },
    Pending: {
      background: '#fffbeb',
      color: '#d97706',
      border: '1px solid #fde68a',
    },
    Failed: {
      background: '#fef2f2',
      color: '#dc2626',
      border: '1px solid #fecaca',
    },
  };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        ...(styles[status] || styles.Completed),
      }}
    >
      {status}
    </span>
  );
};

// ── Table style constants ─────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  background: 'var(--surface-raised)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '9px 12px',
  verticalAlign: 'middle',
  color: 'var(--text-secondary)',
  fontSize: 12,
};

export default MercuryBankScreen;
