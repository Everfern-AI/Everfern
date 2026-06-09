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
      /* ── Actual mouse cursor with Navis magic ── */ \
      #cursor { \
        position: absolute; \
        width: 48px; \
        height: 48px; \
        --tilt: -8deg; \
        --sway-x: 0px; \
        --sway-y: 0px; \
        --scale: 1; \
        --trail-x: 15px; \
        --trail-y: 24px; \
        --trail-opacity: 0.42; \
        transition: opacity 0.16s ease; \
        opacity: 0; \
        z-index: 2147483647; \
        margin-left: -6px; \
        margin-top: -4px; \
        pointer-events: none; \
        will-change: left, top, opacity; \
      } \
      .cursor-aura { \
        position: absolute; \
        width: 42px; \
        height: 42px; \
        left: -11px; \
        top: -11px; \
        border-radius: 999px; \
        background: radial-gradient(circle, rgba(80, 197, 255, 0.36), rgba(151, 107, 255, 0.22) 44%, rgba(255,255,255,0.08) 58%, transparent 74%); \
        filter: blur(4px); \
        transform: translate3d(calc(var(--sway-x) * -0.75), calc(var(--sway-y) * -0.75), 0); \
        animation: cursor-aura 1.85s ease-in-out infinite; \
        transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1); \
      } \
      .cursor-trail { \
        position: absolute; \
        width: 7px; \
        height: 7px; \
        border-radius: 999px; \
        background: radial-gradient(circle, rgba(121, 224, 255, 0.88), rgba(99, 102, 241, 0.24) 62%, transparent 72%); \
        filter: blur(0.8px); \
        transform: translate3d(var(--trail-x), var(--trail-y), 0); \
        opacity: var(--trail-opacity); \
        animation: trail-drift 1.35s ease-in-out infinite; \
        transition: transform 0.34s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease; \
      } \
      .cursor-trail.t2 { \
        width: 5px; \
        height: 5px; \
        transform: translate3d(calc(var(--trail-x) + 9px), calc(var(--trail-y) + 8px), 0); \
        opacity: calc(var(--trail-opacity) * 0.72); \
        animation-delay: -0.45s; \
      } \
      .cursor-shell { \
        position: absolute; \
        left: 0; \
        top: 0; \
        width: 34px; \
        height: 34px; \
        transform-origin: 6px 5px; \
        transform: translate3d(var(--sway-x), var(--sway-y), 0) rotate(var(--tilt)) scale(var(--scale)); \
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); \
        filter: drop-shadow(0 2px 3px rgba(0,0,0,0.38)) \
                drop-shadow(0 7px 18px rgba(0,0,0,0.26)) \
                drop-shadow(0 0  8px rgba(82,197,255,0.34)) \
                drop-shadow(0 0 15px rgba(171,126,255,0.2)); \
      } \
      .cursor-sway { \
        width: 34px; \
        height: 34px; \
        transform-origin: 6px 5px; \
        animation: cursor-idle-sway 1.9s ease-in-out infinite; \
      } \
      #cursor.is-moving .cursor-sway { \
        animation-duration: 1.05s; \
      } \
      .cursor-sway svg { \
        display: block; \
        overflow: visible; \
      } \
      .cursor-body { \
        fill: rgba(255,255,255,0.98); \
        stroke: rgba(7,12,24,0.78); \
        stroke-width: 1.35; \
        stroke-linejoin: round; \
      } \
      .cursor-rim { \
        fill: none; \
        stroke: url(#__navis_cursor_rim); \
        stroke-width: 1.05; \
        stroke-linejoin: round; \
        opacity: 0.72; \
      } \
      .cursor-sheen { \
        fill: url(#__navis_cursor_sheen); \
        opacity: 0.58; \
      } \
      @keyframes cursor-idle-sway { \
        0%   { transform: translate3d(-0.55px, 0.12px, 0) rotate(-0.9deg); } \
        36%  { transform: translate3d(0.9px, -0.55px, 0) rotate(1.05deg); } \
        72%  { transform: translate3d(0.18px, 0.82px, 0) rotate(-0.55deg); } \
        100% { transform: translate3d(-0.55px, 0.12px, 0) rotate(-0.9deg); } \
      } \
      @keyframes cursor-aura { \
        0%, 100% { opacity: 0.54; } \
        50%      { opacity: 0.96; } \
      } \
      @keyframes trail-drift { \
        0%, 100% { filter: blur(1px); } \
        50%      { filter: blur(0.35px); } \
      } \
      .click-anim { \
        animation: none; \
      } \
      .click-anim .cursor-shell { \
        animation: shell-click 0.42s ease; \
      } \
      .click-anim .cursor-aura { \
        animation: aura-click 0.42s ease; \
      } \
      @keyframes shell-click { \
        0%   { transform: translate3d(var(--sway-x), var(--sway-y), 0) rotate(var(--tilt)) scale(1); } \
        42%  { transform: translate3d(calc(var(--sway-x) * 0.55), calc(var(--sway-y) * 0.55), 0) rotate(var(--tilt)) scale(0.82); } \
        100% { transform: translate3d(var(--sway-x), var(--sway-y), 0) rotate(var(--tilt)) scale(1); } \
      } \
      @keyframes aura-click { \
        0%   { opacity: 0.9; transform: scale(0.75); } \
        100% { opacity: 0;   transform: scale(1.85); } \
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
    cursor.innerHTML = '<div class="cursor-aura"></div><div class="cursor-trail"></div><div class="cursor-trail t2"></div><div class="cursor-shell"><div class="cursor-sway"><svg width="34" height="34" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> \
      <path class="cursor-body" d="M5.55 3.78C5.55 2.82 6.66 2.29 7.41 2.9L26.05 18.14C26.92 18.85 26.47 20.24 25.36 20.34L17.43 21.07L21.47 28.04C21.89 28.76 21.64 29.69 20.92 30.11L18.64 31.43C17.91 31.85 16.98 31.6 16.56 30.87L12.57 23.99L7.29 29.55C6.67 30.2 5.55 29.76 5.55 28.86V3.78Z"/> \
      <path class="cursor-sheen" d="M8.08 7.02L22.98 19.19L13.65 20.05L17.95 27.46L16.98 28.03L12.32 19.99L8.08 24.45V7.02Z"/> \
      <path class="cursor-rim" d="M5.55 3.78C5.55 2.82 6.66 2.29 7.41 2.9L26.05 18.14C26.92 18.85 26.47 20.24 25.36 20.34L17.43 21.07L21.47 28.04C21.89 28.76 21.64 29.69 20.92 30.11L18.64 31.43C17.91 31.85 16.98 31.6 16.56 30.87L12.57 23.99L7.29 29.55C6.67 30.2 5.55 29.76 5.55 28.86V3.78Z"/> \
      <defs><linearGradient id="__navis_cursor_sheen" x1="7" y1="4" x2="23" y2="29" gradientUnits="userSpaceOnUse"><stop stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#EAF8FF"/><stop offset="1" stop-color="#BDE9FF"/></linearGradient><linearGradient id="__navis_cursor_rim" x1="4" y1="2" x2="25" y2="31" gradientUnits="userSpaceOnUse"><stop stop-color="#FFFFFF"/><stop offset="0.42" stop-color="#61D5FF"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs> \
    </svg></div></div>';
    shadow.appendChild(cursor);

    if (document.body) {
      document.body.appendChild(container);
    } else {
      document.documentElement.appendChild(container);
    }
    console.log('[Navis] Overlay successfully created and appended with ID: ' + OVERLAY_ID);

    let currentX = null;
    let currentY = null;
    let targetX = null;
    let targetY = null;
    let lastCursorX = null;
    let lastCursorY = null;
    let animationFrameId = null;
    let clickPending = false;

    function lerp(start, end, amt) {
      return (1 - amt) * start + amt * end;
    }

    function updateCursorDom(x, y, isMoving) {
      const c = shadow.getElementById('cursor');
      if (!c) return;

      let tilt = -8;
      let swayX = 0;
      let swayY = 0;
      let scale = 1;
      let trailX = 15;
      let trailY = 24;
      let trailOpacity = 0.42;

      if (typeof lastCursorX === 'number' && typeof lastCursorY === 'number') {
        const dx = x - lastCursorX;
        const dy = y - lastCursorY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 0.1) {
          tilt = Math.max(-22, Math.min(16, (dx * 0.15) + (dy * 0.06) - 8));
          swayX = Math.max(-4.5, Math.min(4.5, -dx * 0.1));
          swayY = Math.max(-3.2, Math.min(3.2, -dy * 0.08));
          scale = Math.min(1.075, 1 + distance * 0.003);
          trailX = Math.max(6, Math.min(28, 15 - dx * 0.15));
          trailY = Math.max(13, Math.min(34, 24 - dy * 0.12));
          trailOpacity = Math.min(0.9, 0.38 + distance * 0.015);
        }
      }

      lastCursorX = x;
      lastCursorY = y;

      if (isMoving) {
        c.classList.add('is-moving');
      } else {
        c.classList.remove('is-moving');
      }

      c.style.opacity = '1';
      c.style.left = x + 'px';
      c.style.top = y + 'px';
      c.style.setProperty('--tilt', tilt.toFixed(2) + 'deg');
      c.style.setProperty('--sway-x', swayX.toFixed(2) + 'px');
      c.style.setProperty('--sway-y', swayY.toFixed(2) + 'px');
      c.style.setProperty('--scale', scale.toFixed(3));
      c.style.setProperty('--trail-x', trailX.toFixed(2) + 'px');
      c.style.setProperty('--trail-y', trailY.toFixed(2) + 'px');
      c.style.setProperty('--trail-opacity', trailOpacity.toFixed(2));
    }

    function animateCursor() {
      if (currentX === null || currentY === null) {
        currentX = targetX;
        currentY = targetY;
      }

      const dx = targetX - currentX;
      const dy = targetY - currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 0.8) {
        currentX = targetX;
        currentY = targetY;
        updateCursorDom(currentX, currentY, false);
        animationFrameId = null;

        if (clickPending) {
          clickPending = false;
          const c = shadow.getElementById('cursor');
          if (c) {
            c.classList.remove('click-anim');
            void c.offsetWidth;
            c.classList.add('click-anim');
          }
        }
        return;
      }

      currentX = lerp(currentX, targetX, 0.15);
      currentY = lerp(currentY, targetY, 0.15);

      updateCursorDom(currentX, currentY, true);

      animationFrameId = requestAnimationFrame(animateCursor);
    }

    window.__navis_controls = {
      setStatus: function(t) {
        const el = shadow.getElementById('text');
        if (el) el.textContent = t;
      },
      moveCursor: function(x, y, click) {
        targetX = x;
        targetY = y;
        if (click) {
          clickPending = true;
        }

        if (currentX === null || currentY === null) {
          currentX = x;
          currentY = y;
          updateCursorDom(x, y, false);
          if (clickPending) {
            clickPending = false;
            const c = shadow.getElementById('cursor');
            if (c) {
              c.classList.remove('click-anim');
              void c.offsetWidth;
              c.classList.add('click-anim');
            }
          }
          return;
        }

        if (!animationFrameId) {
          animationFrameId = requestAnimationFrame(animateCursor);
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
