import { describe, expect, it } from 'vitest';
import { parseOrgAccountIdsFromSigmaError } from './stripeAccountDiscovery';

describe('stripeAccountDiscovery', () => {
  it('parses all acct ids from Sigma org probe error', () => {
    const message =
      'The query runs API is inaccessible. This action requires a Sigma subscription or trial. ' +
      'The following accounts are missing a Sigma plan: acct_1AAA, acct_1BBB, acct_1CCC.';
    expect(parseOrgAccountIdsFromSigmaError(message)).toEqual([
      'acct_1AAA',
      'acct_1BBB',
      'acct_1CCC',
    ]);
  });

  it('dedupes and sorts', () => {
    expect(parseOrgAccountIdsFromSigmaError('acct_b acct_a acct_b')).toEqual(['acct_a', 'acct_b']);
  });
});
