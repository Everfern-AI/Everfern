import React from 'react';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ priority, ...props }: any) => <img {...props} /> }));
vi.mock('../Settings', () => ({ SettingsSheet: ({ onClose }: any) => <section role="dialog" aria-label="Settings"><button onClick={onClose}>Close settings</button></section>, logoutLocal: vi.fn() }));
vi.mock('../ModelSettings', () => ({ CloudGate: () => null, PaywallView: () => null, useCloudAuth: () => ({}) }));
vi.mock('../Desktop', () => ({ WorkerDesktop: () => null, windowsForApps: () => [{ id: 'chrome', app: 'chrome', z: 1 }] }));
vi.mock('@/lib/worker-engine', () => ({ hasAgent: () => true, parseSteps: (text: string) => text ? [text] : [], stopWorker: vi.fn(), runWorker: vi.fn(), planJob: async () => ({ live: true, kind: 'reply', reply: '# Two plans, one space\n\nCurrent status:\n\n- A daily weather briefing.\n- A recurring task.\n\nWhich job should this space run?', steps: [] }) }));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const cache = new Map();
  return { MotionConfig: ({ children }: any) => children, AnimatePresence: ({ children }: any) => children, motion: new Proxy({}, { get: (_, tag: string) => {
    if (!cache.has(tag)) cache.set(tag, React.forwardRef(({ initial, animate, exit, transition, variants, whileHover, whileTap, layout, ...props }: any, ref) => React.createElement(tag, { ...props, ref })));
    return cache.get(tag);
  } }) };
});
import WorkersPage from '../page';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('everfern_workers', JSON.stringify([{ id: 'reference', name: 'New worker', hue: 180, status: 'idle', tier: 'lite', machine: 'local', apps: ['files', 'browser', 'chrome', 'linkedin'], prompt: '', createdAt: new Date().toISOString() }]));
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it('keeps the reference navigation, dock and marketplace connected to real actions', async () => {
  const { container } = render(<WorkersPage />);
  await waitFor(() => expect(container.querySelector('.wk-wcard-name')).toBeTruthy());
  fireEvent.click(container.querySelector('.wk-wcard-name')!);
  expect(screen.queryByLabelText('Expand conversation')).toBeNull();
  expect(container.querySelectorAll('.wk-task')).toHaveLength(5);
  expect(container.querySelector('.wk-task-delete > svg')).toBeTruthy();
  expect(container.querySelector('.wk-task img[src="/images/logos/chrome-google.svg"]')).toBeTruthy();
  expect(container.querySelector('.wk-task img[src="/images/logos/files.svg"]')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Expand worker sidebar'));
  fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'Research' } });
  fireEvent.click(screen.getByLabelText('Create worker folder'));
  expect(JSON.parse(localStorage.getItem('everfern_worker_folders')!)).toEqual(['Research']);
  fireEvent.click(screen.getByText('Home', { selector: '.wk-folder-heading' }));
  fireEvent.change(screen.getByLabelText('Describe your task'), { target: { value: 'Plan my day' } });
  fireEvent.click(screen.getByLabelText('Send message'));
  await screen.findByText('Two plans, one space');
  expect(container.querySelector('.wk-msg-ai.is-document h2')).toBeTruthy();
  mkdirSync('scratch', { recursive: true });
  writeFileSync('scratch/reference-source-expanded.html', container.innerHTML);
  fireEvent.click(screen.getByRole('button', { name: 'Chrome (minimized)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
  expect(screen.getByLabelText('Expand conversation')).toBeVisible();
  expect(screen.getByLabelText('Expand conversation').textContent).toContain('Two plans, one space');
  expect(screen.getByLabelText('Expand conversation').textContent).not.toContain('#');
  writeFileSync('scratch/reference-source-peek.html', container.innerHTML);
  fireEvent.click(screen.getByLabelText('Collapse worker sidebar'));
  fireEvent.click(screen.getByLabelText('Add an app'));
  expect(screen.getByPlaceholderText('Browse apps...')).toBeVisible();
  expect(screen.queryByText('Install apps for')).toBeNull();
  expect(container.querySelector('.wk-chat-peek')).toBeNull();
  writeFileSync('scratch/reference-source-market.html', container.innerHTML);
  fireEvent.click(screen.getByLabelText('Settings'));
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  expect(container.querySelector('.wk.is-settings-open')).toBeTruthy();
  writeFileSync('scratch/reference-source-settings.html', container.innerHTML);
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  expect(container.querySelector('.wk.is-settings-open')).toBeNull();
}, 60000);
