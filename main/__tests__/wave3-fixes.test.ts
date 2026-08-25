/**
 * Wave 3 fixes — normalizeLocalUrl + scheduler calculateNextRun termination contract.
 *
 * calculateNextRun regressions locked here:
 * - 'every N week' units were silently unsupported (cold start degraded to +1 day,
 *   and with a lastRun the past timestamp itself was returned, re-triggering the
 *   task on every 60s scheduler tick).
 * - malformed expressions like 'every banana' threw TypeError on unit.startsWith.
 * All interval cases must terminate in finite time (no main-process hangs).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Cut heavy transitive chains (sqlite/db, agent runner graph) — calculateNextRun
// and the exported singleton never touch these in the paths under test.
vi.mock('../store/scheduled-tasks', () => ({
  scheduledTasksStore: {
    list: vi.fn(async () => []),
    save: vi.fn(async () => undefined),
    updateRunTimes: vi.fn(async () => undefined),
  },
}));
vi.mock('../agent/runner/runner', () => ({ AgentRunner: class {} }));
vi.mock('../store/history', () => ({ ChatHistoryStore: class {} }));

import { SchedulerService } from '../integrations/scheduler-service';
import { normalizeLocalUrl } from '../lib/ai-client';

describe('normalizeLocalUrl', () => {
  it('rewrites http localhost preserving port and path', () => {
    expect(normalizeLocalUrl('http://localhost:11434')).toBe('http://127.0.0.1:11434');
    expect(normalizeLocalUrl('http://localhost')).toBe('http://127.0.0.1');
    expect(normalizeLocalUrl('http://localhost:8080/api/tags?x=1')).toBe(
      'http://127.0.0.1:8080/api/tags?x=1'
    );
  });

  it('rewrites bracketed IPv6 loopback (::1) preserving port and path', () => {
    expect(normalizeLocalUrl('http://[::1]:11434')).toBe('http://127.0.0.1:11434');
    expect(normalizeLocalUrl('http://[::1]/v1/chat')).toBe('http://127.0.0.1/v1/chat');
  });

  it('leaves https URLs alone (local inference endpoints are plain http)', () => {
    expect(normalizeLocalUrl('https://localhost:11434')).toBe('https://localhost:11434');
    expect(normalizeLocalUrl('https://[::1]:8080')).toBe('https://[::1]:8080');
  });

  it('passes through undefined and non-local URLs untouched', () => {
    expect(normalizeLocalUrl(undefined)).toBeUndefined();
    expect(normalizeLocalUrl('http://192.168.1.5:11434')).toBe('http://192.168.1.5:11434');
    expect(normalizeLocalUrl('http://example.com')).toBe('http://example.com');
  });
});

describe('SchedulerService.calculateNextRun', () => {
  const NOW = new Date('2026-08-25T10:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("'every 5 minutes' cold start advances exactly one interval, finite time", () => {
    const next = SchedulerService.calculateNextRun('every 5 minutes');
    expect(next.getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(Number.isNaN(next.getTime())).toBe(false);
  }, 2000);

  it("'every 1 week' terminates and lands exactly 7 days out (infinite-loop regression)", () => {
    const next = SchedulerService.calculateNextRun('every 1 week');
    expect(next.getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60_000);
  }, 2000);

  it("'every 1 week' with lastRun steps forward instead of returning the past", () => {
    const last = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000);
    const next = SchedulerService.calculateNextRun('every 1 week', last);
    expect(next.getTime()).toBe(last.getTime() + 7 * 24 * 60 * 60_000);
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
  }, 2000);

  it("'every banana' terminates via the default daily step with a valid Date", () => {
    const next = SchedulerService.calculateNextRun('every banana');
    expect(Number.isNaN(next.getTime())).toBe(false);
    expect(next.getTime()).toBe(NOW.getTime() + 24 * 60 * 60_000);
  }, 2000);

  it("non-positive values ('every 0 minutes', negative hours) terminate with a future date", () => {
    const zero = SchedulerService.calculateNextRun('every 0 minutes');
    expect(Number.isNaN(zero.getTime())).toBe(false);
    expect(zero.getTime()).toBeGreaterThan(NOW.getTime());

    const neg = SchedulerService.calculateNextRun('every -3 hours');
    expect(Number.isNaN(neg.getTime())).toBe(false);
    expect(neg.getTime()).toBeGreaterThan(NOW.getTime());
  }, 2000);

  it("existing 'daily' behavior is unregressed", () => {
    // Daily keeps the same wall-clock time one calendar day out.
    // Aug 25->26 crosses no DST in common TZs, so the epoch delta is exactly 24h.
    const next = SchedulerService.calculateNextRun('daily');
    expect(next.getTime()).toBe(NOW.getTime() + 86_400_000);
  });
});
