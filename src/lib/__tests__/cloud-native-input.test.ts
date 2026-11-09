import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ nativeImage: {} }));
import { CloudVmDriver } from '../../../main/agent/tools/navis/core/cloud-vm-driver';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('native cloud app input', () => {
  it('scales cloud vision screenshots through CDP instead of Electron NativeImage', async () => {
    vi.stubEnv('EVERFERN_SHELL', 'tauri');
    const calls: any[] = [];
    vi.stubGlobal('__efNativeCloudRequest', vi.fn(async (_path, _token, body) => {
      calls.push(...body.calls);
      const call = body.calls[0];
      const result = call.method === 'Page.captureScreenshot' ? { data: 'test-image' }
        : { result: { value: call.params.expression === '1' ? 1 : { width: 2560, height: 1440, dpr: 1 } } };
      return { status: 200, ok: true, data: { engine: 'browserbase', results: [result] } };
    }));
    const driver = new CloudVmDriver({ vmId: 'vps-contabo', apiUrl: 'https://api.everfern.app', token: () => 'test-only', app: 'figma' });
    expect(await driver.screenshot(70)).toBe('data:image/jpeg;base64,test-image');
    expect(calls.at(-1).params.clip).toMatchObject({ width: 2560, height: 1440, scale: 0.5 });
  });
  const setup = () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ engine: 'vps', results: [] }) };
    }));
    const driver = new CloudVmDriver({ vmId: 'vps-contabo', apiUrl: 'https://api.everfern.app', token: () => 'test-only', app: 'terminal', worker: 'test' });
    return { driver, requests };
  };
  it('discovers the VM engine before typing and preserves capitals', async () => {
    const { driver, requests } = setup();
    await driver.typeText('Hello ABC', false);
    expect(requests[0].calls[0].method).toBe('Runtime.evaluate');
    expect(requests[1].calls).toEqual([{ method: 'ef.desktopText', params: { text: 'Hello ABC' } }]);
  });
  it('does not turn Control+L into Control+Shift+L', async () => {
    const { driver, requests } = setup();
    await driver.key('L', ['control']);
    expect(requests[1].calls[0]).toEqual({ method: 'ef.desktopKey', params: { key: 'l', modifiers: 2 } });
  });
  it('maps page and space keys to X11 names', async () => {
    const { driver, requests } = setup();
    await driver.key('PageUp', []);
    await driver.key('Space', []);
    expect(requests[1].calls[0].params.key).toBe('Prior');
    expect(requests[2].calls[0].params.key).toBe('space');
  });
});
