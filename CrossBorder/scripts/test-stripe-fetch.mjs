#!/usr/bin/env node
/**
 * Test script: fetch charges from Stripe for a specific account.
 * Usage:
 *   STRIPE_API_KEY=sk_test_... node scripts/test-stripe-fetch.mjs [accountId]
 * Default accountId: acct_1RVjHOGs1d9scdb0
 *
 * Uses Stripe-Account header (standalone / outside organisation).
 */

const accountId = process.argv[2] || 'acct_1RVjHOGs1d9scdb0';
const apiKey = process.env.STRIPE_API_KEY;

if (!apiKey || !apiKey.startsWith('sk_')) {
  console.error('Usage: STRIPE_API_KEY=sk_test_... node scripts/test-stripe-fetch.mjs [accountId]');
  process.exit(1);
}

const end = Math.floor(Date.now() / 1000);
const start = end - 90 * 24 * 60 * 60; // last 90 days

const url = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${start}&created[lte]=${end}&expand[]=data.customer`;
const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Stripe-Version': '2024-12-18.acacia',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Stripe-Account': accountId,
};

console.log('Fetching charges for account:', accountId);
console.log('Date range: last 90 days\n');

fetch(url, { method: 'GET', headers })
  .then(async (res) => {
    const body = await res.json();
    if (!res.ok) {
      console.error('Stripe API error:', body.error?.message || body);
      process.exit(1);
    }
    const data = body.data || [];
    console.log('Charges count:', data.length);
    if (data.length > 0) {
      console.log('\nFirst 5 charges:');
      data.slice(0, 5).forEach((c, i) => {
        const amt = (c.amount / 100).toFixed(2);
        const date = c.created ? new Date(c.created * 1000).toISOString().split('T')[0] : '—';
        console.log(`  ${i + 1}. ${c.id} | ${c.currency?.toUpperCase()} ${amt} | ${date} | ${c.status}`);
      });
    } else {
      console.log('No charges in range.');
    }
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
