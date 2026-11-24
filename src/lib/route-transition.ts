/**
 * The move between Workers and Chat. Workers is the desktop underneath; Chat sits just above it.
 * Going to Chat, Workers recedes and Chat settles down onto it; going back reverses the same path.
 *
 * Two routes in, one shape: a client-side push runs inside a View Transition (old and new pages are
 * snapshots, so layout is never disturbed); a full page load fades the old page out, and the head
 * script in layout.tsx plays the arrival on the next document from its very first paint.
 */

export type RouteDirection = "to-chat" | "to-workers";

/** sessionStorage key the layout head script reads to play the arrival after a full page load. */
export const ROUTE_ENTER_KEY = "ef-route-enter";

/** Fired by a destination page once it has mounted, so the View Transition captures it rendered. */
export const ROUTE_READY_EVENT = "ef:route-ready";

const EXIT_MS = 170;
const READY_TIMEOUT_MS = 1500;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Client-side navigation (router.push) wrapped in a View Transition. */
export function pushWithTransition(direction: RouteDirection, push: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> } };
  if (reducedMotion() || typeof doc.startViewTransition !== "function") {
    push();
    return;
  }
  const root = document.documentElement;
  root.dataset.efRoute = direction;
  const transition = doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          window.removeEventListener(ROUTE_READY_EVENT, done);
          resolve();
        };
        const timer = window.setTimeout(done, READY_TIMEOUT_MS);
        window.addEventListener(ROUTE_READY_EVENT, done);
        push();
      }),
  );
  // A skipped transition (hidden window, another transition) still gets the arrival, once the new page is up.
  transition.ready.catch(() => {
    transition.updateCallbackDone.then(() => playArrival(direction), () => playArrival(direction));
  });
  transition.finished.finally(() => {
    if (root.dataset.efRoute === direction) delete root.dataset.efRoute;
  }).catch(() => {});
}

function playArrival(direction: RouteDirection): void {
  const root = document.documentElement;
  root.dataset.efEnter = direction;
  window.setTimeout(() => {
    if (root.dataset.efEnter === direction) delete root.dataset.efEnter;
  }, 450);
}

/** Full page load (location.href): fade this page out, then let the next document play its arrival. */
export function loadWithTransition(direction: RouteDirection, href: string): void {
  try {
    sessionStorage.setItem(ROUTE_ENTER_KEY, direction);
  } catch {}
  if (reducedMotion()) {
    window.location.href = href;
    return;
  }
  document.documentElement.dataset.efRouteExit = direction;
  window.setTimeout(() => {
    window.location.href = href;
  }, EXIT_MS);
}

/** Call once from a destination page's mount effect. */
export function signalRouteReady(): void {
  window.dispatchEvent(new Event(ROUTE_READY_EVENT));
}
