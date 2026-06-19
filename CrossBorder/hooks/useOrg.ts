/**
 * useOrg — React Query hooks for org config data.
 *
 * Covers: company profile, stripe config, mercury config, transfer pricing,
 * platform rules, and any other org-scoped blob.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/apiClient';
import {
  getCompanyProfile, getStripeOrgConfig, setStripeOrgConfig,
  getActiveOrgId, storage, StorageKeys,
} from '../services/storageService';
import type { CompanyProfile } from '../types';
import type { StripeOrgConfig } from '../services/storageService';

export const orgKeys = {
  profile:     (orgId: string) => ['org', orgId, 'profile'] as const,
  stripeConfig:(orgId: string) => ['org', orgId, 'stripe'] as const,
  allData:     (orgId: string) => ['org', orgId] as const,
  data:        (orgId: string, key: string) => ['org', orgId, key] as const,
};

// ── Company profile ───────────────────────────────────────────────────────────
export function useCompanyProfile(orgId?: string) {
  const oid = orgId ?? getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: orgKeys.profile(oid),
    queryFn: async () => {
      const fromApi = await api.getOrgData<CompanyProfile>(oid, 'suez_company_profile');
      if (fromApi) return fromApi;
      return getCompanyProfile();
    },
    placeholderData: () => getCompanyProfile(),
    staleTime: 5 * 60_000, // profile rarely changes
  });
}

// ── Stripe config ─────────────────────────────────────────────────────────────
export function useStripeConfig(orgId?: string) {
  const oid = orgId ?? getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: orgKeys.stripeConfig(oid),
    queryFn: async () => {
      const fromApi = await api.getOrgData<StripeOrgConfig>(oid, 'suez_stripe_org_config');
      if (fromApi) return fromApi;
      return getStripeOrgConfig();
    },
    placeholderData: () => getStripeOrgConfig(),
    staleTime: 60_000,
  });
}

export function useUpdateStripeConfig() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (config: StripeOrgConfig) => {
      setStripeOrgConfig(config);
      await api.setOrgData(orgId, 'suez_stripe_org_config', config);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.stripeConfig(orgId) });
    },
  });
}

// ── Generic org data key ──────────────────────────────────────────────────────
export function useOrgData<T>(key: StorageKeys, orgId?: string) {
  const oid = orgId ?? getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: orgKeys.data(oid, key),
    queryFn: async () => {
      const fromApi = await api.getOrgData<T>(oid, key);
      if (fromApi !== null) return fromApi;
      return storage.get<T>(key);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    placeholderData: (storage.get<T>(key) ?? undefined) as any,
    staleTime: 60_000,
  });
}

export function useSetOrgData(key: StorageKeys) {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (value: unknown) => {
      storage.set(key, value);
      await api.setOrgData(orgId, key, value);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.data(orgId, key) });
    },
  });
}

// ── Prefetch all org data (call on app load) ──────────────────────────────────
export async function prefetchOrgData(orgId: string, qc: ReturnType<typeof useQueryClient>): Promise<void> {
  await qc.prefetchQuery({
    queryKey: orgKeys.profile(orgId),
    queryFn: () => api.getOrgData<CompanyProfile>(orgId, 'suez_company_profile'),
    staleTime: 5 * 60_000,
  });
  await qc.prefetchQuery({
    queryKey: orgKeys.stripeConfig(orgId),
    queryFn: () => api.getOrgData<StripeOrgConfig>(orgId, 'suez_stripe_org_config'),
    staleTime: 60_000,
  });
}
