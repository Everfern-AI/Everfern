import React from 'react';
import {render,waitFor,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ priority, ...props }: any) => <img {...props} /> }));
vi.mock('../Settings', () => ({ SettingsSheet: ({ onClose }: any) => <section role="dialog" aria-label="Settings"><button onClick={onClose}>Close settings</button></section>, logoutLocal: vi.fn() }));
vi.mock('../ModelSettings', () => ({ CloudGate: () => null, PaywallView: () => null, useCloudAuth: () => ({}) }));
vi.mock('../Desktop', () => ({ WorkerDesktop: () => null, windowsForApps: () => [{ id: 'chrome', app: 'chrome', z: 1 }] }));
vi.mock('@/lib/worker-engine', () => ({ hasAgent: () => true, parseSteps: (text: string) => [text], stopWorker: vi.fn(), runWorker: vi.fn(async () => ({live:true,text:'Test report'})), planJob: vi.fn() }));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const cache = new Map();
  return { MotionConfig: ({ children }: any) => children, AnimatePresence: ({ children }: any) => children, motion: new Proxy({}, { get: (_, tag: string) => {
    if (!cache.has(tag)) cache.set(tag, React.forwardRef(({ initial, animate, exit, transition, variants, whileHover, whileTap, layout, ...props }: any, ref) => React.createElement(tag, { ...props, ref })));
    return cache.get(tag);
  } }) };
});

import WorkersPage from '../page';
import {runWorker} from '@/lib/worker-engine';
let worker:any;
let save:any;
beforeEach(()=>{localStorage.clear();vi.mocked(runWorker).mockClear();worker={id:'scheduled-worker',name:'Scheduled worker',hue:180,status:'idle',tier:'lite',machine:'local',apps:['chrome'],prompt:'Check the assigned VM browser',createdAt:new Date().toISOString(),schedule:{kind:'hourly',label:'Every hour',nextRun:new Date(Date.now()-60000).toISOString(),timeZone:'Asia/Calcutta'}};save=vi.fn(async()=>({success:true}));(window as any).electronAPI={workers:{list:vi.fn(async()=>[worker]),save}};Element.prototype.scrollTo=vi.fn();Element.prototype.scrollIntoView=vi.fn()});
afterEach(()=>{cleanup();delete (window as any).electronAPI});
it('claims a due schedule before running the same worker on its selected VM',async()=>{render(<WorkersPage/>);await waitFor(()=>expect(runWorker).toHaveBeenCalledOnce(),{timeout:5000});const scheduled=vi.mocked(runWorker).mock.calls[0][0];expect(scheduled.id).toBe('scheduled-worker');expect(scheduled.machine).toBe('local');expect(Date.parse(scheduled.schedule!.nextRun)).toBeGreaterThan(Date.now());expect(save.mock.calls[0][0].schedule.nextRun).toBe(scheduled.schedule!.nextRun)});
it('leaves paused workers scheduled without executing them',async()=>{worker.status='paused';const {container}=render(<WorkersPage/>);await waitFor(()=>expect(container.querySelector('.wk-wcard-name')).toBeTruthy());expect(runWorker).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()});
