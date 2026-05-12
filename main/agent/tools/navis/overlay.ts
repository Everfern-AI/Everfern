/**
 * Navis Overlay — Apple-style browser UI indicator
 * Injected into every page Navis controls via Playwright addInitScript.
 * Non-intrusive: pointer-events: none, system fonts, minimal.
 */

export const OVERLAY_SCRIPT = `
(function() {
  if (window.__navis_overlay) return;
  window.__navis_overlay = true;

  const style = document.createElement('style');
  style.textContent = \`
    @keyframes navis-shimmer-filter {
      0% { filter: hue-rotate(0deg); }
      100% { filter: hue-rotate(360deg); }
    }
    @keyframes navis-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0); }
      50% { box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.15); }
    }
    @keyframes navis-fadein {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    #navis-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    }
    #navis-border {
      position: absolute;
      inset: 0;
    }
    #navis-border::before {
      content: '';
      position: absolute;
      inset: 0;
      border: 4px solid transparent;
      border-image: linear-gradient(90deg, #ff8a00, #e52e71, #9b51e0, #4facfe, #ff8a00) 1;
      animation: navis-shimmer-filter 4s linear infinite;
    }
    #navis-border::after {
      content: '';
      position: absolute;
      inset: 0;
      box-shadow: inset 0 0 30px rgba(229, 46, 113, 0.6), inset 0 0 60px rgba(155, 81, 224, 0.4);
      animation: navis-shimmer-filter 4s linear infinite;
    }
    #navis-pill {
      position: absolute;
      top: 10px;
      right: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border: 0.5px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
      font-size: 11px;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.65);
      letter-spacing: -0.01em;
      animation: navis-fadein 0.3s ease;
    }
    #navis-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #007AFF;
      animation: navis-pulse 2s ease infinite;
      flex-shrink: 0;
    }
    #navis-highlight {
      position: absolute;
      pointer-events: none;
      border: 2px solid rgba(0, 122, 255, 0.45);
      border-radius: 6px;
      box-shadow: 0 0 8px rgba(0, 122, 255, 0.12);
      transition: all 0.2s ease;
      opacity: 0;
    }
  \`;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'navis-overlay';
  overlay.innerHTML = '<div id="navis-border"></div><div id="navis-pill"><div id="navis-dot"></div><span id="navis-text">Loading...</span></div><div id="navis-highlight"></div>';
  document.documentElement.appendChild(overlay);

  window.__navis_set_status = function(text) {
    const el = document.getElementById('navis-text');
    if (el) el.textContent = text;
  };

  window.__navis_highlight = function(rect) {
    const el = document.getElementById('navis-highlight');
    if (!el) return;
    el.style.left = rect.x + 'px';
    el.style.top = rect.y + 'px';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    el.style.opacity = '1';
    clearTimeout(window.__navis_hl_timeout);
    window.__navis_hl_timeout = setTimeout(function() { el.style.opacity = '0'; }, 400);
  };
})();
`;
