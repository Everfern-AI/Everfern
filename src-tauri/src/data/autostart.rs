//! Start at login, ported from `main/lib/auto-start-manager.ts` (Windows only).
//!
//! Electron's `app.setLoginItemSettings` writes a value named after the
//! AppUserModelId under HKCU\...\Run. This writes the same value, so the Electron
//! and Tauri builds see one setting, with `--auto-start` so the app starts hidden.
//! Other platforms return `None` and the bridge falls back to the Node handler.

use serde_json::{json, Value};

/// The channels this module answers.
pub fn handle(channel: &str) -> Option<Value> {
    if !cfg!(windows) {
        return None;
    }
    let result = match channel {
        "autostart:get-status" => imp::is_enabled().map(|enabled| json!({ "success": true, "enabled": enabled })),
        "autostart:enable" => imp::set(true).map(|_| json!({ "success": true })),
        "autostart:disable" => imp::set(false).map(|_| json!({ "success": true })),
        "autostart:get-info" => Ok(json!({ "success": true, "info": {
            "platform": "Windows",
            "method": "Registry (HKCU Run)",
            "location": "Windows Registry (HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run)",
        }})),
        "autostart:validate-support" => Ok(json!({ "success": true, "validation": { "supported": true } })),
        _ => return None,
    };
    Some(result.unwrap_or_else(|error| json!({ "success": false, "error": error })))
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_BINARY,
        RRF_RT_REG_SZ,
    };

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    // Where Task Manager's Startup tab records "Disabled" for a Run entry.
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const NAME: &str = "com.everfern.desktop";

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    fn command() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(format!("\"{}\" --auto-start", exe.display()))
    }

    /// On when our Run value exists and Task Manager has not disabled it.
    pub fn is_enabled() -> Result<bool, String> {
        let mut size = 0u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                wide(RUN).as_ptr(),
                wide(NAME).as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        };
        match status {
            ERROR_SUCCESS => {}
            ERROR_FILE_NOT_FOUND => return Ok(false),
            code => return Err(format!("Could not read the Run key (error {code})")),
        }
        let mut flags = [0u8; 12];
        let mut flags_size = flags.len() as u32;
        let approved = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                wide(APPROVED).as_ptr(),
                wide(NAME).as_ptr(),
                RRF_RT_REG_BINARY,
                std::ptr::null_mut(),
                flags.as_mut_ptr().cast(),
                &mut flags_size,
            )
        };
        // An odd first byte (0x03, 0x01...) means disabled; 0x02/0x06 mean enabled.
        Ok(approved != ERROR_SUCCESS || flags_size == 0 || flags[0] & 1 == 0)
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let status = if enabled {
            let value = wide(&command()?);
            unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    wide(RUN).as_ptr(),
                    wide(NAME).as_ptr(),
                    REG_SZ,
                    value.as_ptr().cast(),
                    (value.len() * 2) as u32,
                )
            }
        } else {
            match unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, wide(RUN).as_ptr(), wide(NAME).as_ptr()) } {
                ERROR_FILE_NOT_FOUND => ERROR_SUCCESS,
                code => code,
            }
        };
        if status != ERROR_SUCCESS {
            return Err(format!("Could not update the Run key (error {status})"));
        }
        // Turning it on from the app also clears a "Disabled" left by Task Manager.
        unsafe {
            RegDeleteKeyValueW(HKEY_CURRENT_USER, wide(APPROVED).as_ptr(), wide(NAME).as_ptr());
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn is_enabled() -> Result<bool, String> {
        Err("unsupported".into())
    }
    pub fn set(_enabled: bool) -> Result<(), String> {
        Err("unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn unknown_channels_are_left_to_node() {
        assert_eq!(super::handle("autostart:nope"), None);
        if cfg!(windows) {
            assert_eq!(super::handle("autostart:validate-support").unwrap()["validation"]["supported"], true);
        }
    }
}
