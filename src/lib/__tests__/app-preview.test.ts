// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../cloud-vms', () => ({ cloudDesktopUrl: vi.fn(), cloudFetch: vi.fn() }));
import { cloudDesktopUrl, cloudFetch } from '../cloud-vms';
import { captureCloudAppPreview, captureLocalAppPreview } from '../app-preview';
const desktop = vi.mocked(cloudDesktopUrl), rpc = vi.mocked(cloudFetch);
const response = (data: unknown) => ({ ok: true, status: 200, data });
beforeEach(() => { vi.resetAllMocks(); desktop.mockResolvedValue({ url: 'https://vm.example/app', engine: 'browserbase' }); });

it('captures the worker app target and preserves its redirected current URL', async () => {
  rpc.mockResolvedValueOnce(response({ engine: 'browserbase', page: { url: 'https://claude.ai/chat/123' }, results: [{}] }));
  rpc.mockResolvedValueOnce(response({ results: [{ data: 'AAAA' }] }));
  expect(await captureCloudAppPreview('vm-one', 'worker-one', 'claude', 'https://claude.ai')).toBe('data:image/jpeg;base64,AAAA');
  expect(desktop).not.toHaveBeenCalled();
  expect(rpc.mock.calls.every(([, init]) => JSON.parse(init!.body as string).create === false)).toBe(true);
  const calls = rpc.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
  expect(calls.every(call => call.worker === 'worker-one' && call.app === 'claude')).toBe(true);
  expect(calls.flatMap(call => call.calls).map(call => call.method)).toEqual(['Runtime.evaluate', 'Page.captureScreenshot']);
});

it('uses the native desktop screenshot inside the terminal app container', async () => {
  desktop.mockResolvedValue({ url: 'https://vm.example/terminal', engine: 'vps' });
  rpc.mockResolvedValueOnce(response({ engine: 'vps', page: { url: 'about:blank' }, results: [{}] }));
  rpc.mockResolvedValueOnce(response({ results: [{ data: 'BBBB' }] }));
  expect(await captureCloudAppPreview('vm-two', 'worker-two', 'terminal')).toBe('data:image/png;base64,BBBB');
  expect(JSON.parse(rpc.mock.calls[1][1]!.body as string)).toMatchObject({ worker: 'worker-two', app: 'terminal', calls: [{ method: 'ef.desktopScreenshot' }] });
});

it('deduplicates captures without navigating a blank app or provisioning another session', async () => {
  rpc.mockResolvedValueOnce(response({ engine: 'browserbase', page: { url: 'about:blank' }, results: [{}] }));
  rpc.mockResolvedValueOnce(response({ results: [{ data: 'CCCC' }] }));
  const first = captureCloudAppPreview('vm-three', 'worker-three', 'chatgpt', 'https://chatgpt.com');
  expect(captureCloudAppPreview('vm-three', 'worker-three', 'chatgpt', 'https://chatgpt.com')).toBe(first);
  await expect(first).resolves.toBe('data:image/jpeg;base64,CCCC');
  expect(desktop).not.toHaveBeenCalled();
  expect(rpc.mock.calls.flatMap(([,init]) => JSON.parse(init!.body as string).calls).map(call => call.method)).toEqual(['Runtime.evaluate','Page.captureScreenshot']);
});

it('leaves unopened apps unprovisioned when there is no live preview', async () => {
  rpc.mockResolvedValueOnce({ok:false,status:503,data:{error:'Not open'}});
  await expect(captureCloudAppPreview('vm-no-session','worker-no-session','terminal')).rejects.toThrow('Not open');
  expect(desktop).not.toHaveBeenCalled();
  expect(JSON.parse(rpc.mock.calls[0][1]!.body as string).create).toBe(false);
});

it('rejects app identifiers that the server would discard into its shared target', async () => {
  await expect(captureCloudAppPreview('vm-four', 'worker-four', 'custom:unsupported')).rejects.toThrow('isolated preview target');
  expect(rpc).not.toHaveBeenCalled();
  expect(desktop).not.toHaveBeenCalled();
});

it('does not start a preview after its app has closed', async () => {
  const signal = new AbortController(); signal.abort();
  await expect(captureCloudAppPreview('vm-cancelled', 'worker-cancelled', 'chatgpt', 'https://chatgpt.com', signal.signal)).rejects.toThrow('cancelled');
  expect(desktop).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it('passes the local capture through the VM bridge with encoded arguments', async () => {
  const vmExec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ image: 'data:image/jpeg;base64,DDDD' }) });
  vi.stubGlobal('window', { electronAPI: { workers: { vmExec } } });
  try {
    const url = "https://example.com/?q='$(not-a-command)'";
    expect(await captureLocalAppPreview('worker-local', 'browser', url)).toBe('data:image/jpeg;base64,DDDD');
    expect(vmExec.mock.calls[0][0]).toBe('worker-local');
    const command = vmExec.mock.calls[0][1];
    expect(command).not.toContain(url);
    const encoded = command.match(/'([^']+)'$/)[1];
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toEqual({ worker: 'worker-local', app: 'browser', url });
    await expect(captureLocalAppPreview('../invalid', 'browser', url)).rejects.toThrow('Invalid Alpine app target');
    expect(vmExec).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
