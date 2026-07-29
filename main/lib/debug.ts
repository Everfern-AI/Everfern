import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';

export const DebugEmitter = new EventEmitter();

let debugWin: BrowserWindow | null = null;
const logs: Array<{ time: string; level: 'info' | 'warn' | 'error'; title: string; data: any }> = [];

// Terminal ANSI Color Constants
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';

DebugEmitter.on('log', (entry: { time: string; level: 'info' | 'warn' | 'error'; title: string; data: any }) => {
  logs.push(entry);
  if (logs.length > 2000) logs.shift(); // Keep last 2000 logs in memory

  if (debugWin && !debugWin.isDestroyed()) {
    debugWin.webContents.executeJavaScript(`window.appendLog(${JSON.stringify(JSON.stringify(entry))})`).catch(() => {});
  }
});

/**
 * Hooks into console.log/warn/error to enhance terminal output with ANSI colors
 * and pipe events to the Ctrl+Shift+P Debug Monitor Window.
 */
export function setupLogging() {
  try {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      const timeStr = new Date().toLocaleTimeString();
      const firstArg = args[0];
      const title = typeof firstArg === 'string' ? firstArg : 'Log';

      // Format terminal line with ANSI colors
      if (typeof firstArg === 'string' && (firstArg.startsWith('[') || firstArg.startsWith('('))) {
        const formatted = `${GRAY}[${timeStr}]${RESET} ${CYAN}${BOLD}${args[0]}${RESET} ${args.slice(1).map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
        originalLog.call(console, formatted);
      } else {
        originalLog.apply(console, args);
      }

      try {
        DebugEmitter.emit('log', {
          time: new Date().toISOString(),
          level: 'info',
          title,
          data: args.length > 1 ? args.slice(1) : args[0]
        });
      } catch (e) { /* ignore emission errors */ }
    };

    console.warn = (...args: any[]) => {
      const timeStr = new Date().toLocaleTimeString();
      const formatted = `${GRAY}[${timeStr}]${RESET} ${YELLOW}${BOLD}⚠️ ${args[0]}${RESET} ${args.slice(1).map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
      originalWarn.call(console, formatted);

      try {
        DebugEmitter.emit('log', {
          time: new Date().toISOString(),
          level: 'warn',
          title: typeof args[0] === 'string' ? args[0] : 'WARNING',
          data: args.length > 1 ? args.slice(1) : args[0]
        });
      } catch (e) { /* ignore */ }
    };

    console.error = (...args: any[]) => {
      const timeStr = new Date().toLocaleTimeString();
      const formatted = `${GRAY}[${timeStr}]${RESET} ${RED}${BOLD}❌ ${args[0]}${RESET} ${args.slice(1).map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
      originalError.call(console, formatted);

      try {
        DebugEmitter.emit('log', {
          time: new Date().toISOString(),
          level: 'error',
          title: typeof args[0] === 'string' ? args[0] : 'ERROR',
          data: args.length > 1 ? args.slice(1) : args[0]
        });
      } catch (e) { /* ignore */ }
    };

    logs.push({
      time: new Date().toISOString(),
      level: 'info',
      title: '[System]',
      data: 'Console logging hooked cleanly. Advanced diagnostics active.'
    });

    originalLog.call(console, `${CYAN}${BOLD}[Debug] ANSI Terminal logging & Ctrl+Shift+P Monitor active.${RESET}`);
  } catch (err) {
    process.stdout.write('FAILED TO HOOK LOGGING: ' + String(err) + '\n');
  }
}

/**
 * Toggles the Ctrl+Shift+P Debug Monitor Window.
 * If open, focuses or closes it. If closed, opens it.
 */
export function toggleDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) {
    if (debugWin.isFocused()) {
      debugWin.close();
      debugWin = null;
    } else {
      debugWin.focus();
    }
    return;
  }

  debugWin = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    title: 'EverFern Debug & Terminal Monitor (Ctrl+Shift+P)',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>EverFern Debug & Terminal Monitor</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-main: #090d16;
          --bg-card: #111827;
          --bg-header: #1f2937;
          --border: #1e293b;
          --text: #f3f4f6;
          --text-dim: #9ca3af;
          --accent: #38bdf8;
          --accent-warn: #fbbf24;
          --accent-error: #f87171;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg-main); color: var(--text); font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        header { background: var(--bg-header); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; gap: 15px; }
        .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; color: var(--accent); letter-spacing: -0.3px; }
        .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .search-input { background: #0b0f19; border: 1px solid var(--border); color: #fff; padding: 7px 14px; border-radius: 6px; font-size: 13px; font-family: 'JetBrains Mono', monospace; outline: none; width: 240px; transition: border-color 0.2s; }
        .search-input:focus { border-color: var(--accent); }
        .btn { background: #374151; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; font-family: 'Outfit', sans-serif; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.2px; }
        .btn:hover { background: #4b5563; }
        .btn.active { background: var(--accent); color: #090d16; font-weight: 700; }
        .btn-danger { background: #7f1d1d; color: #fecaca; }
        .btn-danger:hover { background: #991b1b; }
        .stats-bar { background: #0b0f19; border-bottom: 1px solid var(--border); padding: 8px 20px; display: flex; gap: 20px; font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); }
        .stat-item { display: flex; align-items: center; gap: 6px; }
        .stat-val { font-weight: 700; color: var(--text); }
        #logs-container { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px; font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 12.5px; }
        .log-row { background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; transition: border-color 0.15s; }
        .log-row:hover { border-color: #334155; }
        .log-row.warn { border-left: 4px solid var(--accent-warn); }
        .log-row.error { border-left: 4px solid var(--accent-error); }
        .log-row.info { border-left: 4px solid var(--accent); }
        .log-header { padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); cursor: pointer; user-select: none; }
        .log-title-group { display: flex; align-items: center; gap: 10px; overflow: hidden; }
        .badge { padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.5px; }
        .badge.info { background: rgba(56, 189, 248, 0.15); color: var(--accent); }
        .badge.warn { background: rgba(251, 191, 36, 0.15); color: var(--accent-warn); }
        .badge.error { background: rgba(248, 113, 113, 0.15); color: var(--accent-error); }
        .log-time { color: var(--text-dim); font-size: 11px; font-family: 'JetBrains Mono', monospace; }
        .log-title { font-weight: 600; color: var(--text); font-family: 'JetBrains Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text; cursor: text; }
        .log-body { padding: 10px 12px; background: #070a12; border-top: 1px solid rgba(255,255,255,0.05); color: #cbd5e1; font-family: 'JetBrains Mono', monospace; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; font-size: 12px; line-height: 1.5; }
        .copy-btn { background: transparent; border: 1px solid transparent; color: var(--text-dim); padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.15s, border-color 0.15s, color 0.15s; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; }
        .log-header:hover .copy-btn { opacity: 1; }
        .copy-btn:hover { color: var(--accent); border-color: var(--accent); background: rgba(56,189,248,0.08); }
        .copy-btn.copied { color: #4ade80; border-color: #4ade80; background: rgba(74,222,128,0.08); opacity: 1; }
        .toast { position: fixed; bottom: 20px; right: 20px; background: #1e293b; border: 1px solid #38bdf8; color: #38bdf8; font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 8px 16px; border-radius: 8px; opacity: 0; transform: translateY(8px); transition: opacity 0.2s, transform 0.2s; pointer-events: none; z-index: 9999; }
        .toast.show { opacity: 1; transform: translateY(0); }
      </style>
    </head>
    <body>
      <header>
        <div class="brand">
          <span>⚡</span> EverFern Debug Monitor <span style="font-size:11px; color:var(--text-dim); font-weight:normal;">(Ctrl+Shift+P)</span>
        </div>
        <div class="controls">
          <input type="text" id="searchInput" class="search-input" placeholder="Search logs & payloads...">
          <button class="btn active" id="filterAll">All</button>
          <button class="btn" id="filterError">Errors 🚨</button>
          <button class="btn" id="filterWarn">Warnings ⚠️</button>
          <button class="btn" id="filterGraph">Agent & Graph 🤖</button>
          <button class="btn btn-danger" id="btnClear">Clear</button>
        </div>
      </header>
      <div class="stats-bar">
        <div class="stat-item">Total Logs: <span class="stat-val" id="cntTotal">0</span></div>
        <div class="stat-item">Errors: <span class="stat-val" style="color:var(--accent-error);" id="cntErrors">0</span></div>
        <div class="stat-item">Warnings: <span class="stat-val" style="color:var(--accent-warn);" id="cntWarnings">0</span></div>
        <div class="stat-item">Auto-Scroll: <span class="stat-val" style="color:var(--accent);" id="lblAutoScroll">ON</span></div>
      </div>
      <div id="logs-container"></div>

      <script>
        let allLogs = [];
        let activeFilter = 'all';
        let searchQuery = '';
        let autoScroll = true;

        const container = document.getElementById('logs-container');
        const searchInput = document.getElementById('searchInput');
        const cntTotal = document.getElementById('cntTotal');
        const cntErrors = document.getElementById('cntErrors');
        const cntWarnings = document.getElementById('cntWarnings');

        searchInput.addEventListener('input', (e) => {
          searchQuery = e.target.value.toLowerCase();
          renderLogs();
        });

        document.getElementById('filterAll').onclick = () => setFilter('all');
        document.getElementById('filterError').onclick = () => setFilter('error');
        document.getElementById('filterWarn').onclick = () => setFilter('warn');
        document.getElementById('filterGraph').onclick = () => setFilter('graph');
        document.getElementById('btnClear').onclick = () => {
          allLogs = [];
          renderLogs();
        };

        function setFilter(f) {
          activeFilter = f;
          ['All', 'Error', 'Warn', 'Graph'].forEach(name => {
            const btn = document.getElementById('filter' + name);
            if (btn) btn.classList.toggle('active', name.toLowerCase() === f || (f === 'error' && name === 'Error') || (f === 'warn' && name === 'Warn') || (f === 'graph' && name === 'Graph'));
          });
          renderLogs();
        }

        window.appendLog = function(entryStr) {
          try {
            const entry = JSON.parse(entryStr);
            allLogs.push(entry);
            if (allLogs.length > 2000) allLogs.shift();
            updateStats();
            appendSingleLogRow(entry);
          } catch(e) {}
        };

        function updateStats() {
          cntTotal.innerText = allLogs.length;
          cntErrors.innerText = allLogs.filter(l => l.level === 'error' || (l.title && (l.title.includes('❌') || l.title.includes('ERROR')))).length;
          cntWarnings.innerText = allLogs.filter(l => l.level === 'warn' || (l.title && (l.title.includes('⚠️') || l.title.includes('WARN')))).length;
        }

        function isMatch(entry) {
          const lvl = entry.level || 'info';
          const title = entry.title || '';
          if (activeFilter === 'error' && lvl !== 'error' && !title.includes('❌') && !title.includes('ERROR')) return false;
          if (activeFilter === 'warn' && lvl !== 'warn' && !title.includes('⚠️') && !title.includes('WARN')) return false;
          if (activeFilter === 'graph' && !title.includes('Graph') && !title.includes('Brain') && !title.includes('Agent') && !title.includes('Runner')) return false;

          if (searchQuery) {
            const bodyStr = typeof entry.data === 'object' ? JSON.stringify(entry.data) : String(entry.data);
            return title.toLowerCase().includes(searchQuery) || bodyStr.toLowerCase().includes(searchQuery);
          }
          return true;
        }

        function appendSingleLogRow(entry) {
          if (!isMatch(entry)) return;

          const row = document.createElement('div');
          const lvl = entry.level || 'info';
          row.className = 'log-row ' + (lvl === 'error' || entry.title.includes('❌') ? 'error' : lvl === 'warn' || entry.title.includes('⚠️') ? 'warn' : 'info');

          const header = document.createElement('div');
          header.className = 'log-header';

          const titleGroup = document.createElement('div');
          titleGroup.className = 'log-title-group';
          titleGroup.innerHTML = \`<span class="badge \${lvl}">\${lvl}</span><span class="log-title">\${escapeHtml(entry.title)}</span>\`;

          const rightGroup = document.createElement('div');
          rightGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

          const copyBtn = document.createElement('button');
          copyBtn.className = 'copy-btn';
          copyBtn.title = 'Copy title';
          copyBtn.textContent = '⎘ copy';
          copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(entry.title).then(() => {
              copyBtn.textContent = '✓ copied';
              copyBtn.classList.add('copied');
              showToast('Copied: ' + entry.title.slice(0, 60) + (entry.title.length > 60 ? '…' : ''));
              setTimeout(() => { copyBtn.textContent = '⎘ copy'; copyBtn.classList.remove('copied'); }, 1500);
            }).catch(() => {
              // fallback
              const ta = document.createElement('textarea');
              ta.value = entry.title;
              ta.style.cssText = 'position:fixed;opacity:0;';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
              copyBtn.textContent = '✓ copied';
              copyBtn.classList.add('copied');
              showToast('Copied!');
              setTimeout(() => { copyBtn.textContent = '⎘ copy'; copyBtn.classList.remove('copied'); }, 1500);
            });
          });

          const timeSpan = document.createElement('span');
          timeSpan.className = 'log-time';
          timeSpan.textContent = new Date(entry.time).toLocaleTimeString();

          rightGroup.appendChild(copyBtn);
          rightGroup.appendChild(timeSpan);
          header.appendChild(titleGroup);
          header.appendChild(rightGroup);

          const body = document.createElement('div');
          body.className = 'log-body';
          let bodyText = entry.data;
          if (typeof bodyText === 'object') {
            try { bodyText = JSON.stringify(bodyText, null, 2); } catch(e) { bodyText = String(bodyText); }
          }
          body.textContent = bodyText;

          // Toggle body expand/collapse on header click (not on copy button)
          header.addEventListener('click', () => {
            body.style.display = body.style.display === 'none' ? '' : 'none';
          });

          row.appendChild(header);
          row.appendChild(body);
          container.appendChild(row);

          if (autoScroll) {
            container.scrollTop = container.scrollHeight;
          }
        }

        function renderLogs() {
          container.innerHTML = '';
          updateStats();
          allLogs.forEach(entry => appendSingleLogRow(entry));
        }

        function escapeHtml(str) {
          return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // Toast notification
        const toastEl = document.createElement('div');
        toastEl.className = 'toast';
        document.body.appendChild(toastEl);
        let toastTimer = null;
        function showToast(msg) {
          toastEl.textContent = msg;
          toastEl.classList.add('show');
          clearTimeout(toastTimer);
          toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
        }
      </script>
    </body>
    </html>
  `;

  debugWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  debugWin.webContents.on('did-finish-load', () => {
    logs.forEach(entry => {
      debugWin!.webContents.executeJavaScript(`window.appendLog(${JSON.stringify(JSON.stringify(entry))})`).catch(() => {});
    });
  });

  debugWin.on('closed', () => { debugWin = null; });
}
