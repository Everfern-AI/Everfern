/**
 * Navis — Screenshot Serialization Queue
 *
 * Ported from BrowserOS browser-core/src/core/screenshot-queue.ts
 *
 * Serializes concurrent screenshot captures per page so that annotation
 * overlay DOM manipulations (which are page-global) never interleave.
 * Without this, two simultaneous screenshot requests can produce
 * screenshots with missing or doubled bounding-box annotations.
 */

import { Page } from 'playwright';

const screenshotCaptureQueues = new WeakMap<Page, Promise<void>>();

/**
 * Runs `task` exclusively — any concurrent call for the same page waits
 * until the previous task completes before starting.
 */
export async function runExclusiveScreenshotCapture<T>(
  page: Page,
  task: () => Promise<T>,
): Promise<T> {
  const previous = screenshotCaptureQueues.get(page) ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  // Chain: tail = previous settling → current pending. Store tail so the
  // next waiter chains onto it.
  const tail = previous.catch(() => {}).then(() => current);
  screenshotCaptureQueues.set(page, tail);

  // Wait for the previous task to finish before running ours.
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    releaseCurrent();
    // Clean up the WeakMap entry if we were the last task.
    if (screenshotCaptureQueues.get(page) === tail) {
      screenshotCaptureQueues.delete(page);
    }
  }
}
