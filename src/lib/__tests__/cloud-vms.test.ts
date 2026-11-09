import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cloudDesktopUrl, saveCloudBrowserState, ensureCloudVm, closeCloudApp } from '../cloud-vms';

const clone = { id: 'a'.repeat(64), data: 'saved-cookie-clone', kind: 'cookies' };
const load = vi.fn();
const save = vi.fn();
const fetchMock = vi.fn();
const reply = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('everfern_cloud_session', JSON.stringify({ user: { id: 'account-1' }, accessToken: 'test' }));
  (window as any).electronAPI = { workers: { browserStateLoad: load, browserStateSave: save } };
  load.mockResolvedValue(null);
  save.mockResolvedValue({ success: true });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('cloud browser persistence', () => {
  it('automatically reserves an available machine for a new cloud worker', async () => {
    fetchMock.mockResolvedValue(reply({ vm: { id: 'vps-contabo', status: 'started' } }));
    expect(await ensureCloudVm({ workerId: 'new-worker', name: 'Research' })).toMatchObject({ vm: { id: 'vps-contabo' } });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/cloud-machines/assign');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ worker_id: 'new-worker' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('reports exhausted capacity instead of creating an unrelated machine', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'No cloud machine is available.' }, 409));
    expect(await ensureCloudVm({ workerId: 'new-worker' })).toEqual({ error: 'No cloud machine is available.' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('restores the worker clone on a replacement VM using Browserbase', async () => {
    load.mockImplementation(async (scope: string) => scope === 'account-1.bb.worker-1' ? clone : null);
    fetchMock.mockResolvedValue(reply({ url: 'https://browser.test/live', engine: 'browserbase' }));
    await cloudDesktopUrl('replacement-vm', 'https://example.com', 'browser', 'worker-1');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('/replacement-vm/desktop');
    expect(JSON.parse(request.body)).toMatchObject({ engine: 'browserbase', worker: 'worker-1', bb_state: clone });
  });

  it('defaults cookie backups to Browserbase and keeps accounts/workers isolated', async () => {
    fetchMock.mockResolvedValue(reply(clone));
    expect(await saveCloudBrowserState('vm', { worker: 'worker-2' })).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('engine=browserbase&worker=worker-2');
    expect(save).toHaveBeenCalledWith('account-1.bb.worker-2', clone.id, clone.data, 'cookies');
  });

  it('retains the previous backup when the remote state has not changed', async () => {
    load.mockResolvedValue(clone);
    fetchMock.mockResolvedValue(reply({ id: clone.id, unchanged: true }));
    expect(await saveCloudBrowserState('vm', { worker: 'worker-1' })).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toContain(`since=${clone.id}`);
  });

  it('reports a rejected local write instead of claiming a backup succeeded', async () => {
    fetchMock.mockResolvedValue(reply(clone));
    save.mockResolvedValue({ success: false });
    expect(await saveCloudBrowserState('vm')).toBe(false);
  });

  it('coalesces overlapping backups so an older snapshot cannot overwrite a newer one', async () => {
    fetchMock.mockResolvedValue(reply(clone));
    await Promise.all([saveCloudBrowserState('vm'), saveCloudBrowserState('vm')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps worker/app identity on older servers that accept GET only', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 405)).mockResolvedValueOnce(reply({ url: 'https://browser.test' }));
    await cloudDesktopUrl('vm', 'https://example.com', 'mail', 'worker-2');
    expect(fetchMock.mock.calls[1][0]).toContain('engine=browserbase');
    expect(fetchMock.mock.calls[1][0]).toContain('app=mail&worker=worker-2');
  });

  it('opens Chrome as a full VM browser, while other apps request Browserbase', async () => {
    fetchMock.mockResolvedValue(reply({ url: 'https://vm.test', engine: 'kasmvnc' }));
    expect(await cloudDesktopUrl('vm', 'https://google.com', 'chrome', 'worker-1')).toMatchObject({ engine: 'kasmvnc' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).engine).toBe('vm');
  });

  it('rejects the shared VNC screen for app windows instead of duplicating the same site', async () => {
    fetchMock.mockResolvedValue(reply({ url: 'https://vm.test', engine: 'kasmvnc' }));
    const result = await cloudDesktopUrl('vm', 'https://mail.google.com', 'mail', 'worker-1');
    expect(result.url).toBeUndefined();
    expect(result.error).toContain('shared desktop');
  });

  it('does not reuse an unscoped cookie clone when the account is unknown', async () => {
    localStorage.clear();
    expect(await saveCloudBrowserState('vm')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts VPS as the isolated fallback provider', async () => {
    fetchMock.mockResolvedValue(reply({ url: 'https://vps.test/live', engine: 'vps' }));
    expect(await cloudDesktopUrl('vm', 'https://mail.google.com', 'mail', 'worker-1')).toMatchObject({ url: 'https://vps.test/live', engine: 'vps' });
  });

  it('keeps VPS cookie backups in the same worker jar across provider switches', async () => {
    fetchMock.mockResolvedValue(reply(clone));
    expect(await saveCloudBrowserState('vm', { engine: 'vps', worker: 'worker-1' })).toBe(true);
    expect(save).toHaveBeenCalledWith('account-1.bb.worker-1', clone.id, clone.data, 'cookies');
  });
});


describe('cloud app shutdown', () => {
  it('waits for local persistence before stopping its scoped app', async () => {
    fetchMock.mockResolvedValueOnce(reply(clone)).mockResolvedValueOnce(reply({ ok: true }));
    let finish!: (value: { success: boolean }) => void;
    save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const closing = closeCloudApp('vm', 'worker-1', 'chrome');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish({ success: true });
    await closing;
    expect(fetchMock.mock.calls[1][0]).toContain('/vm/close-app');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ worker: 'worker-1', app: 'chrome' });
  });
  it('keeps the remote profile running when the local backup fails', async () => {
    fetchMock.mockResolvedValue(reply(clone)); save.mockResolvedValue({ success: false });
    await closeCloudApp('vm', 'worker-1', 'chrome');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
