@echo off
REM Launch Chrome with Remote Debugging for Navis CDP Mode
REM This allows Navis to connect to your real Chrome profile

echo.
echo ========================================
echo   Chrome CDP Mode Launcher for Navis
echo ========================================
echo.
echo This will launch Chrome with remote debugging enabled
echo so Navis can connect to your real Chrome profile.
echo.
echo IMPORTANT: Close ALL Chrome windows before continuing!
echo.
pause

REM Try common Chrome installation paths
set CHROME_PATH=

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
) else (
    echo ERROR: Could not find Chrome installation!
    echo Please install Google Chrome or edit this script with your Chrome path.
    pause
    exit /b 1
)

echo.
echo Found Chrome at: %CHROME_PATH%
echo.
echo Launching Chrome with CDP on port 9222...
echo.
echo Once Chrome opens, you can use Navis with "Use Chrome Profile" enabled.
echo DO NOT CLOSE THIS WINDOW - Chrome needs it to stay open.
echo.

REM Launch Chrome with remote debugging
"%CHROME_PATH%" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"

echo.
echo Chrome has closed. You can close this window now.
pause
