const statusPill = document.getElementById('statusPill');
const taskValue = document.getElementById('taskValue');
const latestValue = document.getElementById('latestValue');
const titleValue = document.getElementById('titleValue');
const urlValue = document.getElementById('urlValue');
const feed = document.getElementById('feed');
const captureBtn = document.getElementById('captureBtn');
const clearBtn = document.getElementById('clearBtn');
let port = null;

function text(value, fallback = '') {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  return out || fallback;
}

function render(state = {}) {
  const connected = Boolean(state.connected);
  statusPill.textContent = connected ? 'Connected' : 'Waiting';
  statusPill.className = 'status-pill ' + (connected ? 'connected' : '');
  taskValue.textContent = text(state.activeTask, 'No active Navis task yet');
  titleValue.textContent = text(state.activeTitle, 'No page captured');
  urlValue.textContent = text(state.activeUrl, 'Capture a tab or start a Navis task.');
  const events = Array.isArray(state.events) ? state.events : [];
  const latest = events[events.length - 1];
  latestValue.textContent = latest ? text(latest.content || latest.message || latest.detail, 'Working...') : 'Actions and thoughts will stream here.';
  feed.innerHTML = '';
  events.slice(-80).reverse().forEach(event => {
    const li = document.createElement('li');
    const kind = document.createElement('div');
    kind.className = 'event-kind';
    kind.textContent = event.type || 'step';
    const body = document.createElement('p');
    body.textContent = text(event.content || event.message || event.detail || (event.action && event.action.description), 'Working through the browser.');
    li.append(kind, body);
    feed.appendChild(li);
  });
}

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'navis-panel' });
    port.onMessage.addListener(message => {
      if (message.type === 'state') render(message.state);
      if (message.type === 'navis-event') render(message.state || {});
      if (message.type === 'capture-result') render(message.state || {});
      if (message.type === 'feed-cleared') render(message.state || {});
    });
    port.postMessage({ type: 'refresh_state' });
  } catch {
    chrome.runtime.sendMessage({ type: 'get-state' }, render);
  }
}

captureBtn.addEventListener('click', () => {
  if (port) port.postMessage({ type: 'capture_active' });
  else chrome.runtime.sendMessage({ type: 'capture-active' }, response => render(response && response.state || {}));
});

clearBtn.addEventListener('click', () => {
  if (port) port.postMessage({ type: 'clear_feed' });
  else chrome.runtime.sendMessage({ type: 'clear-feed' }, response => render(response && response.state || {}));
});

connect();
