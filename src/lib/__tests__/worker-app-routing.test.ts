import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ webContents: { fromId: () => null } }));
vi.mock('../../../main/agent/tools/navis/core/page-driver', () => ({ WebviewDriver: class {} }));
vi.mock('../../../main/agent/tools/navis/core/cloud-vm-driver', () => ({ CloudVmDriver: class { constructor(public target: unknown) {} } }));
vi.mock('../../../main/agent/tools/navis/core/local-vm-driver', () => ({ LocalVmDriver: class { constructor(public url: string) {} } }));

import { registerWorkerCloudVm, registerWorkerLocalVm, pickWorkerWindow } from '../../../main/agent/tools/navis/core/webview-registry';

describe('worker app routing', () => {
  it('selects a native app explicitly without using the last registered browser', () => {
    const partition = 'persist:worker-app-routing';
    expect(registerWorkerCloudVm(partition, 'terminal', 'vps-contabo', 'https://api.everfern.app', 'test')).toBe(true);
    expect(registerWorkerCloudVm(partition, 'chrome', 'vps-contabo', 'https://api.everfern.app', 'test')).toBe(true);
    expect(pickWorkerWindow('worker-app-routing', undefined, 'terminal')?.app).toBe('terminal');
    expect(pickWorkerWindow('worker-app-routing', undefined, 'files')).toBeNull();
  });

  it('stops selecting the old machine when the worker switches machines', () => {
    const partition = 'persist:worker-machine-routing';
    registerWorkerLocalVm(partition, 'browser', 'http://localhost:9222');
    registerWorkerCloudVm(partition, 'chrome', 'vps-contabo', 'https://api.everfern.app', 'test');
    expect(pickWorkerWindow('worker-machine-routing', undefined, 'chrome')?.app).toBe('chrome');
    expect(pickWorkerWindow('worker-machine-routing', undefined, 'browser')).toBeNull();
    registerWorkerLocalVm(partition, 'browser', 'http://localhost:9222');
    expect(pickWorkerWindow('worker-machine-routing', undefined, 'chrome')).toBeNull();
    expect(pickWorkerWindow('worker-machine-routing', undefined, 'browser')?.app).toBe('browser');
  });
});
