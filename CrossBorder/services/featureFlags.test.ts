/** REQ: REQ-090 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isPeopleModuleEnabled, setFeatureFlag, PEOPLE_MODULE_FLAG } from './featureFlags';

describe('featureFlags', () => {
  beforeEach(() => {
    localStorage.removeItem(`suez_ff_${PEOPLE_MODULE_FLAG}`);
  });

  it('defaults People module to enabled', () => {
    expect(isPeopleModuleEnabled()).toBe(true);
  });

  it('respects explicit off (REQ-090)', () => {
    setFeatureFlag(PEOPLE_MODULE_FLAG, false);
    expect(isPeopleModuleEnabled()).toBe(false);
  });
});
