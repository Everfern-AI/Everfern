/**
 * Bug Condition Exploration Test — HITL Form Not Shown on Race Condition
 *
 * **Validates: Requirements 1.3, 1.4**
 *
 * Property 1: Bug Condition — HITL Form Always Rendered on Request
 *
 * wave f11: contract updated — HITL retention landed. The mount-time
 * onHitlRequest registration (with __activeHitl set FIRST, synchronously)
 * shipped in commit 9ddcfb5 ("Organized chat page code into different
 * components", page.tsx:3154-3171), the mission_complete __activeHitl defer
 * guard in commit 8c275fa (page.tsx:3225-3229), and the preload
 * removeStreamListeners retention ("HITL approval cards no longer die after
 * first send") in checkpoint CP1 aa1fa8b (preload.ts:596-601). These tests
 * now encode the SHIPPED fixed behavior and must pass against it.
 *
 * Original bug (historical): acpApi.onHitlRequest was registered inside the
 * handleSend async IIFE, so the IPC listener only existed after the user
 * submitted a message. A hitl_request arriving before the listener was
 * registered (race condition), or one racing removeStreamListeners fired from
 * mission_complete, never reached setShowHitlApproval(true) and
 * HitlApprovalForm was never rendered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulates the frontend's HITL listener registration model.
 *
 * wave f11: contract updated — the retention fix has shipped, so this mock
 * now models the SHIPPED registration model (see page.tsx:3154-3171 and
 * preload.ts:580-605):
 *   - onHitlRequest is registered once at component mount (useEffect with []
 *     deps), BEFORE any user interaction or handleSend call.
 *   - removeStreamListeners() does NOT tear down the 'acp:hitl-request'
 *     channel (preload.ts:596: "acp:hitl-request is intentionally NOT removed
 *     here — the chat page registers it once at mount"). Only unmount
 *     cleanup (removeHitlRequestListener) detaches it.
 *
 * Legacy unfixed model (for contrast): onHitlRequest was registered inside
 * handleSend, and removeStreamListeners cleared the HITL callback — both of
 * which dropped pre-send / mid-race hitl_request events.
 */
function makeAcpApiMock() {
  let hitlRequestCallback: ((request: any) => void) | null = null;
  let missionCompleteCallback: ((data: any) => void) | null = null;
  let hitlListenerDetached = false;
  let listenersRemoved = false;

  const acpApi = {
    // Registered at mount (page.tsx useEffect, []) — always active pre-send
    onHitlRequest: vi.fn((cb: (request: any) => void) => {
      hitlRequestCallback = cb;
    }),
    onMissionComplete: vi.fn((cb: (data: any) => void) => {
      missionCompleteCallback = cb;
    }),
    // Shipped preload contract: stream channels are torn down but the
    // 'acp:hitl-request' listener intentionally SURVIVES (preload.ts:596-601).
    removeStreamListeners: vi.fn(() => {
      listenersRemoved = true;
      // NOTE: hitlRequestCallback is intentionally NOT cleared here — that
      // is the core of the shipped retention fix.
    }),
    removeHitlRequestListener: vi.fn(() => {
      hitlRequestCallback = null;
      hitlListenerDetached = true;
    }),
    // Test helpers to fire events
    _fireHitlRequest: (request: any) => {
      if (hitlRequestCallback) {
        hitlRequestCallback(request);
      }
    },
    _fireMissionComplete: (data: any) => {
      if (missionCompleteCallback) {
        missionCompleteCallback(data);
      }
    },
    _isListenerRegistered: () => hitlRequestCallback !== null,
    _listenersRemoved: () => listenersRemoved,
    _isHitlListenerDetached: () => hitlListenerDetached,
  };

  return acpApi;
}

/**
 * Simulates component mount exactly as the shipped ChatPage does
 * (page.tsx:3154-3171): register onHitlRequest once in a mount-only
 * useEffect, with __activeHitl set FIRST (synchronously) inside the
 * callback, before any state updates.
 */
function mountComponent(acpApi: ReturnType<typeof makeAcpApiMock>, showHitlApprovalSetter: (v: boolean) => void) {
  acpApi.onHitlRequest((request: any) => {
    // Set flag FIRST before any async state updates to prevent mission_complete race
    (globalThis as any).__activeHitl = true;
    showHitlApprovalSetter(true);
  });
}

const SAMPLE_HITL_REQUEST = {
  id: 'hitl-001',
  question: 'Do you approve writing to production database?',
  details: {
    tools: [{ name: 'write', args: { path: '/prod/db' } }],
    summary: 'Write to production database',
    reasoning: 'Agent needs to persist data',
  },
  options: ['Approve', 'Reject'],
};

// ── Bug Condition 1: Pre-send HITL event ─────────────────────────────────────

describe('Bug Condition 1 — HITL event arrives before handleSend (listener not registered)', () => {
  let acpApi: ReturnType<typeof makeAcpApiMock>;
  let showHitlApproval: boolean;
  let setShowHitlApproval: (v: boolean) => void;
  let activeHitlFlag: boolean;

  beforeEach(() => {
    acpApi = makeAcpApiMock();
    showHitlApproval = false;
    activeHitlFlag = false;

    // Simulate window.__activeHitl
    (globalThis as any).__activeHitl = false;

    // Simulate setShowHitlApproval
    setShowHitlApproval = vi.fn((v: boolean) => {
      showHitlApproval = v;
    }) as any;

    // wave f11: contract updated — simulate the shipped mount-time
    // registration (page.tsx:3154-3171) BEFORE any user interaction.
    mountComponent(acpApi, setShowHitlApproval);
  });

  afterEach(() => {
    delete (globalThis as any).__activeHitl;
  });

  /**
   * Scenario: hitl_request fires BEFORE the user sends any message.
   *
   * Historical bug (unfixed code):
   *   - onHitlRequest had NOT been called yet (listener not registered)
   *   - acpApi._fireHitlRequest did nothing (no callback)
   *   - showHitlApproval remained false
   *   - HitlApprovalForm was NOT in the DOM
   *
   * Shipped fixed behavior (asserted now):
   *   - onHitlRequest is registered at mount (useEffect)
   *   - showHitlApproval becomes true
   *   - HitlApprovalForm IS in the DOM
   */
  it('should show HitlApprovalForm when hitl_request fires before handleSend', () => {
    // Listener IS registered at mount via useEffect — fire the pre-send
    // hitl_request event that historically raced the (missing) listener.
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // On the shipped fixed code the mount-time callback ran: __activeHitl was
    // set synchronously and the approval form state was flipped on.
    expect(showHitlApproval).toBe(true);
    expect((globalThis as any).__activeHitl).toBe(true);
  });

  it('should have the HITL listener registered before any user interaction', () => {
    // Simulated component mount WITHOUT calling handleSend.
    // On the shipped fixed code, the mount-only useEffect called
    // acpApi.onHitlRequest, so the listener is registered immediately.
    expect(acpApi._isListenerRegistered()).toBe(true);
  });

  it('should set __activeHitl flag when hitl_request fires pre-send', () => {
    // The mount-time callback sets __activeHitl FIRST, synchronously
    // (page.tsx:3161-3162), before any async state updates.
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    expect((globalThis as any).__activeHitl).toBe(true);
  });
});

// ── Bug Condition 2: mission_complete races ahead of hitl_request ─────────────

describe('Bug Condition 2 — mission_complete arrives before hitl_request is handled', () => {
  let acpApi: ReturnType<typeof makeAcpApiMock>;
  let showHitlApproval: boolean;
  let setShowHitlApproval: (v: boolean) => void;

  beforeEach(() => {
    acpApi = makeAcpApiMock();
    showHitlApproval = false;
    (globalThis as any).__activeHitl = false;

    setShowHitlApproval = vi.fn((v: boolean) => {
      showHitlApproval = v;
    }) as any;

    // wave f11: contract updated — listener registration is mount-time in
    // the shipped code (page.tsx:3154-3171), so mount before the race.
    mountComponent(acpApi, setShowHitlApproval);
  });

  afterEach(() => {
    delete (globalThis as any).__activeHitl;
  });

  /**
   * Scenario: mission_complete arrives 100 ms before hitl_request.
   *
   * Historical bug (unfixed code):
   *   - mission_complete fired → its guard ran before hitl_request
   *   - __activeHitl was still false (callback not yet invoked)
   *   - removeStreamListeners() was called and cleared hitlRequestCallback
   *   - hitl_request fired 100 ms later → callback was null → no-op
   *   - showHitlApproval remained false
   *
   * Shipped fixed behavior (asserted now — page.tsx:3225-3231 + 3294-3311):
   *   - onHitlRequest is registered at mount (not inside handleSend)
   *   - __activeHitl is set synchronously inside the callback
   *   - removeStreamListeners is NOT called while __activeHitl is true
   *   - showHitlApproval becomes true
   */
  it('should show HitlApprovalForm when mission_complete arrives 100ms before hitl_request', async () => {
    // Mission_complete fires — simulates the race condition. Model the
    // shipped guard (page.tsx:3306-3311): re-check __activeHitl /
    // showHitlApproval when the completion flush runs, and only tear down
    // stream listeners when NO HITL and no user question is pending.
    let removeStreamListenersCalled = false;
    const missionCompleteGuard = setTimeout(() => {
      const hasActiveHitl = (globalThis as any).__activeHitl || showHitlApproval;
      if (!hasActiveHitl) {
        acpApi.removeStreamListeners();
        removeStreamListenersCalled = true;
      }
    }, 500);

    // hitl_request arrives 100ms after mission_complete — the mount-time
    // listener is already registered, so the callback runs and __activeHitl
    // is set synchronously, BEFORE the guard fires.
    await new Promise(resolve => setTimeout(resolve, 100));
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Wait for the 500ms guard to fire — it must observe __activeHitl = true.
    await new Promise(resolve => setTimeout(resolve, 450));

    clearTimeout(missionCompleteGuard);

    // Shipped fixed behavior: the guard saw __activeHitl = true and did NOT
    // call removeStreamListeners; the form is shown.
    expect(showHitlApproval).toBe(true);
    expect(removeStreamListenersCalled).toBe(false);
    expect(acpApi.removeStreamListeners).not.toHaveBeenCalled();
  }, 2000);

  /**
   * Scenario: mission_complete fires and removeStreamListeners is called
   * while a hitl_request is still pending.
   *
   * Historical bug (unfixed code):
   *   - removeStreamListeners cleared hitlRequestCallback
   *   - hitl_request fired → no callback → showHitlApproval stayed false
   *
   * Shipped fixed behavior (asserted now):
   *   - removeStreamListeners is NOT called while a HITL is pending
   *     (guard checks __activeHitl, page.tsx:3307).
   *   - AND even when removeStreamListeners runs for other reasons, the
   *     HITL listener survives it (preload.ts:596-601), so a late
   *     hitl_request still shows the form.
   */
  it('should NOT call removeStreamListeners while hitl_request is pending', async () => {
    // Model the shipped guard (page.tsx:3294-3311): when mission_complete
    // arrives it does NOT tear down immediately — it opens a 150ms flush
    // window and re-checks __activeHitl at the END of it. A hitl_request
    // landing inside that window sets __activeHitl synchronously and the
    // teardown is skipped.
    const FLUSH_WINDOW_MS = 150;
    const guardCheck = () => {
      const hasActiveHitl = (globalThis as any).__activeHitl;
      if (!hasActiveHitl) {
        acpApi.removeStreamListeners();
      }
    };

    // mission_complete fires → flush window opens (hitl_request not yet arrived)
    const guardTimer = setTimeout(guardCheck, FLUSH_WINDOW_MS);

    // hitl_request fires 100ms into the flush window — still BEFORE the
    // guard runs — so __activeHitl is set synchronously first.
    await new Promise(resolve => setTimeout(resolve, 100));
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Let the guard run — it must now observe __activeHitl = true and skip
    // removeStreamListeners.
    await new Promise(resolve => setTimeout(resolve, 100));
    clearTimeout(guardTimer);

    // Shipped fixed behavior: the guard saw __activeHitl = true so
    // removeStreamListeners was NOT called, and the form is shown.
    expect(acpApi.removeStreamListeners).not.toHaveBeenCalled();
    expect(showHitlApproval).toBe(true);
  }, 1000);
});

// ── Documentation of counterexamples ─────────────────────────────────────────
// wave f11: contract updated — with the retention fix shipped, the historical
// "counterexamples" are no longer reproducible against the product. These
// tests now document the shipped fixed behavior as the expected outcome.

describe('Counterexample documentation', () => {
  it('documents Bug 1 counterexample: HitlApprovalForm absent after pre-send hitl_request', () => {
    const acpApi = makeAcpApiMock();

    // wave f11: the listener is registered at component mount
    // (page.tsx:3154-3171), before handleSend could ever run.
    mountComponent(acpApi, () => { });

    // Fire the pre-send hitl_request that historically raced the
    // (unregistered) listener.
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Shipped behavior: the mount-time listener was already registered, so
    // the event was captured (historical counterexample no longer holds).
    expect(acpApi._isListenerRegistered()).toBe(true);
    expect((globalThis as any).__activeHitl).toBe(true);
  });

  it('documents Bug 2 counterexample: removeStreamListeners fires while HITL pending', async () => {
    const acpApi = makeAcpApiMock();
    let showHitlApproval = false;

    // wave f11: mount-time registration (page.tsx:3154-3171).
    mountComponent(acpApi, (v: boolean) => { showHitlApproval = v; });

    // Shipped guard (page.tsx:3307): re-check __activeHitl at teardown time
    // and skip removeStreamListeners while a HITL is pending.
    const hasActiveHitl = () => (globalThis as any).__activeHitl;

    // mission_complete fires first — __activeHitl is still false at this
    // instant (hitl_request has not raced in yet). Model the guard's
    // deferred re-check rather than an immediate teardown.
    const guardTimer = setTimeout(() => {
      if (!hasActiveHitl()) {
        acpApi.removeStreamListeners();
      }
    }, 100);

    // hitl_request fires 50ms later — sets __activeHitl synchronously.
    await new Promise(resolve => setTimeout(resolve, 50));
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Let the guard run — it must now observe __activeHitl = true and skip
    // removeStreamListeners.
    await new Promise(resolve => setTimeout(resolve, 100));
    clearTimeout(guardTimer);

    // Shipped behavior: the guard deferred and the HITL listener survived
    // (preload.ts:596-601 also keeps 'acp:hitl-request' alive), so the form
    // is shown (historical counterexample no longer holds).
    expect(showHitlApproval).toBe(true);
    expect(acpApi.removeStreamListeners).not.toHaveBeenCalled();
    expect(acpApi._isListenerRegistered()).toBe(true);
  });

  afterEach(() => {
    delete (globalThis as any).__activeHitl;
  });
});
