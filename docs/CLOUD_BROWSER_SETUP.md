# Worker browser persistence

With `CLOUD_BROWSER_PROVIDER=vps`, cloud web apps run in isolated Chromium
containers on the Contabo VPS. Each account/worker/app has a persistent Docker
profile volume and its own noVNC stream. Chrome shows tabs and its address bar;
other apps use kiosk windows. Hyperbeam and Browserless are not selected.

Build `apps/api/browser-vps` as `everfern-browser:1`, install `flask-sock`, deploy
`routes/vps_browser.py`, and configure a random `VPS_BROWSER_SIGNING_KEY` on the
API host. Keep this key out of source control. Viewer links are signed and expire
after an hour; the app renews them. VNC, static assets, and DevTools ports bind
only to 127.0.0.1. The authenticated API controls DevTools; a signed WebSocket
gateway carries VNC. Containers have CPU, memory, and process limits.

Profiles live in named `everfern-browser-*-profile` Docker volumes and must be
included in server backups. VM IDs are not part of their identity. Idle browsers
can be stopped after 30 minutes when another session needs capacity; their
profiles remain. Set `VPS_BROWSER_MAX_SESSIONS` to adjust the default limit of 20.
With the VPS provider unset, Browserbase remains available as an explicit provider
without any automatic Hyperbeam or Browserless fallback.

Worker tools are guarded at execution time, including later-added coding tools.
Computer-use requests route through the VM browser controller. Host shells,
host browser views, and unrelated desktop tools are unavailable in worker runs.
DOM snapshots contain at most 80 controls and concise visible text, with labels,
checked/expanded state, and actionable refs; hidden content and password values
are omitted. Scroll or recapture to inspect additional controls.

Selecting local Alpine routes browser apps and Navis actions into Alpine's
Chromium. The driver obtains the exact DevTools endpoint from inside WSL and
never launches or discovers a host browser. VM startup failures show an error.

## Activate the cloud changes

1. Choose durable profile storage: apply `apps/api/SUPABASE_CLOUD_BROWSER_PROFILES.sql`
   to the same Supabase project as `SUPABASE_CLOUD_VMS.sql`, or set
   `CLOUD_BROWSER_PROFILE_STORE=sqlite` in the API environment. SQLite stores opaque
   profile IDs in `data/cloud-browser-profiles.sqlite3` beside `index.py`; preserve
   this directory in deployments/backups. `CLOUD_BROWSER_PROFILE_DB` can override the path.
2. Configure `BROWSERBASE_API_KEY` in the hosted API environment, alongside its
   existing Daytona and Supabase service credentials.
3. Deploy `apps/api/api/routes/cloud_vms.py` with the API. Existing sandbox context
   IDs migrate to account/worker profiles on first use.

The profile record survives deleting a VM. Browserbase retains the cloud profile;
the desktop also saves encrypted cookie copies under its user data directory.
The web edition keeps its local copies in IndexedDB. Cookies are scoped by account
and worker, never by the replaceable VM ID. Without an identified account, no
cookie clone is loaded or saved.

The local Alpine VM saves an encrypted SQLite cookie snapshot outside the VM under
`userData/vm/browser-cookies.bin`. Snapshots include committed WAL writes. A fresh
VM restores the snapshot before launching Chromium; existing cookies take precedence.

Backups run every 15 seconds while the browser is open. Cookie copies preserve
cookies only; sites can expire or revoke sessions and require another sign-in.
