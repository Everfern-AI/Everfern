const api = globalThis.browser || globalThis.chrome;

const statusText = document.getElementById('statusText');
const statusCapsule = document.getElementById('statusCapsule');
const eventStat = document.getElementById('eventStat');
const modeStat = document.getElementById('modeStat');
const openPanel = document.getElementById('openPanel');
const captureTab = document.getElementById('captureTab');

function send(message) {
  return new Promise(resolve => {
    try {
      api.runtime.sendMessage(message, response => resolve(response || {}));
    } catch (error) {
      resolve({ success: false, error: String(error && error.message || error) });
    }
  });
}

function render(state) {
  const connected = Boolean(state && state.connected);
  statusText.textContent = connected ? 'Connected to EverFern Desktop' : 'Waiting for EverFern Desktop';
  statusCapsule.className = 'status-capsule ' + (connected ? 'connected' : 'disconnected');
  statusCapsule.querySelector('strong').textContent = connected ? 'Live bridge connected' : 'Bridge disconnected';
  const events = state && Array.isArray(state.events) ? state.events : [];
  eventStat.textContent = events.length + ' event' + (events.length === 1 ? '' : 's');
  modeStat.textContent = state && state.activeMode || 'extension-first';
}

send({ type: 'get-state' }).then(render);

openPanel.addEventListener('click', async () => {
  const response = await send({ type: 'open-overlay' });
  if (response && response.error) statusText.textContent = response.error;
});

captureTab.addEventListener('click', async () => {
  const response = await send({ type: 'capture-active' });
  if (response && response.state) render(response.state);
  if (response && response.error) statusText.textContent = response.error;
});
