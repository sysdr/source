import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import { resolvePublicAppBaseUrl } from './appBaseUrl';

describe('resolvePublicAppBaseUrl', () => {
  afterEach(() => {
    delete process.env.APP_BASE_URL;
    delete process.env.APP_FRONTEND_PORT;
    vi.restoreAllMocks();
  });

  it('keeps a non-loopback candidate as-is', () => {
    expect(resolvePublicAppBaseUrl('http://192.168.1.7:9000/')).toBe('http://192.168.1.7:9000');
  });

  it('rewrites localhost candidate to LAN IP preserving port', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [{
        address: '192.168.1.7',
        netmask: '255.255.255.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: false,
        cidr: '192.168.1.7/24',
      }],
    } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>);

    expect(resolvePublicAppBaseUrl('http://localhost:9000')).toBe('http://192.168.1.7:9000');
    expect(resolvePublicAppBaseUrl('http://127.0.0.1:9000')).toBe('http://192.168.1.7:9000');
  });

  it('uses APP_BASE_URL when candidate is localhost', () => {
    process.env.APP_BASE_URL = 'http://10.0.0.5:9000';
    expect(resolvePublicAppBaseUrl('http://localhost:9000')).toBe('http://10.0.0.5:9000');
  });
});
