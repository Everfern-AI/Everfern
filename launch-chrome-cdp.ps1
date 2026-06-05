# Launch Chrome with Remote Debugging for Navis CDP Mode
# This allows Navis to connect to your real Chrome profile

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  Chrome CDP Mode Launcher for Navis"    -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""
Write-Host "This will launch Chrome with remote debugging enabled" -ForegroundColor Yellow
Write-Host "so Navis can connect to your real Chrome profile." -ForegroundColor Yellow
Write-Host ""
Write-Host "IMPORTANT: Close ALL Chrome windows before continuing!" -ForegroundColor Red
Write-Host ""
Read-Host "Press Enter to continue (or Ctrl+C to cancel)"

# Find Chrome installation
$chromePaths = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromePath = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromePath = $path
        break
    }
}

if (-not $chromePath) {
    Write-Host ""
    Write-Host "ERROR: Could not find Chrome installation!" -ForegroundColor Red
    Write-Host "Please install Google Chrome or edit this script with your Chrome path." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Found Chrome at: $chromePath" -ForegroundColor Green
Write-Host ""
Write-Host "Launching Chrome with CDP on port 9222..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Once Chrome opens, you can use Navis with 'Use Chrome Profile' enabled." -ForegroundColor Yellow
Write-Host "DO NOT CLOSE THIS WINDOW - Chrome needs it to stay open." -ForegroundColor Red
Write-Host ""

$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"

# Launch Chrome with remote debugging
try {
    & $chromePath --remote-debugging-port=9222 --user-data-dir="$userDataDir"
} catch {
    Write-Host ""
    Write-Host "ERROR launching Chrome: $_" -ForegroundColor Red
    Write-Host ""
}

Write-Host ""
Write-Host "Chrome has closed. You can close this window now." -ForegroundColor Green
Read-Host "Press Enter to exit"
