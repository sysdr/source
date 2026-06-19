import React from 'react';
import type { StripeAccountScope } from '../../types';
import {
  getStripeOrgConfig,
  addStripeAccount,
  removeStripeAccount,
  updateStripeAccountName,
  updateStripeAccountScope,
} from '../../services/storageService';

interface AccountSettingsProps {
  stripeApiKey: string;
  setStripeApiKey: (key: string) => void;
  stripeAccountId: string;
  setStripeAccountId: (id: string) => void;
  contextAccountId: string;
  setContextAccountId: (v: string) => void;
  isFetchingAccounts: boolean;
  isSyncing: boolean;
  onClose: () => void;
  onSave: () => void;
  onFetchOrganisationAccounts: () => void;
  onFetchStandardAccount: () => void;
  onFetchAccounts: () => void;
  onFetch: (accountId: string | null) => void;
  webhookEndpoints: { id: string; url: string; status: string; enabled_events?: string[] }[];
  webhookLoading: boolean;
  webhookCreateUrl: string;
  setWebhookCreateUrl: (v: string) => void;
  webhookCreateEvents: string;
  setWebhookCreateEvents: (v: string) => void;
  webhookCreateResult: { success: boolean; message: string; secret?: string } | null;
  webhookSectionOpen: boolean;
  setWebhookSectionOpen: (v: boolean) => void;
  onListWebhooks: () => void;
  onCreateWebhook: () => void;
}

const AccountSettings: React.FC<AccountSettingsProps> = ({
  stripeApiKey,
  setStripeApiKey,
  stripeAccountId,
  setStripeAccountId,
  contextAccountId,
  setContextAccountId,
  isFetchingAccounts,
  isSyncing,
  onClose,
  onSave,
  onFetchOrganisationAccounts,
  onFetchStandardAccount,
  onFetchAccounts,
  onFetch,
  webhookEndpoints,
  webhookLoading,
  webhookCreateUrl,
  setWebhookCreateUrl,
  webhookCreateEvents,
  setWebhookCreateEvents,
  webhookCreateResult,
  webhookSectionOpen,
  setWebhookSectionOpen,
  onListWebhooks,
  onCreateWebhook,
}) => {
  const stripeOrgConfig = getStripeOrgConfig();
  const accounts = stripeOrgConfig.accounts;

  const [newAccountId, setNewAccountId] = React.useState('');
  const [newAccountName, setNewAccountName] = React.useState('');
  const [newAccountScope, setNewAccountScope] = React.useState<StripeAccountScope>('standalone');
  const [editingAccountId, setEditingAccountId] = React.useState<string | null>(null);
  const [editingAccountName, setEditingAccountName] = React.useState('');

  const handleAddAccount = () => {
    if (!newAccountId.trim()) return;
    addStripeAccount(newAccountId.trim(), newAccountName.trim() || undefined, newAccountScope);
    setNewAccountId('');
    setNewAccountName('');
  };

  const handleStartEditAccount = (acc: { id: string; name?: string }) => {
    setEditingAccountId(acc.id);
    setEditingAccountName(acc.name || '');
  };

  const handleSaveAccountName = () => {
    if (editingAccountId && editingAccountName.trim()) {
      updateStripeAccountName(editingAccountId, editingAccountName.trim());
    }
    setEditingAccountId(null);
    setEditingAccountName('');
  };

  return (
    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-2xl max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-1">Stripe configuration</h3>
          <p className="text-sm text-slate-500 font-medium">Connect and fetch data from organisation accounts and standalone accounts.</p>
        </div>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors text-2xl font-light">×</button>
      </div>

      <div className="p-6 rounded-2xl bg-indigo-50 border border-indigo-100 space-y-4">
        <h4 className="text-sm font-black text-indigo-900 uppercase tracking-tight flex items-center gap-2">
          <span className="bg-indigo-600 text-white p-1 rounded-md text-[10px]">1</span>
          Organisation API Key (sk_...)
        </h4>
        <input
          type="password"
          value={stripeApiKey}
          onChange={(e) => setStripeApiKey(e.target.value)}
          placeholder="sk_live_... or sk_test_..."
          className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-100 bg-white font-mono text-sm shadow-inner"
        />
      </div>

      <div className="p-6 rounded-2xl bg-amber-50 border border-amber-100 space-y-4">
        <h4 className="text-sm font-black text-amber-900 uppercase tracking-tight flex items-center gap-2">
          <span className="bg-amber-600 text-white p-1 rounded-md text-[10px]">1b</span>
          Target account ID (for Organisation keys only)
        </h4>
        <p className="text-xs text-amber-800">When using an Organisation API key, set your target account (acct_...) so we can list and fetch accounts under the organisation.</p>
        <input
          type="text"
          value={contextAccountId}
          onChange={(e) => setContextAccountId(e.target.value)}
          placeholder="acct_..."
          className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-amber-100 bg-white font-mono text-sm shadow-inner"
        />
      </div>

      <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 space-y-4">
        <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
          <span className="bg-slate-600 text-white p-1 rounded-md text-[10px]">2</span>
          Connected Accounts
        </h4>
        <p className="text-xs text-slate-600">Fetch data from <strong>accounts under your organisation</strong> (Connect/org API) or <strong>accounts outside organisation</strong> (standard key).</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onFetchOrganisationAccounts}
            disabled={isFetchingAccounts}
            className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-black uppercase disabled:opacity-50 flex items-center gap-2"
          >
            {isFetchingAccounts ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>Fetching...</> : 'Fetch organisation accounts'}
          </button>
          <button
            onClick={onFetchStandardAccount}
            disabled={isFetchingAccounts}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase disabled:opacity-50 flex items-center gap-2"
          >
            {isFetchingAccounts ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>Fetching...</> : 'Fetch my account (standard)'}
          </button>
          <button
            onClick={onFetchAccounts}
            disabled={isFetchingAccounts}
            className="px-4 py-2 bg-slate-600 text-white rounded-xl text-xs font-black uppercase disabled:opacity-50 flex items-center gap-2"
          >
            {isFetchingAccounts ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>Fetching...</> : 'Fetch all (legacy)'}
          </button>
          <span className="text-slate-400 text-xs font-medium">or</span>
          <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">Add account manually</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Add account manually (organisation key or outside)</p>
          <div className="grid gap-2 sm:grid-cols-[1fr auto auto] items-end">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Account ID</label>
              <input
                type="text"
                value={newAccountId}
                onChange={(e) => setNewAccountId(e.target.value)}
                placeholder="acct_... (from Stripe Dashboard)"
                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Name</label>
              <input
                type="text"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="e.g. US Account"
                className="w-full min-w-[100px] px-4 py-2 border border-slate-200 rounded-xl text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Scope</label>
              <select
                value={newAccountScope}
                onChange={(e) => setNewAccountScope(e.target.value as StripeAccountScope)}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium bg-white min-w-[160px]"
              >
                <option value="organisation">Under organisation (Stripe-Context)</option>
                <option value="standalone">Outside organisation (Stripe-Account only)</option>
              </select>
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            {newAccountScope === 'organisation'
              ? 'Use when this account is under your Organisation API key. Set "Target account ID" above if required.'
              : 'Use for standard API key or connected accounts not under an organisation.'}
          </p>
          <button onClick={handleAddAccount} disabled={!newAccountId.trim()} className="px-4 py-2 bg-slate-700 text-white rounded-xl text-xs font-black uppercase disabled:opacity-50 hover:bg-slate-800">
            Add account
          </button>
        </div>
        {accounts.length > 0 && (
          <p className="text-[10px] text-slate-500 uppercase font-bold">Connected accounts (fetch data for these)</p>
        )}
        {accounts.map((acc) => (
          <div key={acc.id} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white rounded-xl border border-slate-100">
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs font-bold text-slate-800">{acc.id}</p>
              {editingAccountId === acc.id ? (
                <div className="flex flex-wrap gap-2 mt-1">
                  <input
                    type="text"
                    value={editingAccountName}
                    onChange={(e) => setEditingAccountName(e.target.value)}
                    placeholder="Account name"
                    className="flex-1 min-w-[120px] px-2 py-1 border border-slate-200 rounded text-xs"
                    autoFocus
                  />
                  <button onClick={handleSaveAccountName} className="text-emerald-600 hover:text-emerald-700 text-xs font-bold">Save</button>
                  <button onClick={() => { setEditingAccountId(null); setEditingAccountName(''); }} className="text-slate-400 text-xs">Cancel</button>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  {acc.name || 'Account'}
                  <button onClick={() => handleStartEditAccount(acc)} className="text-slate-400 hover:text-indigo-600" title="Edit name">✎</button>
                </p>
              )}
              <div className="mt-1 flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${(acc.scope ?? 'standalone') === 'organisation' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                  {(acc.scope ?? 'standalone') === 'organisation' ? 'Organisation' : 'Outside org'}
                </span>
                <select
                  value={acc.scope ?? 'standalone'}
                  onChange={(e) => updateStripeAccountScope(acc.id, e.target.value as StripeAccountScope)}
                  className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white"
                  title="Change scope"
                >
                  <option value="organisation">Under organisation</option>
                  <option value="standalone">Outside organisation</option>
                </select>
              </div>
            </div>
            <button onClick={() => removeStripeAccount(acc.id)} className="text-rose-500 hover:text-rose-700 text-xs font-black uppercase shrink-0">Remove</button>
          </div>
        ))}
      </div>

      <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
        <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-2">Fetch data</h4>
        <p className="text-xs text-slate-600 mb-4">
          {accounts.length > 0
            ? 'Fetch from all accounts at once (Sync new / Full refresh on main screen), or fetch per account below.'
            : 'Add organisation or standalone accounts above, then use Sync new or Full refresh on the main screen.'}
        </p>
        {accounts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => onFetch(acc.id)}
                disabled={isSyncing}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
              >
                Fetch: {acc.name || acc.id.slice(0, 12)}...
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
        <button
          type="button"
          onClick={() => setWebhookSectionOpen(!webhookSectionOpen)}
          className="w-full flex items-center justify-between text-left"
        >
          <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Webhooks — create &amp; processing</h4>
          <span className="text-slate-400 text-lg">{webhookSectionOpen ? '−' : '+'}</span>
        </button>
        {webhookSectionOpen && (
          <div className="mt-4 space-y-4">
            <p className="text-xs text-slate-600">List existing endpoints, create a new webhook endpoint, and ensure your server responds correctly to Stripe events.</p>
            <div className="flex gap-2">
              <button onClick={onListWebhooks} disabled={webhookLoading || !getStripeOrgConfig().apiKey?.startsWith('sk_')} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-100 disabled:opacity-50">
                {webhookLoading ? 'Loading...' : 'List webhook endpoints'}
              </button>
            </div>
            {webhookEndpoints.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Endpoints</p>
                {webhookEndpoints.map((ep) => (
                  <div key={ep.id} className="p-3 bg-white rounded-xl border border-slate-100 text-xs">
                    <p className="font-mono text-slate-800 break-all">{ep.url}</p>
                    <p className="text-slate-500 mt-1">Status: <span className="font-bold">{ep.status}</span>{ep.enabled_events?.length ? ` · Events: ${ep.enabled_events.slice(0, 5).join(', ')}${(ep.enabled_events.length > 5 ? '…' : '')}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <p className="text-[10px] text-slate-500 uppercase font-bold">Create webhook endpoint</p>
              <input type="url" value={webhookCreateUrl} onChange={(e) => setWebhookCreateUrl(e.target.value)} placeholder="https://your-server.com/stripe-webhooks" className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-mono" />
              <input type="text" value={webhookCreateEvents} onChange={(e) => setWebhookCreateEvents(e.target.value)} placeholder="charge.succeeded, charge.updated" className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-mono" />
              <button onClick={onCreateWebhook} disabled={webhookLoading || !webhookCreateUrl.trim()} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-black uppercase disabled:opacity-50">Create endpoint</button>
              {webhookCreateResult && (
                <p className={`text-xs font-medium ${webhookCreateResult.success ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {webhookCreateResult.message}
                  {webhookCreateResult.secret && ` Secret: ${webhookCreateResult.secret}`}
                </p>
              )}
            </div>
            <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/50">
              <p className="text-[10px] font-black text-indigo-800 uppercase tracking-tight mb-1">Processing responses</p>
              <p className="text-xs text-indigo-900">When Stripe sends events to your endpoint, respond with <code className="bg-white px-1 rounded">200 OK</code> as soon as you have received the payload. Process <code className="bg-white px-1 rounded">charge.succeeded</code> and <code className="bg-white px-1 rounded">charge.updated</code> to keep revenue in sync. This app&apos;s &quot;Sync new&quot; also fetches new charges; webhooks allow near real-time updates if you persist them on your server.</p>
            </div>
          </div>
        )}
      </div>

      <button onClick={onSave} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-xs uppercase hover:bg-indigo-700 shadow-lg transition-all">
        Save configuration
      </button>
    </div>
  );
};

export default AccountSettings;
