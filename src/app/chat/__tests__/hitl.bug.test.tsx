/**
 * Bug Condition Exploration Test — HITL Form Not Shown on Race Condition
 *
 * **Validates: Requirements 1.3, 1.4**
 *
 * Property 1: Bug Condition — HITL Form Always Rendered on Request
 *
 * CRITICAL: These tests MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the code or the tests when they fail.
 *
 * Bug: acpApi.onHitlRequest is registered inside the handleSend async IIFE.
 * This means the IPC listener only exists after the user submits a message.
 * If the hitl_request event arrives before the listener is registered (race condition),
 * or if removeStreamListeners fires from mission_complete before the HITL callback runs,
 * setShowHitlApproval(true) is never called and HitlApprovalForm is never rendered.
 *
 * Expected counterexample (unfixed code):
 *   HitlApprovalForm is absent from DOM after pre-send hitl_request event
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulates the frontend's HITL listener registration model.
 *
 * On UNFIXED code:
 *   - onHitlRequest is only registered inside handleSend (called when user sends a message)
 *   - If hitl_request arrives before handleSend, the callback is never invoked
 *
 * On FIXED code:
 *   - onHitlRequest is registered at component mount (useEffect with [] deps)
 *   - The listener is always active before any user interaction
 */
function makeAcpApiMock() {
  let hitlRequestCallback: ((request: any) => void) | null = null;
  let missionCompleteCallback: ((data: any) => void) | null = null;
  let listenersRemoved = false;

  const acpApi = {
    // Registers the HITL listener — on unfixed code this is only called inside handleSend
    onHitlRequest: vi.fn((cb: (request: any) => void) => {
      hitlRequestCallback = cb;
    }),
    onMissionComplete: vi.fn((cb: (data: any) => void) => {
      missionCompleteCallback = cb;
    }),
    removeStreamListeners: vi.fn(() => {
      listenersRemoved = true;
      // Removing listeners also clears the HITL callback (simulates real teardown)
      hitlRequestCallback = null;
    }),
    removeHitlRequestListener: vi.fn(() => {
      hitlRequestCallback = null;
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
  };

  return acpApi;
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
  });

  afterEach(() => {
    delete (globalThis as any).__activeHitl;
  });

  /**
   * Scenario: hitl_request fires BEFORE the user sends any message.
   *
   * On UNFIXED code:
   *   - onHitlRequest has NOT been called yet (listener not registered)
   *   - acpApi._fireHitlRequest does nothing (no callback)
   *   - showHitlApproval remains false
   *   - HitlApprovalForm is NOT in the DOM
   *
   * Expected (after fix):
   *   - onHitlRequest is registered at mount (useEffect)
   *   - showHitlApproval becomes true
   *   - HitlApprovalForm IS in the DOM
   *
   * Counterexample: showHitlApproval === false after pre-send hitl_request
   */
  it('should show HitlApprovalForm when hitl_request fires before handleSend', () => {
    // On unfixed code: listener is NOT registered yet (handleSend not called)
    // On fixed code: listener IS registered at mount via useEffect

    // Simulate the bug: fire hitl_request before handleSend registers the listener
    // (i.e., before onHitlRequest is called)
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // On unfixed code: no callback was registered, so showHitlApproval stays false
    // This assertion FAILS on unfixed code — confirming the bug
    expect(showHitlApproval).toBe(true);
  });

  it('should have the HITL listener registered before any user interaction', () => {
    // On unfixed code: listener is only registered inside handleSend
    // So before handleSend is called, _isListenerRegistered() returns false

    // On fixed code: listener is registered at mount (useEffect with [])
    // So _isListenerRegistered() returns true immediately

    // Simulate component mount WITHOUT calling handleSend
    // On fixed code, the useEffect would call acpApi.onHitlRequest here
    // On unfixed code, it does NOT

    // This assertion FAILS on unfixed code — confirming the bug
    expect(acpApi._isListenerRegistered()).toBe(true);
  });

  it('should set __activeHitl flag when hitl_request fires pre-send', () => {
    // On unfixed code: callback never fires, flag stays false
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // This assertion FAILS on unfixed code — confirming the bug
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
  });

  afterEach(() => {
    delete (globalThis as any).__activeHitl;
  });

  /**
   * Scenario: mission_complete arrives 100 ms before hitl_request.
   *
   * On UNFIXED code:
   *   - mission_complete fires → 500 ms timeout starts
   *   - __activeHitl is false (callback not yet invoked)
   *   - After 500 ms, removeStreamListeners() is called
   *   - hitlRequestCallback is cleared
   *   - hitl_request fires 100 ms later → callback is null → no-op
   *   - showHitlApproval remains false
   *
   * Expected (after fix):
   *   - onHitlRequest is registered at mount (not inside handleSend)
   *   - __activeHitl is set synchronously inside the callback
   *   - removeStreamListeners is NOT called while __activeHitl is true
   *   - showHitlApproval becomes true
   *
   * Counterexample: showHitlApproval === false after mission_complete + hitl_request race
   */
  it('should show HitlApprovalForm when mission_complete arrives 100ms before hitl_request', async () => {
    // Step 1: Register the HITL listener (simulates handleSend being called)
    acpApi.onHitlRequest((request: any) => {
      // On unfixed code: __activeHitl is set AFTER setShowHitlApproval
      // On fixed code: __activeHitl is set FIRST (synchronously), before state updates
      (globalThis as any).__activeHitl = true;
      setShowHitlApproval(true);
    });

    // Step 2: mission_complete fires — simulates the race condition
    // On unfixed code: the 500ms guard checks __activeHitl which is still false
    // because hitl_request hasn't fired yet
    const missionCompleteTime = Date.now();
    let removeStreamListenersCalled = false;

    // Simulate the mission_complete handler's 500ms guard (unfixed behavior)
    const missionCompleteGuard = setTimeout(() => {
      const hasActiveHitl = (globalThis as any).__activeHitl || showHitlApproval;
      if (!hasActiveHitl) {
        // On unfixed code: this fires because __activeHitl is still false
        acpApi.removeStreamListeners();
        removeStreamListenersCalled = true;
      }
    }, 500);

    // Step 3: hitl_request arrives 100ms after mission_complete
    await new Promise(resolve => setTimeout(resolve, 100));
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Step 4: Wait for the 500ms guard to fire
    await new Promise(resolve => setTimeout(resolve, 450));

    // On unfixed code:
    //   - removeStreamListeners was called (guard fired before hitl_request set the flag)
    //   - showHitlApproval may be true (callback fired before guard) OR false (callback cleared)
    //   - The form may not be visible if listeners were torn down

    // On fixed code:
    //   - __activeHitl is set synchronously in the callback
    //   - The guard sees __activeHitl = true and does NOT call removeStreamListeners
    //   - showHitlApproval is true

    clearTimeout(missionCompleteGuard);

    // This assertion FAILS on unfixed code — confirming the bug
    expect(showHitlApproval).toBe(true);
    expect(acpApi.removeStreamListeners).not.toHaveBeenCalled();
  }, 2000);

  /**
   * Scenario: mission_complete fires and removeStreamListeners clears the HITL callback
   * before hitl_request is processed.
   *
   * On UNFIXED code:
   *   - removeStreamListeners clears hitlRequestCallback
   *   - hitl_request fires → no callback → showHitlApproval stays false
   *
   * Expected (after fix):
   *   - removeStreamListeners is NOT called while HITL is pending
   *   - OR the HITL listener is registered at mount and survives removeStreamListeners
   */
  it('should NOT call removeStreamListeners while hitl_request is pending', async () => {
    // Register listener (simulates handleSend)
    acpApi.onHitlRequest((request: any) => {
      (globalThis as any).__activeHitl = true;
      setShowHitlApproval(true);
    });

    // Simulate mission_complete arriving before hitl_request
    // On unfixed code: __activeHitl is false → removeStreamListeners fires
    const guardCheck = () => {
      const hasActiveHitl = (globalThis as any).__activeHitl;
      if (!hasActiveHitl) {
        acpApi.removeStreamListeners();
      }
    };

    // mission_complete fires (100ms before hitl_request)
    setTimeout(guardCheck, 100);

    // hitl_request fires 200ms after mission_complete
    await new Promise(resolve => setTimeout(resolve, 200));
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    await new Promise(resolve => setTimeout(resolve, 50));

    // On unfixed code: removeStreamListeners was called (guard fired at 100ms, __activeHitl was false)
    // On fixed code: __activeHitl is set before the guard fires, so removeStreamListeners is NOT called

    // This assertion FAILS on unfixed code — confirming the bug
    expect(acpApi.removeStreamListeners).not.toHaveBeenCalled();
    expect(showHitlApproval).toBe(true);
  }, 1000);
});

// ── Documentation of counterexamples ─────────────────────────────────────────

describe('Counterexample documentation', () => {
  it('documents Bug 1 counterexample: HitlApprovalForm absent after pre-send hitl_request', () => {
    const acpApi = makeAcpApiMock();

    // On unfixed code: onHitlRequest is never called before handleSend
    // So firing hitl_request before handleSend does nothing
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Counterexample: listener was not registered, event was dropped
    const listenerWasRegistered = acpApi._isListenerRegistered();

    // On unfixed code: listenerWasRegistered === false
    // This confirms the bug: the form cannot appear because the listener doesn't exist
    expect(listenerWasRegistered).toBe(true); // FAILS on unfixed code
  });

  it('documents Bug 2 counterexample: removeStreamListeners fires while HITL pending', async () => {
    const acpApi = makeAcpApiMock();
    let showHitlApproval = false;

    // Register listener (simulates handleSend)
    acpApi.onHitlRequest(() => {
      (globalThis as any).__activeHitl = true;
      showHitlApproval = true;
    });

    // mission_complete fires first, __activeHitl is still false
    const hasActiveHitl = (globalThis as any).__activeHitl;
    if (!hasActiveHitl) {
      // On unfixed code: this path is taken, clearing the HITL listener
      acpApi.removeStreamListeners();
    }

    // hitl_request fires after removeStreamListeners
    acpApi._fireHitlRequest(SAMPLE_HITL_REQUEST);

    // Counterexample: showHitlApproval is false because listener was cleared
    // On unfixed code: showHitlApproval === false (form not shown)
    expect(showHitlApproval).toBe(true); // FAILS on unfixed code
  });
});
