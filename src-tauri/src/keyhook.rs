//! System-wide Ctrl/Alt watching for the voice overlay, in place of `uiohook-napi`.
//!
//!   everfern --ef-keyhook
//!
//! Prints one JSON line per key change: {"key":"ctrl"|"alt"|"other","down":true|false}.
//! Only which kind of key it was is reported, never which letter, so the stream can't
//! be used to read what the user types. Ctrl and Alt are reported when they change
//! (not on auto-repeat); other keys are reported on every key down. Exits when stdin closes.

#[cfg(not(windows))]
pub fn serve() -> Result<(), String> {
    Err("the keyboard hook is only available on Windows".into())
}

#[cfg(windows)]
pub use win::serve;

/// What the overlay cares about for a virtual-key code.
#[cfg_attr(not(windows), allow(dead_code))]
fn kind(vk: u32) -> &'static str {
    match vk {
        0x11 | 0xA2 | 0xA3 => "ctrl", // VK_CONTROL, VK_LCONTROL, VK_RCONTROL
        0x12 | 0xA4 | 0xA5 => "alt",  // VK_MENU, VK_LMENU, VK_RMENU
        _ => "other",
    }
}

#[cfg(windows)]
mod win {
    use super::kind;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    static EVENTS: OnceLock<Sender<(&'static str, bool)>> = OnceLock::new();
    static CTRL_DOWN: AtomicBool = AtomicBool::new(false);
    static ALT_DOWN: AtomicBool = AtomicBool::new(false);

    // Runs on the hook thread for every key on the system: keep it short. Windows drops
    // hooks that take too long, so writing to the pipe happens on another thread.
    unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && lparam != 0 {
            let message = wparam as u32;
            let down = matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN);
            let up = matches!(message, WM_KEYUP | WM_SYSKEYUP);
            if down || up {
                let info = &*(lparam as *const KBDLLHOOKSTRUCT);
                let key = kind(info.vkCode);
                let changed = match key {
                    "ctrl" => CTRL_DOWN.swap(down, Ordering::Relaxed) != down,
                    "alt" => ALT_DOWN.swap(down, Ordering::Relaxed) != down,
                    _ => down,
                };
                if changed {
                    if let Some(events) = EVENTS.get() {
                        let _ = events.send((key, down));
                    }
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    pub fn serve() -> Result<(), String> {
        let (sender, receiver) = channel();
        EVENTS
            .set(sender)
            .map_err(|_| "keyboard hook already running")?;

        // Node closes stdin when it stops wanting events (or dies).
        std::thread::spawn(|| {
            let mut sink = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut sink);
            std::process::exit(0);
        });
        std::thread::spawn(move || {
            let stdout = std::io::stdout();
            let mut out = stdout.lock();
            for (key, down) in receiver {
                if writeln!(out, "{{\"key\":\"{key}\",\"down\":{down}}}")
                    .and_then(|_| out.flush())
                    .is_err()
                {
                    std::process::exit(0);
                }
            }
        });

        unsafe {
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), std::ptr::null_mut(), 0);
            if hook.is_null() {
                return Err(format!(
                    "SetWindowsHookExW failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            // Tell Node the hook is in place.
            println!("{{\"ready\":true}}");
            let _ = std::io::stdout().flush();
            // Low-level hooks are called through this thread's message loop.
            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::kind;

    #[test]
    fn modifier_keys_are_classified_and_letters_are_not_named() {
        assert_eq!(kind(0xA2), "ctrl");
        assert_eq!(kind(0xA3), "ctrl");
        assert_eq!(kind(0xA4), "alt");
        assert_eq!(kind(0xA5), "alt");
        assert_eq!(kind(b'A' as u32), "other");
        assert_eq!(kind(0x10), "other"); // Shift
    }
}
