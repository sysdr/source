
import React, { useState, useEffect, useMemo } from 'react';
import { getBaseCurrency, formatAmount, getFxRateForDate } from '../services/currencyService';
import { Transaction } from '../types';
import {
  getTransferPricingData,
  setTransferPricingData,
  getTransactions,
  setTransactions,
} from '../services/storageService';
import {
  type ExportInvoiceConfig,
  type ExportInvoiceProvider,
  type ExportInvoiceRecipient,
  type ServiceRecipientProfile,
  type ServiceProviderProfile,
  type TransferPricingInvoiceRecord,
  getDefaultExportInvoiceConfig,
  getCommercialInvoiceDefaults,
  getDefaultProviderProfile,
  getDefaultRecipientProfile,
  DEFAULT_TP_PROVIDER_ID,
  DEFAULT_TP_RECIPIENT_ID,
  getDefaultProviderDetails,
  getDefaultRecipientDetails,
  emptyExportInvoiceRecipient,
  emptyExportInvoiceProvider,
  listInvoiceClientRecipients,
  listInvoiceCompanyProviders,
  recipientProfileFromForm,
  providerProfileFromForm,
  buildTransferPricingInvoiceRecord,
  upsertTransferPricingInvoice,
  deleteTransferPricingInvoice,
  ensureCommercialInvoiceHistory,
  syncPartyProfilesFromInvoice,
  buildExportInvoiceData,
  openExportInvoicePrint,
  buildInvoiceRecordFromExport,
  generateExportInvoiceNumber,
  peekExportInvoiceNumber,
  EXPORT_SAC_CODE,
  EXPORT_PURPOSE_CODE,
} from '../services/exportInvoiceService';
import ExportInvoicePreview from './ExportInvoicePreview';
import { useUpsertInvoice } from '../hooks/useInvoices';

function ensureDefaultPartyProfiles(
  providers: ServiceProviderProfile[],
  recipients: ServiceRecipientProfile[],
): { providers: ServiceProviderProfile[]; recipients: ServiceRecipientProfile[] } {
  const defaultProvider = getDefaultProviderProfile();
  const defaultRecipient = getDefaultRecipientProfile();
  return {
    providers: [
      defaultProvider,
      ...providers.filter((p) => p.id !== DEFAULT_TP_PROVIDER_ID && p.name.trim().toLowerCase() !== defaultProvider.name.toLowerCase()),
    ],
    recipients: [
      defaultRecipient,
      ...recipients.filter((r) => r.id !== DEFAULT_TP_RECIPIENT_ID && r.name.trim().toLowerCase() !== defaultRecipient.name.toLowerCase()),
    ],
  };
}

function seedServiceRecipients(
  saved: ServiceRecipientProfile[] | undefined,
  activeId: string | null | undefined,
  currentRecipient: ExportInvoiceRecipient | undefined,
): { recipients: ServiceRecipientProfile[]; activeId: string | null } {
  const seeded: ServiceRecipientProfile[] = [];
  const seen = new Set<string>();

  const pushUnique = (profile: ServiceRecipientProfile) => {
    const key = profile.name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    seeded.push(profile);
  };

  pushUnique(getDefaultRecipientProfile());

  if (saved?.length) {
    for (const profile of saved) pushUnique(profile);
  } else {
    const fromDocs = getDefaultRecipientDetails();
    if (fromDocs.name.trim()) {
      pushUnique(recipientProfileFromForm(fromDocs, `${fromDocs.name.trim()} (Documents)`, 'sr-docs'));
    }
    for (const client of listInvoiceClientRecipients()) {
      pushUnique(client);
    }
    if (currentRecipient?.name?.trim()) {
      pushUnique(recipientProfileFromForm(currentRecipient, currentRecipient.name.trim(), 'sr-current'));
    }
  }

  const { recipients } = ensureDefaultPartyProfiles([], seeded);
  const match =
    (activeId && recipients.find((r) => r.id === activeId)) ||
    recipients.find((r) => r.id === DEFAULT_TP_RECIPIENT_ID) ||
    recipients[0] ||
    null;

  return { recipients, activeId: match?.id || DEFAULT_TP_RECIPIENT_ID };
}

function seedServiceProviders(
  saved: ServiceProviderProfile[] | undefined,
  activeId: string | null | undefined,
  currentProvider: ExportInvoiceProvider | undefined,
): { providers: ServiceProviderProfile[]; activeId: string | null } {
  const seeded: ServiceProviderProfile[] = [];
  const seen = new Set<string>();

  const pushUnique = (profile: ServiceProviderProfile) => {
    const key = profile.name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    seeded.push(profile);
  };

  pushUnique(getDefaultProviderProfile());

  if (saved?.length) {
    for (const profile of saved) pushUnique(profile);
  } else {
    const fromDocs = getDefaultProviderDetails();
    if (fromDocs.name.trim()) {
      pushUnique(providerProfileFromForm(fromDocs, `${fromDocs.name.trim()} (Documents)`, 'sp-docs'));
    }
    for (const company of listInvoiceCompanyProviders()) {
      pushUnique(company);
    }
    if (currentProvider?.name?.trim()) {
      pushUnique(providerProfileFromForm(currentProvider, currentProvider.name.trim(), 'sp-current'));
    }
  }

  const { providers } = ensureDefaultPartyProfiles(seeded, []);
  const match =
    (activeId && providers.find((p) => p.id === activeId)) ||
    providers.find((p) => p.id === DEFAULT_TP_PROVIDER_ID) ||
    providers[0] ||
    null;

  return { providers, activeId: match?.id || DEFAULT_TP_PROVIDER_ID };
}

const TransferPricing: React.FC = () => {
  const baseCurrency = getBaseCurrency();
  const savedData = getTransferPricingData();
  const [usRevenue, setUsRevenue] = useState(savedData.usRevenue);
  const [usExpenses, setUsExpenses] = useState(savedData.usExpenses);
  const [margin, setMargin] = useState(savedData.margin);
  const [isPosting, setIsPosting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [liveRate, setLiveRate] = useState<number>(84.0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'calculator' | 'invoice' | 'history'>('calculator');
  const [invoiceNumber, setInvoiceNumber] = useState(
    () => savedData.exportInvoice?.lastSeq
      ? `EXP-${new Date().getFullYear()}-${String(savedData.exportInvoice.lastSeq).padStart(3, '0')}`
      : peekExportInvoiceNumber(),
  );
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);

  const initial = (() => {
    const base = getCommercialInvoiceDefaults(savedData.exportInvoice);
    const { recipients, activeId: recipientActiveId } = seedServiceRecipients(
      savedData.serviceRecipients,
      savedData.activeRecipientId ?? DEFAULT_TP_RECIPIENT_ID,
      base.recipient,
    );
    const { providers, activeId: providerActiveId } = seedServiceProviders(
      savedData.serviceProviders,
      savedData.activeProviderId ?? DEFAULT_TP_PROVIDER_ID,
      base.provider,
    );
    const activeRecipient = recipients.find((r) => r.id === recipientActiveId) || getDefaultRecipientProfile();
    const activeProvider = providers.find((p) => p.id === providerActiveId) || getDefaultProviderProfile();
    const { id: _rid, label: _rlabel, ...recipient } = activeRecipient;
    const { id: _pid, label: _plabel, ...provider } = activeProvider;
    return {
      exportConfig: {
        ...base,
        recipient,
        provider,
        signatoryTitle: provider.signatoryTitle || base.signatoryTitle,
        bank: {
          ...base.bank,
          beneficiaryName: base.bank.beneficiaryName || provider.name,
        },
      },
      recipients,
      recipientActiveId: activeRecipient.id,
      providers,
      providerActiveId: activeProvider.id,
    };
  })();

  const [exportConfig, setExportConfig] = useState<ExportInvoiceConfig>(() => initial.exportConfig);
  const [serviceRecipients, setServiceRecipients] = useState<ServiceRecipientProfile[]>(() => initial.recipients);
  const [activeRecipientId, setActiveRecipientId] = useState<string | null>(() => initial.recipientActiveId);
  const [recipientLabel, setRecipientLabel] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [serviceProviders, setServiceProviders] = useState<ServiceProviderProfile[]>(() => initial.providers);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(() => initial.providerActiveId);
  const [providerLabel, setProviderLabel] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  const [commercialInvoices, setCommercialInvoices] = useState<TransferPricingInvoiceRecord[]>(
    () => ensureCommercialInvoiceHistory(savedData.commercialInvoices),
  );
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(
    () => savedData.activeInvoiceId || null,
  );
  const [invoiceSearch, setInvoiceSearch] = useState('');

  const { mutate: upsertInvoice } = useUpsertInvoice();

  const invoiceAmount = Math.round((usRevenue - usExpenses) * (1 - margin / 100));
  const amountInBase = baseCurrency === 'INR' ? invoiceAmount * liveRate : invoiceAmount;

  const exportInvoiceData = useMemo(
    () => buildExportInvoiceData(exportConfig, invoiceAmount, { invoiceNumber, invoiceDate }),
    [exportConfig, invoiceAmount, invoiceNumber, invoiceDate],
  );

  useEffect(() => {
    const stored = getTransferPricingData().commercialInvoices || [];
    // Never let a stale render wipe history that was just written synchronously.
    const invoicesToPersist =
      commercialInvoices.length > 0 ? commercialInvoices : stored;
    setTransferPricingData({
      usRevenue,
      usExpenses,
      margin,
      exportInvoice: exportConfig,
      serviceRecipients,
      activeRecipientId,
      serviceProviders,
      activeProviderId,
      commercialInvoices: invoicesToPersist,
      activeInvoiceId: editingInvoiceId,
    });
  }, [
    usRevenue,
    usExpenses,
    margin,
    exportConfig,
    serviceRecipients,
    activeRecipientId,
    serviceProviders,
    activeProviderId,
    commercialInvoices,
    editingInvoiceId,
  ]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    getFxRateForDate(today, 'USD', 'INR')
      .then((rate) => { if (rate > 0) setLiveRate(rate); })
      .catch(() => { /* fallback stays at 84.0 */ });
  }, []);

  const updateConfig = <K extends keyof ExportInvoiceConfig>(key: K, value: ExportInvoiceConfig[K]) => {
    setExportConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateBank = <K extends keyof ExportInvoiceConfig['bank']>(
    key: K,
    value: ExportInvoiceConfig['bank'][K],
  ) => {
    setExportConfig((prev) => ({ ...prev, bank: { ...prev.bank, [key]: value } }));
  };

  const updateRecipient = <K extends keyof ExportInvoiceRecipient>(
    key: K,
    value: ExportInvoiceRecipient[K],
  ) => {
    setExportConfig((prev) => ({
      ...prev,
      recipient: { ...(prev.recipient || getDefaultRecipientDetails()), [key]: value },
    }));
  };

  const updateProvider = <K extends keyof ExportInvoiceProvider>(
    key: K,
    value: ExportInvoiceProvider[K],
  ) => {
    setExportConfig((prev) => ({
      ...prev,
      provider: { ...(prev.provider || getDefaultProviderDetails()), [key]: value },
      ...(key === 'signatoryTitle' ? { signatoryTitle: value as string } : {}),
      ...(key === 'name' && !prev.bank.beneficiaryName.trim()
        ? { bank: { ...prev.bank, beneficiaryName: value as string } }
        : {}),
    }));
  };

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  /** Write TP state to storage immediately (avoid useEffect races that drop history). */
  const persistTransferPricingSnapshot = (patch: {
    commercialInvoices: TransferPricingInvoiceRecord[];
    activeInvoiceId?: string | null;
    serviceProviders?: ServiceProviderProfile[];
    serviceRecipients?: ServiceRecipientProfile[];
    activeProviderId?: string | null;
    activeRecipientId?: string | null;
    exportInvoice?: ExportInvoiceConfig;
  }) => {
    setTransferPricingData({
      usRevenue,
      usExpenses,
      margin,
      exportInvoice: patch.exportInvoice ?? exportConfig,
      serviceRecipients: patch.serviceRecipients ?? serviceRecipients,
      activeRecipientId:
        patch.activeRecipientId !== undefined ? patch.activeRecipientId : activeRecipientId,
      serviceProviders: patch.serviceProviders ?? serviceProviders,
      activeProviderId:
        patch.activeProviderId !== undefined ? patch.activeProviderId : activeProviderId,
      commercialInvoices: patch.commercialInvoices,
      activeInvoiceId:
        patch.activeInvoiceId !== undefined ? patch.activeInvoiceId : editingInvoiceId,
    });
  };

  /** Persist full invoice snapshot + sync provider/recipient profile modifications. */
  const persistCurrentInvoice = (): TransferPricingInvoiceRecord => {
    const synced = syncPartyProfilesFromInvoice({
      providers: serviceProviders,
      recipients: serviceRecipients,
      provider: exportConfig.provider || emptyExportInvoiceProvider(),
      recipient: exportConfig.recipient || emptyExportInvoiceRecipient(),
      activeProviderId,
      activeRecipientId,
    });
    setServiceProviders(synced.providers);
    setServiceRecipients(synced.recipients);
    setActiveProviderId(synced.activeProviderId);
    setActiveRecipientId(synced.activeRecipientId);

    const existing = editingInvoiceId
      ? commercialInvoices.find((r) => r.id === editingInvoiceId)
      : commercialInvoices.find((r) => r.invoiceNumber === invoiceNumber);

    const nextProvider = synced.activeProviderId
      ? (() => {
          const p = synced.providers.find((x) => x.id === synced.activeProviderId);
          if (!p) return exportConfig.provider;
          const { id: _id, label: _label, ...provider } = p;
          return provider;
        })()
      : exportConfig.provider;
    const nextRecipient = synced.activeRecipientId
      ? (() => {
          const r = synced.recipients.find((x) => x.id === synced.activeRecipientId);
          if (!r) return exportConfig.recipient;
          const { id: _id, label: _label, ...recipient } = r;
          return recipient;
        })()
      : exportConfig.recipient;

    const nextExportConfig: ExportInvoiceConfig = {
      ...exportConfig,
      provider: nextProvider,
      recipient: nextRecipient,
    };

    const record = buildTransferPricingInvoiceRecord({
      id: existing?.id,
      createdAt: existing?.createdAt,
      invoiceNumber,
      invoiceDate,
      amountUsd: exportInvoiceData.amountUsd,
      usRevenue,
      usExpenses,
      margin,
      exportConfig: nextExportConfig,
      providerId: synced.activeProviderId,
      recipientId: synced.activeRecipientId,
    });

    const nextInvoices = upsertTransferPricingInvoice(commercialInvoices, record);
    setCommercialInvoices(nextInvoices);
    setEditingInvoiceId(record.id);
    setExportConfig(nextExportConfig);
    persistTransferPricingSnapshot({
      commercialInvoices: nextInvoices,
      activeInvoiceId: record.id,
      serviceProviders: synced.providers,
      serviceRecipients: synced.recipients,
      activeProviderId: synced.activeProviderId,
      activeRecipientId: synced.activeRecipientId,
      exportInvoice: nextExportConfig,
    });
    return record;
  };

  const applyRecipientProfile = (profile: ServiceRecipientProfile) => {
    const { id: _id, label: _label, ...recipient } = profile;
    setExportConfig((prev) => ({ ...prev, recipient }));
    setActiveRecipientId(profile.id);
  };

  const handleLoadRecipient = (profile: ServiceRecipientProfile) => {
    applyRecipientProfile(profile);
    showSuccess(`Loaded “${profile.label}” for this invoice.`);
  };

  const handleSaveRecipient = () => {
    const recipient = exportConfig.recipient || emptyExportInvoiceRecipient();
    if (!recipient.name.trim()) {
      showSuccess('Enter a recipient name before saving.');
      return;
    }
    const label = recipientLabel.trim() || recipient.name.trim();
    const existing = serviceRecipients.find(
      (r) => r.label.toLowerCase() === label.toLowerCase() || r.id === activeRecipientId,
    );
    const profile = recipientProfileFromForm(recipient, label, existing?.id);
    const updated = [
      ...serviceRecipients.filter((r) => r.id !== profile.id && r.label.toLowerCase() !== label.toLowerCase()),
      profile,
    ];
    setServiceRecipients(updated);
    setActiveRecipientId(profile.id);
    setRecipientLabel('');
    showSuccess(`Saved “${profile.label}” — available for future invoices.`);
  };

  const handleUpdateRecipient = (profile: ServiceRecipientProfile) => {
    const recipient = exportConfig.recipient || emptyExportInvoiceRecipient();
    const updatedProfile = recipientProfileFromForm(recipient, profile.label, profile.id);
    setServiceRecipients((prev) => prev.map((r) => (r.id === profile.id ? updatedProfile : r)));
    setActiveRecipientId(profile.id);
    showSuccess(`Updated “${profile.label}”.`);
  };

  const handleDeleteRecipient = (id: string) => {
    const removed = serviceRecipients.find((r) => r.id === id);
    setServiceRecipients((prev) => prev.filter((r) => r.id !== id));
    if (activeRecipientId === id) setActiveRecipientId(null);
    showSuccess(removed ? `Removed “${removed.label}”.` : 'Recipient removed.');
  };

  const handleImportFromInvoiceBook = () => {
    const imported = listInvoiceClientRecipients();
    if (!imported.length) {
      showSuccess('No clients in Invoice → Address Book to import.');
      return;
    }
    const seen = new Set(serviceRecipients.map((r) => r.name.trim().toLowerCase()));
    const additions = imported.filter((r) => {
      const key = r.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!additions.length) {
      showSuccess('All Invoice clients already in the recipient list.');
      return;
    }
    setServiceRecipients((prev) => [...prev, ...additions]);
    showSuccess(`Imported ${additions.length} recipient${additions.length === 1 ? '' : 's'} from Invoice address book.`);
  };

  const handleFillRecipientFromDocuments = () => {
    const recipient = getDefaultRecipientDetails();
    setExportConfig((prev) => ({ ...prev, recipient }));
    const match = serviceRecipients.find(
      (r) => r.name.trim().toLowerCase() === recipient.name.trim().toLowerCase(),
    );
    setActiveRecipientId(match?.id || null);
    showSuccess('Service recipient loaded from earlier invoice documents.');
  };

  const handleFillProviderFromDocuments = () => {
    const provider = getDefaultProviderDetails();
    setExportConfig((prev) => ({
      ...prev,
      provider,
      signatoryTitle: provider.signatoryTitle || prev.signatoryTitle,
      bank: {
        ...prev.bank,
        beneficiaryName: prev.bank.beneficiaryName || provider.name,
      },
    }));
    const match = serviceProviders.find(
      (p) => p.name.trim().toLowerCase() === provider.name.trim().toLowerCase(),
    );
    setActiveProviderId(match?.id || null);
    showSuccess('Service provider loaded from earlier invoice documents.');
  };

  const applyProviderProfile = (profile: ServiceProviderProfile) => {
    const { id: _id, label: _label, ...provider } = profile;
    setExportConfig((prev) => ({
      ...prev,
      provider,
      signatoryTitle: provider.signatoryTitle || prev.signatoryTitle,
      bank: {
        ...prev.bank,
        beneficiaryName: prev.bank.beneficiaryName.trim() ? prev.bank.beneficiaryName : provider.name,
      },
    }));
    setActiveProviderId(profile.id);
  };

  const handleLoadProvider = (profile: ServiceProviderProfile) => {
    applyProviderProfile(profile);
    showSuccess(`Loaded provider “${profile.label}” for this invoice.`);
  };

  const handleSaveProvider = () => {
    const provider = exportConfig.provider || emptyExportInvoiceProvider();
    if (!provider.name.trim()) {
      showSuccess('Enter a provider name before saving.');
      return;
    }
    const label = providerLabel.trim() || provider.name.trim();
    const existing = serviceProviders.find(
      (p) => p.label.toLowerCase() === label.toLowerCase() || p.id === activeProviderId,
    );
    const profile = providerProfileFromForm(provider, label, existing?.id);
    const updated = [
      ...serviceProviders.filter((p) => p.id !== profile.id && p.label.toLowerCase() !== label.toLowerCase()),
      profile,
    ];
    setServiceProviders(updated);
    setActiveProviderId(profile.id);
    setProviderLabel('');
    showSuccess(`Saved provider “${profile.label}” — available for future invoices.`);
  };

  const handleUpdateProvider = (profile: ServiceProviderProfile) => {
    const provider = exportConfig.provider || emptyExportInvoiceProvider();
    const updatedProfile = providerProfileFromForm(provider, profile.label, profile.id);
    setServiceProviders((prev) => prev.map((p) => (p.id === profile.id ? updatedProfile : p)));
    setActiveProviderId(profile.id);
    showSuccess(`Updated provider “${profile.label}”.`);
  };

  const handleDeleteProvider = (id: string) => {
    const removed = serviceProviders.find((p) => p.id === id);
    setServiceProviders((prev) => prev.filter((p) => p.id !== id));
    if (activeProviderId === id) setActiveProviderId(null);
    showSuccess(removed ? `Removed provider “${removed.label}”.` : 'Provider removed.');
  };

  const handleImportProvidersFromInvoiceBook = () => {
    const imported = listInvoiceCompanyProviders();
    if (!imported.length) {
      showSuccess('No companies in Invoice → Company profiles to import.');
      return;
    }
    const seen = new Set(serviceProviders.map((p) => p.name.trim().toLowerCase()));
    const additions = imported.filter((p) => {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!additions.length) {
      showSuccess('All Invoice companies already in the provider list.');
      return;
    }
    setServiceProviders((prev) => [...prev, ...additions]);
    showSuccess(`Imported ${additions.length} provider${additions.length === 1 ? '' : 's'} from Invoice company book.`);
  };

  const handleClearRecipient = () => {
    setExportConfig((prev) => ({
      ...prev,
      recipient: emptyExportInvoiceRecipient(),
    }));
    setActiveRecipientId(null);
  };

  const filteredRecipients = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return serviceRecipients;
    return serviceRecipients.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.ein.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
    );
  }, [serviceRecipients, recipientSearch]);

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    if (!q) return serviceProviders;
    return serviceProviders.filter(
      (p) =>
        (p.label || '').toLowerCase().includes(q) ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.city || '').toLowerCase().includes(q) ||
        (p.gstin || '').toLowerCase().includes(q) ||
        (p.pan || '').toLowerCase().includes(q) ||
        (p.llpin || '').toLowerCase().includes(q) ||
        (p.iec || '').toLowerCase().includes(q),
    );
  }, [serviceProviders, providerSearch]);

  const handleClearProvider = () => {
    setExportConfig((prev) => ({
      ...prev,
      provider: emptyExportInvoiceProvider(),
    }));
    setActiveProviderId(null);
  };

  const handlePostToLedger = () => {
    setIsPosting(true);
    setTimeout(() => {
      const txs = getTransactions();
      const newTx: Transaction = {
        id: `TP-${Date.now()}`,
        date: invoiceDate,
        description: `Intercompany Service Fee: ${exportInvoiceData.invoiceNumber}`,
        amount: amountInBase,
        currency: baseCurrency,
        source: 'Manual',
        category: 'Transfer Pricing',
        status: 'Completed',
        type: 'Income',
        gstImpact: 0,
        customerLocation: 'US',
        narration: `B2B export of services — ${exportInvoiceData.invoiceNumber}`,
      };

      setTransactions([newTx, ...txs]);
      const saved = persistCurrentInvoice();
      setIsPosting(false);
      showSuccess(`Posted ${saved.invoiceNumber} to ledger and saved to invoice history.`);
    }, 600);
  };

  const handleExportPdf = () => {
    setIsExportingPdf(true);
    openExportInvoicePrint(exportInvoiceData);
    const saved = persistCurrentInvoice();
    setTimeout(() => {
      setIsExportingPdf(false);
      showSuccess(`Exported ${saved.invoiceNumber} — saved to invoice history.`);
    }, 500);
  };

  const handleSaveToInvoices = () => {
    setIsSavingInvoice(true);
    const saved = persistCurrentInvoice();
    const record = buildInvoiceRecordFromExport(exportInvoiceData);
    record.id = `exp-${saved.id}`;
    record.number = saved.invoiceNumber;
    upsertInvoice(record, {
      onSuccess: () => {
        showSuccess(`Saved ${saved.invoiceNumber} to Invoice Ledger and TP history.`);
        setIsSavingInvoice(false);
      },
      onError: () => {
        showSuccess(`Saved ${saved.invoiceNumber} to TP history (ledger sync offline).`);
        setIsSavingInvoice(false);
      },
    });
  };

  const handleLoadSavedInvoice = (record: TransferPricingInvoiceRecord) => {
    setUsRevenue(record.usRevenue);
    setUsExpenses(record.usExpenses);
    setMargin(record.margin);
    setInvoiceNumber(record.invoiceNumber);
    setInvoiceDate(record.invoiceDate);
    const cfg = getDefaultExportInvoiceConfig(record.exportConfig);
    setExportConfig(cfg);
    setEditingInvoiceId(record.id);
    if (record.providerId) setActiveProviderId(record.providerId);
    if (record.recipientId) setActiveRecipientId(record.recipientId);
    setActiveSection('invoice');
    showSuccess(`Loaded ${record.invoiceNumber} for editing.`);
  };

  const handleDeleteSavedInvoice = (id: string) => {
    const removed = commercialInvoices.find((r) => r.id === id);
    const nextInvoices = deleteTransferPricingInvoice(commercialInvoices, id);
    const nextEditingId = editingInvoiceId === id ? null : editingInvoiceId;
    setCommercialInvoices(nextInvoices);
    if (editingInvoiceId === id) setEditingInvoiceId(null);
    persistTransferPricingSnapshot({
      commercialInvoices: nextInvoices,
      activeInvoiceId: nextEditingId,
    });
    showSuccess(removed ? `Deleted ${removed.invoiceNumber}.` : 'Invoice deleted.');
  };

  const handleStartNewInvoice = () => {
    const next = generateExportInvoiceNumber();
    const defaults = getCommercialInvoiceDefaults({
      lastSeq: Number(next.split('-').pop()),
      billingPeriod: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
    });
    const ensured = ensureDefaultPartyProfiles(serviceProviders, serviceRecipients);
    setServiceProviders(ensured.providers);
    setServiceRecipients(ensured.recipients);
    setActiveProviderId(DEFAULT_TP_PROVIDER_ID);
    setActiveRecipientId(DEFAULT_TP_RECIPIENT_ID);
    setExportConfig(defaults);
    setInvoiceNumber(next);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setUsRevenue(defaults.rateUsd);
    setUsExpenses(0);
    setMargin(0);
    setEditingInvoiceId(null);
    setActiveSection('invoice');
    showSuccess(
      `New invoice ${next} — loaded EXP-2026-001 defaults (provider, recipient, bank, service).`,
    );
  };

  const handleNewInvoiceNumber = () => {
    handleStartNewInvoice();
  };

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    const list = [...commercialInvoices].sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    );
    if (!q) return list;
    return list.filter(
      (r) =>
        (r.invoiceNumber || '').toLowerCase().includes(q) ||
        (r.invoiceDate || '').includes(q) ||
        r.exportConfig?.provider?.name?.toLowerCase().includes(q) ||
        r.exportConfig?.recipient?.name?.toLowerCase().includes(q) ||
        r.exportConfig?.serviceDescription?.toLowerCase().includes(q),
    );
  }, [commercialInvoices, invoiceSearch]);

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm';
  const labelClass = 'block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide';

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-slate-900">Transfer Pricing Engine</h2>
          <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded uppercase border border-indigo-200">
            B2B Export of Services
          </span>
        </div>
        <p className="text-slate-500 mt-1">
          Generate arm&apos;s-length commercial invoices from your Indian LLP to the US C-Corp — LUT zero-rated export, FIRC-ready wire instructions, IRS-deductible expenses.
        </p>
      </header>

      <div className="flex gap-2 border-b border-slate-200">
        {(['calculator', 'invoice', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveSection(tab)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              activeSection === tab
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'calculator'
              ? 'TP Calculator'
              : tab === 'invoice'
                ? 'Commercial Invoice'
                : `Saved Invoices${commercialInvoices.length ? ` (${commercialInvoices.length})` : ''}`}
          </button>
        ))}
      </div>

      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium px-4 py-3 rounded-lg">
          {successMessage}
        </div>
      )}

      {activeSection === 'calculator' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Calculator (Monthly)</h3>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>Total US Revenue (Stripe + MoR)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400">$</span>
                  <input
                    type="number"
                    value={usRevenue}
                    onChange={(e) => setUsRevenue(Number(e.target.value))}
                    className={`${inputClass} pl-8`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Direct US Expenses (Hosting/Fees)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400">$</span>
                  <input
                    type="number"
                    value={usExpenses}
                    onChange={(e) => setUsExpenses(Number(e.target.value))}
                    className={`${inputClass} pl-8`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Configurable US Margin (%)</label>
                <input
                  type="range"
                  min="3"
                  max="25"
                  step="0.5"
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>3% (Aggressive)</span>
                  <span className="font-bold text-slate-700">{margin}%</span>
                  <span>25% (Cost-Plus)</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Cost-Plus (15–25%) is the standard safe harbor. Profit Split applies when the LLP owns IP and bears operational risk.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-emerald-900 font-bold mb-1">Invoice Summary</h3>
              <p className="text-emerald-700 text-sm mb-6">Optimized for IRS Arm&apos;s Length compliance.</p>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-800">Invoice Amount:</span>
                  <span className="font-bold text-emerald-900">${invoiceAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-800">In {baseCurrency}:</span>
                  <span className="font-bold text-emerald-900">{formatAmount(amountInBase, baseCurrency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-800">Live USD/INR Rate:</span>
                  <span className="font-bold text-emerald-900">₹{liveRate.toFixed(2)}</span>
                </div>
                <div className="pt-3 border-t border-emerald-200 flex justify-between text-sm">
                  <span className="text-emerald-800">US Tax Exposure Reduced by (~21%):</span>
                  <span className="font-bold text-emerald-600">${(invoiceAmount * 0.21).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveSection('invoice')}
              className="mt-6 w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 text-sm"
            >
              Configure Commercial Invoice →
            </button>
          </div>
        </div>
      )}

      {activeSection === 'invoice' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-slate-900">Invoice Details</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {editingInvoiceId
                      ? `Editing saved invoice ${invoiceNumber}`
                      : 'New invoice — Save / Export / Post will add it to history'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStartNewInvoice}
                  className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                >
                  New invoice
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Invoice Number</label>
                  <div className="flex gap-2">
                    <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                    <button type="button" onClick={handleNewInvoiceNumber} className="px-2 py-1 text-xs bg-slate-100 rounded border hover:bg-slate-200" title="Generate next number">+</button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Invoice Date</label>
                  <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>LUT ARN Number</label>
                  <input className={inputClass} value={exportConfig.lutNumber} onChange={(e) => updateConfig('lutNumber', e.target.value)} placeholder="2026-2027 LUT ARN" />
                </div>
                <div>
                  <label className={labelClass}>Payment Terms</label>
                  <input className={inputClass} value={exportConfig.paymentTerms} onChange={(e) => updateConfig('paymentTerms', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Billing Period</label>
                  <input
                    className={inputClass}
                    value={exportConfig.billingPeriod || ''}
                    onChange={(e) => updateConfig('billingPeriod', e.target.value)}
                    placeholder="e.g. August 2026"
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Place of Supply</label>
                  <input className={inputClass} value={exportConfig.placeOfSupply} onChange={(e) => updateConfig('placeOfSupply', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900">Service &amp; Agreement</h3>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Service Description</label>
                  <textarea
                    className={`${inputClass} min-h-[72px]`}
                    value={exportConfig.serviceDescription}
                    onChange={(e) => updateConfig('serviceDescription', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>SAC Code</label>
                    <input className={inputClass} value={exportConfig.sacCode} onChange={(e) => updateConfig('sacCode', e.target.value)} />
                    <p className="text-[10px] text-slate-400 mt-1">{EXPORT_SAC_CODE} = IT design &amp; development</p>
                  </div>
                  <div>
                    <label className={labelClass}>Purpose Code (RBI)</label>
                    <input className={inputClass} value={exportConfig.purposeCode} onChange={(e) => updateConfig('purposeCode', e.target.value)} />
                    <p className="text-[10px] text-slate-400 mt-1">{EXPORT_PURPOSE_CODE} = Software consultancy</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Agreement Reference</label>
                    <input className={inputClass} value={exportConfig.agreementReference} onChange={(e) => updateConfig('agreementReference', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Agreement Date</label>
                    <input type="date" className={inputClass} value={exportConfig.agreementDate} onChange={(e) => updateConfig('agreementDate', e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="useCalc"
                    checked={exportConfig.useCalculatedAmount}
                    onChange={(e) => updateConfig('useCalculatedAmount', e.target.checked)}
                    className="accent-emerald-600"
                  />
                  <label htmlFor="useCalc" className="text-sm text-slate-700">
                    Use TP calculator amount (${invoiceAmount.toLocaleString()})
                  </label>
                </div>
                {!exportConfig.useCalculatedAmount && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Qty / Hours</label>
                      <input type="number" className={inputClass} value={exportConfig.qty} onChange={(e) => updateConfig('qty', Number(e.target.value))} />
                    </div>
                    <div>
                      <label className={labelClass}>Rate (USD)</label>
                      <input type="number" className={inputClass} value={exportConfig.rateUsd} onChange={(e) => updateConfig('rateUsd', Number(e.target.value))} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-slate-900">Service Providers</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Save multiple From-party providers and reload any onto future commercial invoices. Last selection is remembered.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleImportProvidersFromInvoiceBook}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 text-indigo-800"
                  >
                    Import from Invoice book
                  </button>
                  <button
                    type="button"
                    onClick={handleFillProviderFromDocuments}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 text-slate-700"
                  >
                    Fill from documents
                  </button>
                  <button
                    type="button"
                    onClick={handleClearProvider}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {serviceProviders.length > 0 && (
                <div className="space-y-2 border border-slate-100 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Saved providers ({serviceProviders.length})
                    </span>
                    <input
                      className={`${inputClass} max-w-[200px] py-1.5 text-xs`}
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      placeholder="Search name, city, GSTIN…"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1.5">
                    {filteredProviders.map((profile) => {
                      const isActive = activeProviderId === profile.id;
                      return (
                        <div
                          key={profile.id}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${
                            isActive
                              ? 'bg-emerald-50 border-emerald-300'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{profile.label}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {(profile.gstin || profile.pan || '—').slice(0, 18)}
                              {profile.city ? ` · ${profile.city}` : ''}
                              {profile.state ? `, ${profile.state}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleLoadProvider(profile)}
                            className="px-2 py-1 text-[10px] font-bold uppercase bg-emerald-600 text-white rounded hover:bg-emerald-700 shrink-0"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateProvider(profile)}
                            title="Overwrite saved record with current form values"
                            className="px-2 py-1 text-[10px] font-bold uppercase bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 shrink-0"
                          >
                            Upd
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProvider(profile.id)}
                            className="px-2 py-1 text-[10px] font-bold uppercase bg-white border border-rose-200 rounded hover:bg-rose-50 text-rose-600 shrink-0"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                    {filteredProviders.length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-2">
                        No providers match &quot;{providerSearch}&quot;
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className={labelClass}>Save current as</label>
                  <input
                    className={inputClass}
                    value={providerLabel}
                    onChange={(e) => setProviderLabel(e.target.value)}
                    placeholder="Label (defaults to legal name)"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveProvider}
                  className="px-3 py-2 text-xs font-bold uppercase tracking-wide bg-slate-900 text-white rounded-lg hover:bg-slate-800 shrink-0"
                >
                  Save provider
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>Legal Name</label>
                  <input
                    className={inputClass}
                    value={exportConfig.provider?.name || ''}
                    onChange={(e) => updateProvider('name', e.target.value)}
                    placeholder="e.g. India LLP"
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Street Address</label>
                  <textarea
                    className={`${inputClass} min-h-[64px]`}
                    value={exportConfig.provider?.address || ''}
                    onChange={(e) => updateProvider('address', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>City</label>
                  <input className={inputClass} value={exportConfig.provider?.city || ''} onChange={(e) => updateProvider('city', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <input className={inputClass} value={exportConfig.provider?.state || ''} onChange={(e) => updateProvider('state', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>PIN</label>
                  <input className={inputClass} value={exportConfig.provider?.pin || ''} onChange={(e) => updateProvider('pin', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Country</label>
                  <input className={inputClass} value={exportConfig.provider?.country || ''} onChange={(e) => updateProvider('country', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>GSTIN</label>
                  <input className={inputClass} value={exportConfig.provider?.gstin || ''} onChange={(e) => updateProvider('gstin', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>PAN</label>
                  <input className={inputClass} value={exportConfig.provider?.pan || ''} onChange={(e) => updateProvider('pan', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>LLP Incorporation Code</label>
                  <input
                    className={inputClass}
                    value={exportConfig.provider?.llpin || ''}
                    onChange={(e) => updateProvider('llpin', e.target.value)}
                    placeholder="e.g. ACP-3421"
                  />
                </div>
                <div>
                  <label className={labelClass}>Import / Export Code</label>
                  <input
                    className={inputClass}
                    value={exportConfig.provider?.iec || ''}
                    onChange={(e) => updateProvider('iec', e.target.value)}
                    placeholder="DGFT IEC number"
                  />
                </div>
                <div>
                  <label className={labelClass}>Signatory Name</label>
                  <input className={inputClass} value={exportConfig.provider?.signatoryName || ''} onChange={(e) => updateProvider('signatoryName', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Signatory Title</label>
                  <input className={inputClass} value={exportConfig.provider?.signatoryTitle || exportConfig.signatoryTitle || ''} onChange={(e) => updateProvider('signatoryTitle', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-slate-900">Service Recipients</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Save multiple recipients and reload any onto future commercial invoices. Last selection is remembered.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleImportFromInvoiceBook}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 text-indigo-800"
                  >
                    Import from Invoice book
                  </button>
                  <button
                    type="button"
                    onClick={handleFillRecipientFromDocuments}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 text-slate-700"
                  >
                    Fill from documents
                  </button>
                  <button
                    type="button"
                    onClick={handleClearRecipient}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {serviceRecipients.length > 0 && (
                <div className="space-y-2 border border-slate-100 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Saved recipients ({serviceRecipients.length})
                    </span>
                    <input
                      className={`${inputClass} max-w-[200px] py-1.5 text-xs`}
                      value={recipientSearch}
                      onChange={(e) => setRecipientSearch(e.target.value)}
                      placeholder="Search name, city, EIN…"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1.5">
                    {filteredRecipients.map((profile) => {
                      const isActive = activeRecipientId === profile.id;
                      return (
                        <div
                          key={profile.id}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${
                            isActive
                              ? 'bg-emerald-50 border-emerald-300'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{profile.label}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {(profile.ein || '—').slice(0, 18)}
                              {profile.city ? ` · ${profile.city}` : ''}
                              {profile.state ? `, ${profile.state}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleLoadRecipient(profile)}
                            className="px-2 py-1 text-[10px] font-bold uppercase bg-emerald-600 text-white rounded hover:bg-emerald-700 shrink-0"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateRecipient(profile)}
                            title="Overwrite saved record with current form values"
                            className="px-2 py-1 text-[10px] font-bold uppercase bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 shrink-0"
                          >
                            Upd
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecipient(profile.id)}
                            className="px-2 py-1 text-[10px] font-bold uppercase bg-white border border-rose-200 rounded hover:bg-rose-50 text-rose-600 shrink-0"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                    {filteredRecipients.length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-2">
                        No recipients match &quot;{recipientSearch}&quot;
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className={labelClass}>Save current as</label>
                  <input
                    className={inputClass}
                    value={recipientLabel}
                    onChange={(e) => setRecipientLabel(e.target.value)}
                    placeholder="Label (defaults to legal name)"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveRecipient}
                  className="px-3 py-2 text-xs font-bold uppercase tracking-wide bg-slate-900 text-white rounded-lg hover:bg-slate-800 shrink-0"
                >
                  Save recipient
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>Legal / Trade Name</label>
                  <input
                    className={inputClass}
                    value={exportConfig.recipient?.name || ''}
                    onChange={(e) => updateRecipient('name', e.target.value)}
                    placeholder="e.g. Systemdr, Inc."
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Street Address</label>
                  <textarea
                    className={`${inputClass} min-h-[64px]`}
                    value={exportConfig.recipient?.address || ''}
                    onChange={(e) => updateRecipient('address', e.target.value)}
                    placeholder="Street, suite, registered agent line…"
                  />
                </div>
                <div>
                  <label className={labelClass}>City</label>
                  <input className={inputClass} value={exportConfig.recipient?.city || ''} onChange={(e) => updateRecipient('city', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>State / Province</label>
                  <input className={inputClass} value={exportConfig.recipient?.state || ''} onChange={(e) => updateRecipient('state', e.target.value)} placeholder="e.g. Delaware" />
                </div>
                <div>
                  <label className={labelClass}>ZIP / Postal Code</label>
                  <input className={inputClass} value={exportConfig.recipient?.zip || ''} onChange={(e) => updateRecipient('zip', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Country</label>
                  <input className={inputClass} value={exportConfig.recipient?.country || ''} onChange={(e) => updateRecipient('country', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>EIN / Tax ID</label>
                  <input
                    className={inputClass}
                    value={exportConfig.recipient?.ein || ''}
                    onChange={(e) => updateRecipient('ein', e.target.value)}
                    placeholder="US Employer Identification Number"
                  />
                </div>
                <div>
                  <label className={labelClass}>Contact Name</label>
                  <input className={inputClass} value={exportConfig.recipient?.contactName || ''} onChange={(e) => updateRecipient('contactName', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input className={inputClass} value={exportConfig.recipient?.phone || ''} onChange={(e) => updateRecipient('phone', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Email</label>
                  <input
                    type="email"
                    className={inputClass}
                    value={exportConfig.recipient?.email || ''}
                    onChange={(e) => updateRecipient('email', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900">Wire Transfer (FIRC)</h3>
              <p className="text-xs text-slate-500">Bank details prefill from Invoice → Company profile when configured.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>Beneficiary Name</label>
                  <input className={inputClass} value={exportConfig.bank.beneficiaryName} onChange={(e) => updateBank('beneficiaryName', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Account Number</label>
                  <input className={inputClass} value={exportConfig.bank.accountNumber} onChange={(e) => updateBank('accountNumber', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Bank Name</label>
                  <input className={inputClass} value={exportConfig.bank.bankName} onChange={(e) => updateBank('bankName', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Branch Address</label>
                  <input className={inputClass} value={exportConfig.bank.branchAddress} onChange={(e) => updateBank('branchAddress', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>SWIFT Code</label>
                  <input className={inputClass} value={exportConfig.bank.swiftCode} onChange={(e) => updateBank('swiftCode', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>AD Code</label>
                  <input className={inputClass} value={exportConfig.bank.adCode} onChange={(e) => updateBank('adCode', e.target.value)} placeholder="Authorized Dealer Code" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                className="bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 text-xs uppercase tracking-wide disabled:opacity-50"
              >
                {isExportingPdf ? '…' : 'Export PDF'}
              </button>
              <button
                type="button"
                onClick={handleSaveToInvoices}
                disabled={isSavingInvoice}
                className="bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 text-xs uppercase tracking-wide disabled:opacity-50"
              >
                {isSavingInvoice ? '…' : editingInvoiceId ? 'Update Invoice' : 'Save Invoice'}
              </button>
              <button
                type="button"
                onClick={handlePostToLedger}
                disabled={isPosting}
                className="bg-slate-900 text-white py-3 rounded-lg font-bold hover:bg-slate-800 text-xs uppercase tracking-wide disabled:opacity-50"
              >
                {isPosting ? '…' : 'Post Ledger'}
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 space-y-2">
              <p><strong>LUT Declaration</strong> — Mandatory at top of invoice. Missing it makes the supply domestic (18% IGST liability).</p>
              <p><strong>SAC {EXPORT_SAC_CODE}</strong> — IT design &amp; development classification for GST audits.</p>
              <p><strong>Purpose {EXPORT_PURPOSE_CODE}</strong> — Required for RBI FIRC when USD hits your Indian account.</p>
              <p><strong>Agreement Reference</strong> — Ties invoice to Intercompany Agreement for IRS deductibility.</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[calc(100vh-200px)] sticky top-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Live Preview</h3>
            <ExportInvoicePreview data={exportInvoiceData} />
          </div>
        </div>
      )}

      {activeSection === 'history' && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-slate-900">Saved Commercial Invoices</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Every Save / Export PDF / Post Ledger stores a full snapshot. Reload to edit, then update or delete.
                Provider and recipient changes are kept in the address books.
              </p>
            </div>
            <button
              type="button"
              onClick={handleStartNewInvoice}
              className="px-3 py-2 text-xs font-bold uppercase tracking-wide bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
            >
              New invoice
            </button>
          </div>

          <input
            className={`${inputClass} max-w-md`}
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            placeholder="Search by number, date, provider, recipient…"
          />

          {filteredInvoices.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              {commercialInvoices.length === 0
                ? 'No invoices saved yet. Generate one from Commercial Invoice → Save / Export / Post.'
                : `No invoices match “${invoiceSearch}”.`}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredInvoices.map((record) => {
                const isActive = editingInvoiceId === record.id;
                return (
                  <div
                    key={record.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 border ${
                      isActive ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{record.invoiceNumber}</span>
                        <span className="text-[11px] text-slate-500">{record.invoiceDate}</span>
                        {isActive && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                            Editing
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {record.exportConfig?.provider?.name || '—'}
                        {' → '}
                        {record.exportConfig?.recipient?.name || '—'}
                        {' · '}
                        ${(record.amountUsd ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Updated {new Date(record.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLoadSavedInvoice(record)}
                      className="px-2.5 py-1.5 text-[10px] font-bold uppercase bg-emerald-600 text-white rounded hover:bg-emerald-700 shrink-0"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete ${record.invoiceNumber}? This cannot be undone.`)) {
                          handleDeleteSavedInvoice(record.id);
                        }
                      }}
                      className="px-2.5 py-1.5 text-[10px] font-bold uppercase bg-white border border-rose-200 text-rose-600 rounded hover:bg-rose-50 shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TransferPricing;
