param(
    [string]$action,
    [int]$x,
    [int]$y,
    [string]$button = "left",
    [string]$text,
    [string[]]$keys,
    [int]$pixels,
    [int]$toX,
    [int]$toY
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Define Win32 Mouse/Keyboard API
$signature = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
}
"@

if (-not ([System.Management.Automation.PSTypeName]"Win32").Type) {
    Add-Type -TypeDefinition $signature
}

function Get-VirtualKeyCode($key) {
    switch ($key.ToLower()) {
        "control" { return 0x11 }
        "ctrl" { return 0x11 }
        "alt" { return 0x12 }
        "shift" { return 0x10 }
        "win" { return 0x5B }
        "command" { return 0x5B }
        "super" { return 0x5B }
        "tab" { return 0x09 }
        "enter" { return 0x0D }
        "return" { return 0x0D }
        "escape" { return 0x1B }
        "esc" { return 0x1B }
        "backspace" { return 0x08 }
        "delete" { return 0x2E }
        "del" { return 0x2E }
        "space" { return 0x20 }
        "up" { return 0x26 }
        "down" { return 0x28 }
        "left" { return 0x25 }
        "right" { return 0x27 }
        "f1" { return 0x70 }
        "f2" { return 0x71 }
        "f3" { return 0x72 }
        "f4" { return 0x73 }
        "f5" { return 0x74 }
        "f6" { return 0x75 }
        "f7" { return 0x76 }
        "f8" { return 0x77 }
        "f9" { return 0x78 }
        "f10" { return 0x79 }
        "f11" { return 0x7A }
        "f12" { return 0x7B }
        default {
            if ($key.Length -eq 1) {
                $char = [char]$key.ToUpper()
                return [int]$char
            }
            return 0
        }
    }
}

# If text is base64, decode it
if ($text) {
    try {
        $decodedBytes = [System.Convert]::FromBase64String($text)
        $text = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
    } catch {
        # Keep original if not valid base64
    }
}

switch ($action) {
    "move" {
        [Win32]::SetCursorPos($x, $y)
    }
    "click" {
        if ($PSBoundParameters.ContainsKey('x') -and $PSBoundParameters.ContainsKey('y')) {
            [Win32]::SetCursorPos($x, $y)
        }
        $down = 0x0002 # MOUSEEVENTF_LEFTDOWN
        $up = 0x0004 # MOUSEEVENTF_LEFTUP
        if ($button -eq "right") {
            $down = 0x0008
            $up = 0x0010
        } elseif ($button -eq "middle") {
            $down = 0x0020
            $up = 0x0040
        }
        [Win32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [Win32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
    }
    "double_click" {
        [Win32]::SetCursorPos($x, $y)
        $down = 0x0002
        $up = 0x0004
        [Win32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [Win32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 100
        [Win32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [Win32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
    }
    "triple_click" {
        [Win32]::SetCursorPos($x, $y)
        $down = 0x0002
        $up = 0x0004
        foreach ($i in 1..3) {
            [Win32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
            Start-Sleep -Milliseconds 50
            [Win32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
            Start-Sleep -Milliseconds 100
        }
    }
    "drag" {
        $down = 0x0002
        $up = 0x0004
        [Win32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 100
        [Win32]::SetCursorPos($toX, $toY)
        Start-Sleep -Milliseconds 100
        [Win32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
    }
    "scroll" {
        [Win32]::mouse_event(0x0800, 0, 0, $pixels, [IntPtr]::Zero)
    }
    "hscroll" {
        [Win32]::mouse_event(0x1000, 0, 0, $pixels, [IntPtr]::Zero)
    }
    "type" {
        $success = $false
        try {
            [System.Windows.Forms.Clipboard]::SetText($text)
            Start-Sleep -Milliseconds 50
            [System.Windows.Forms.SendKeys]::SendWait("^v")
            $success = $true
        } catch {
            $success = $false
        }
        if (-not $success) {
            $escapedText = $text -replace '\{', '{{}' -replace '\}', '{}}' -replace '([\+\^%~\(\)\[\]])', '{$1}'
            [System.Windows.Forms.SendKeys]::SendWait($escapedText)
        }
    }
    "press" {
        $vKeys = @()
        foreach ($key in $keys) {
            $vk = Get-VirtualKeyCode $key
            if ($vk -ne 0) {
                $vKeys += $vk
            }
        }
        foreach ($vk in $vKeys) {
            [Win32]::keybd_event($vk, 0, 0, [IntPtr]::Zero)
        }
        Start-Sleep -Milliseconds 50
        for ($i = $vKeys.Length - 1; $i -ge 0; $i--) {
            $vk = $vKeys[$i]
            [Win32]::keybd_event($vk, 0, 2, [IntPtr]::Zero)
        }
    }
}
