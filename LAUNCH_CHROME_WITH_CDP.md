# How to Use Navis with Your Real Chrome Profile (CDP Mode)

When you enable "Use Chrome Profile" in Navis settings, Navis can connect to your actual Chrome browser instead of launching an isolated instance. This gives you access to all your saved logins, cookies, and browsing data.

## Two Ways to Use CDP Mode

### Option 1: Automatic (Easiest)

Just enable "Use Chrome Profile" in Navis settings and run Navis. It will:
1. Check if Chrome is running with remote debugging
2. If not, auto-launch Chrome with CDP enabled
3. Connect to it and use your real profile

**Requirements:**
- All Chrome windows must be closed before Navis starts
- If Chrome is already running, close it first

### Option 2: Manual Launch (Most Reliable)

If automatic mode doesn't work (Chrome already running, port conflicts, etc.), you can manually launch Chrome with CDP:

#### Windows

1. **Close ALL Chrome windows completely**

2. **Open Command Prompt or PowerShell**

3. **Run this command** (adjust path if your Chrome is installed elsewhere):

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
```

Or for a specific profile:

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" --profile-directory="Default"
```

4. **Leave that terminal window open** - Chrome is now running with CDP enabled

5. **In EverFern, enable "Use Chrome Profile"** and run Navis

6. **You'll see**: `✅✅✅ SUCCESS: Connected to your REAL Chrome browser via CDP!`

#### macOS

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/Library/Application Support/Google/Chrome"
```

#### Linux

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.config/google-chrome"
```

## How to Verify It's Working

When CDP connection succeeds, you'll see:

```
[Navis] 🔌 CDP MODE: Attempting to connect to existing Chrome instance...
[Navis] ✅ Found existing Chrome with CDP at: ws://127.0.0.1:9222/devtools/browser/...
[Navis] 🔗 Connecting to Chrome via CDP WebSocket: ws://...
[Navis] ✅✅✅ SUCCESS: Connected to your REAL Chrome browser via CDP!
[Navis] You can now see Navis actions in your actual Chrome window.
```

When it works:
- Navis controls your actual Chrome window
- You can watch it navigate and interact with pages in real-time
- All your saved logins and cookies are available
- No separate browser window

## Fallback Behavior

If CDP connection fails, Navis automatically falls back to:

1. **Isolated browser with profile copy** - Copies your cookies/sessions to a temp profile
2. **Fresh Chromium** - Clean browser with no profile data (last resort)

You'll see warning messages like:
```
[Navis] ⚠️ CDP connection failed, falling back to isolated browser with profile copy...
[Navis] (This means Navis will run in a separate browser window, not your main Chrome)
```

## Troubleshooting

### "Failed to auto-launch Chrome with CDP"

**Cause**: Chrome is already running

**Solution**:
1. Close **all** Chrome windows (check system tray)
2. Open Task Manager and end any `chrome.exe` processes
3. Try again

### "Failed to connect via CDP: connect ECONNREFUSED"

**Cause**: No Chrome instance with remote debugging on port 9222

**Solution**: Use Manual Launch (Option 2 above)

### Port 9222 Already in Use

**Cause**: Another application is using port 9222

**Solution**:
1. Close the other application
2. Or use a different port:
   ```cmd
   chrome.exe --remote-debugging-port=9223
   ```
   (Note: Navis currently only checks 9222, so you'd need to update the code)

### "Chrome is being controlled by automated test software"

**Cause**: This is normal! It's how CDP works

**Solution**: This is expected and not an error. Navis is controlling Chrome via CDP.

## Benefits of CDP Mode

✅ **Real profile access** - All your logins, cookies, history
✅ **Watch in real-time** - See exactly what Navis is doing
✅ **Browser extensions** - Your installed extensions work
✅ **Faster startup** - No profile copying needed
✅ **No state issues** - No CheckpointRestoreFix errors

## Limitations

⚠️ **Cannot run headless** - CDP mode always shows the browser window
⚠️ **Chrome must be closed** - Can't connect if Chrome is already running normally
⚠️ **Single profile** - Can only connect to one Chrome profile at a time
⚠️ **Port 9222** - Currently hardcoded to use port 9222

## Technical Details

### What is CDP?

CDP (Chrome DevTools Protocol) is the same protocol that Chrome DevTools uses to control the browser. It allows external tools to:
- Navigate pages
- Click elements
- Execute JavaScript
- Take screenshots
- Monitor network traffic
- And much more

### How Playwright Connects

```typescript
// Navis connects like this:
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0]; // Use existing context
const page = context.pages()[0]; // Use existing page
```

This gives Navis control over your already-running Chrome instance without launching a new browser.

### Security Note

When Chrome runs with `--remote-debugging-port`, **any application on your computer** can control it. Don't run sensitive tasks or handle passwords while remote debugging is enabled if you don't trust other applications on your machine.
