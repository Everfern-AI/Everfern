import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicOnly, isPrivateAddress } from '../../../main/agent/tools/net-guard';

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

describe('worker web fetches (audit 9)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a public URL that redirects to a private address', async () => {
    const fetchMock = vi.fn(async () => redirect('http://169.254.169.254/latest/meta-data/'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPublicOnly('http://93.184.216.34/')).rejects.toThrow(/local network/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the private hop was never requested
  });

  it('follows redirects between public addresses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchPublicOnly('http://93.184.216.34/start');
    expect(await res.text()).toBe('ok');
    expect(fetchMock.mock.calls[1][0]).toBe('http://93.184.216.34/next');
  });

  it('stops after 5 redirects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => redirect('http://93.184.216.34/again')));
    await expect(fetchPublicOnly('http://93.184.216.34/')).rejects.toThrow(/Too many redirects/);
  });

  it('knows private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });
});
