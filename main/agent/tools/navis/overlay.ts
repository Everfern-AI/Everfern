/**
 * Navis Overlay — Apple-style browser UI indicator
 * Injected into every page Navis controls via Playwright addInitScript.
 * Uses Shadow DOM for isolation and MutationObserver for persistence.
 */

const RAW_SCRIPT = `
(function() {
  // Inject overlay on all frames (top-level and iframes)
  // Each frame gets its own overlay instance with unique ID
  const frameId = 'frame_' + Math.random().toString(36).substr(2, 9);
  const OVERLAY_ID = '__navis_overlay_container_' + frameId;

  if (!document.getElementById('__navis_figtree')) {
    const link = document.createElement('link');
    link.id = '__navis_figtree';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&display=swap';
    (document.head || document.documentElement).appendChild(link);
  }

  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) {
      console.log('[Navis] Overlay already exists with ID: ' + OVERLAY_ID);
      return;
    }

    console.log('[Navis] Creating overlay with ID: ' + OVERLAY_ID + ' in frame: ' + frameId);

    const container = document.createElement('div');
    container.id = OVERLAY_ID;
    // Ensure overlay doesn't affect layout or scrolling
    container.style.cssText = 'position:fixed;top:0;left:0;bottom:0;right:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;display:block !important;visibility:visible !important;opacity:1 !important;margin:0;padding:0;border:none;overflow:hidden;touch-action:none;';

    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = ' \
      :host { \
        position: fixed; \
        inset: 0; \
        width: 100vw; \
        height: 100vh; \
        pointer-events: none; \
        z-index: 2147483647; \
        overflow: visible; \
      } \
      \
      /* ── Diagonal prismatic streak ── */ \
      .shimmer { \
        position: absolute; \
        inset: 0; \
        background: linear-gradient( \
          128deg, \
          transparent 0%, \
          transparent 30%, \
          rgba(255, 255, 255, 0.04) 38%, \
          rgba(255, 255, 255, 0.14) 45%, \
          rgba(255, 255, 255, 0.22) 50%, \
          rgba(255, 255, 255, 0.14) 55%, \
          rgba(255, 255, 255, 0.04) 62%, \
          transparent 70%, \
          transparent 100% \
        ); \
        background-size: 200% 200%; \
        animation: shimmer-sweep 7s infinite ease-in-out; \
        mix-blend-mode: overlay; \
        pointer-events: none; \
      } \
      @keyframes shimmer-sweep { \
        0%   { background-position: -100% 0%; opacity: 0.5; } \
        50%  { background-position: 200%  0%; opacity: 1;   } \
        100% { background-position: -100% 0%; opacity: 0.5; } \
      } \
      \
      /* ── Warm orange bokeh — bottom-left ── */ \
      .bokeh-left { \
        position: absolute; \
        width: 420px; \
        height: 320px; \
        bottom: -80px; \
        left: -80px; \
        background: radial-gradient( \
          ellipse at center, \
          rgba(255, 145, 30, 0.55) 0%, \
          rgba(255, 100, 10, 0.25) 40%, \
          transparent 70% \
        ); \
        filter: blur(28px); \
        animation: bokeh-breathe 5s infinite ease-in-out; \
        pointer-events: none; \
      } \
      \
      /* ── Warm orange bokeh — mid-right ── */ \
      .bokeh-right { \
        position: absolute; \
        width: 260px; \
        height: 300px; \
        right: 4%; \
        top: 30%; \
        background: radial-gradient( \
          ellipse at center, \
          rgba(255, 155, 40, 0.45) 0%, \
          rgba(255, 110, 10, 0.2) 45%, \
          transparent 70% \
        ); \
        filter: blur(22px); \
        animation: bokeh-breathe 6s infinite ease-in-out reverse; \
        pointer-events: none; \
      } \
      @keyframes bokeh-breathe { \
        0%   { opacity: 0.7; transform: scale(1);    } \
        50%  { opacity: 1;   transform: scale(1.08); } \
        100% { opacity: 0.7; transform: scale(1);    } \
      } \
      \
      /* ── Purple / pink neon border glow ── */ \
      .border-glow { \
        position: absolute; \
        inset: 0; \
        box-shadow: \
          inset 0  0 60px rgba(190, 60, 255, 0.25), \
          inset 0  0 20px rgba(220, 80, 255, 0.15); \
        border: 1.5px solid rgba(200, 80, 255, 0.35); \
        pointer-events: none; \
      } \
      \
      /* ── Pill indicator — center bottom ── */ \
      #pill { \
        position: absolute; \
        bottom: 28px; \
        left: 50%; \
        transform: translateX(-50%); \
        font-family: "Figtree", -apple-system, system-ui, sans-serif; \
        font-size: 13.5px; \
        font-weight: 500; \
        letter-spacing: 0.01em; \
        color: rgba(255, 255, 255, 0.92); \
        padding: 11px 20px; \
        border-radius: 40px; \
        display: flex; \
        align-items: center; \
        gap: 10px; \
        white-space: nowrap; \
        background: rgba(255, 255, 255, 0.12); \
        backdrop-filter: blur(48px) saturate(200%) brightness(1.2); \
        -webkit-backdrop-filter: blur(48px) saturate(200%) brightness(1.2); \
        border: 1px solid rgba(255, 255, 255, 0.22); \
        box-shadow: \
          inset 0  2px 0 rgba(255, 255, 255, 0.18), \
          inset 0 -1px 0 rgba(255, 255, 255, 0.06), \
          0 8px 32px rgba(0, 0, 0, 0.28); \
        pointer-events: auto; \
        z-index: 100; \
        overflow: hidden; \
      } \
      #pill::before { \
        content: ""; \
        position: absolute; \
        inset: 0; \
        border-radius: inherit; \
        background: linear-gradient( \
          135deg, \
          rgba(255, 255, 255, 0.18) 0%, \
          transparent 50%, \
          rgba(255, 255, 255, 0.04) 100% \
        ); \
        pointer-events: none; \
      } \
      #pill::after { \
        content: ""; \
        position: absolute; \
        top: 0; \
        left: 10%; \
        right: 10%; \
        height: 1px; \
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent); \
        border-radius: 100%; \
        pointer-events: none; \
      } \
      #dot { \
        width: 9px; \
        height: 9px; \
        background: #3B9EFF; \
        border-radius: 50%; \
        flex-shrink: 0; \
        position: relative; \
        z-index: 1; \
        animation: pulse 2s infinite; \
        pointer-events: none; \
      } \
      @keyframes pulse { \
        0%   { box-shadow: 0 0 0 0   rgba(59, 158, 255, 0.55); } \
        70%  { box-shadow: 0 0 0 8px rgba(59, 158, 255, 0);    } \
        100% { box-shadow: 0 0 0 0   rgba(59, 158, 255, 0);    } \
      } \
      #pill span { \
        position: relative; \
        z-index: 1; \
        pointer-events: none; \
      } \
      \
      /* ── 4-pointed star cursor ── */ \
      #cursor { \
        position: absolute; \
        width: 36px; \
        height: 36px; \
        transition: left 0.4s cubic-bezier(0.25, 0.1, 0.25, 1), \
                    top  0.4s cubic-bezier(0.25, 0.1, 0.25, 1); \
        opacity: 0; \
        z-index: 2147483647; \
        filter: drop-shadow(0 2px 10px rgba(0,0,0,0.35)) \
                drop-shadow(0 0  4px  rgba(255,255,255,0.6)); \
        margin-left: -18px; \
        margin-top: -18px; \
        pointer-events: none; \
      } \
      .click-anim { \
        animation: click 0.5s ease; \
      } \
      @keyframes click { \
        0%   { transform: scale(1);   } \
        40%  { transform: scale(0.6); } \
        100% { transform: scale(1);   } \
      } \
      \
      /* ── Element highlight ── */ \
      #highlight { \
        position: absolute; \
        border: 2px solid #007AFF; \
        border-radius: 8px; \
        background: rgba(0, 122, 255, 0.1); \
        transition: all 0.4s ease; \
        opacity: 0; \
        box-shadow: 0 0 20px rgba(0, 122, 255, 0.3); \
        pointer-events: none; \
      } \
    ';

    shadow.appendChild(style);

    const shimmer = document.createElement('div');
    shimmer.className = 'shimmer';
    shadow.appendChild(shimmer);

    const bokehLeft = document.createElement('div');
    bokehLeft.className = 'bokeh-left';
    shadow.appendChild(bokehLeft);

    const bokehRight = document.createElement('div');
    bokehRight.className = 'bokeh-right';
    shadow.appendChild(bokehRight);

    const borderGlow = document.createElement('div');
    borderGlow.className = 'border-glow';
    shadow.appendChild(borderGlow);

    const highlight = document.createElement('div');
    highlight.id = 'highlight';
    shadow.appendChild(highlight);

    const pill = document.createElement('div');
    pill.id = 'pill';
    pill.innerHTML = '<div id="dot"></div><span id="text">Navis Active</span>';
    shadow.appendChild(pill);

    const cursor = document.createElement('div');
    cursor.id = 'cursor';
    cursor.innerHTML = '<svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"> \
      <path \
        d="M24 4 Q30 18 44 24 Q30 30 24 44 Q18 30 4 24 Q18 18 24 4Z" \
        fill="rgba(255,255,255,0.95)" \
      /> \
      <path \
        d="M24 4 Q30 18 44 24 Q30 30 24 44 Q18 30 4 24 Q18 18 24 4Z" \
        fill="none" \
        stroke="rgba(0,0,0,0.10)" \
        stroke-width="0.5" \
      /> \
    </svg>';
    shadow.appendChild(cursor);

    if (document.body) {
      document.body.appendChild(container);
    } else {
      document.documentElement.appendChild(container);
    }
    console.log('[Navis] Overlay successfully created and appended with ID: ' + OVERLAY_ID);

    window.__navis_controls = {
      setStatus: function(t) {
        const el = shadow.getElementById('text');
        if (el) el.textContent = t;
      },
      moveCursor: function(x, y, click) {
        const c = shadow.getElementById('cursor');
        if (!c) return;
        c.style.opacity = '1';
        c.style.left = x + 'px';
        c.style.top = y + 'px';
        if (click) {
          c.classList.remove('click-anim');
          void c.offsetWidth;
          c.classList.add('click-anim');
        }
      },
      highlight: function(r) {
        const h = shadow.getElementById('highlight');
        if (!h) return;
        h.style.left = r.x + 'px';
        h.style.top = r.y + 'px';
        h.style.width = r.width + 'px';
        h.style.height = r.height + 'px';
        h.style.opacity = '1';
        window.__navis_controls.moveCursor(r.x + r.width / 2, r.y + r.height / 2, true);
        setTimeout(function() { h.style.opacity = '0'; }, 1500);
      },
      hideOverlay: function() {
        const c = document.getElementById(OVERLAY_ID);
        if (c) c.style.opacity = '0';
      },
      showOverlay: function() {
        const c = document.getElementById(OVERLAY_ID);
        if (c) c.style.opacity = '1';
      },
      hideForScreenshot: function() {
        const c = document.getElementById(OVERLAY_ID);
        if (c) {
          c.style.display = 'none';
          c.style.visibility = 'hidden';
          c.style.pointerEvents = 'none';
        }
      },
      showAfterScreenshot: function() {
        const c = document.getElementById(OVERLAY_ID);
        if (c) {
          c.style.display = 'block';
          c.style.visibility = 'visible';
          c.style.pointerEvents = 'none';
        }
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createOverlay);
  } else {
    createOverlay();
  }

  // Aggressive persistence: recreate overlay if missing
  setInterval(() => {
    const existing = document.getElementById(OVERLAY_ID);
    if (!existing) {
      console.log('[Navis] Overlay missing, recreating...');
      createOverlay();
    } else if (document.body && existing.parentElement !== document.body && existing.parentElement !== document.documentElement) {
      console.log('[Navis] Overlay parent incorrect, reattaching...');
      if (document.body) {
        document.body.appendChild(existing);
      } else {
        document.documentElement.appendChild(existing);
      }
    }
  }, 500);

  // Watch for page visibility changes and recreate overlay if needed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const existing = document.getElementById(OVERLAY_ID);
      if (!existing) {
        createOverlay();
      }
    }
  });

  // Watch for dynamic page loads (SPA navigation)
  const observer = new MutationObserver(() => {
    const existing = document.getElementById(OVERLAY_ID);
    if (!existing && document.body) {
      createOverlay();
    }
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: false,
      attributes: false
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, {
        childList: true,
        subtree: false,
        attributes: false
      });
    });
  }
})();
`;

export const OVERLAY_SCRIPT = RAW_SCRIPT;
