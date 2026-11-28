//! macOS Accessibility trust, answered for the sidecar through `--ef-accessibility`.
//!
//! The voice overlay's global key hook needs Accessibility permission. Without it
//! `libuiohook` prints "Accessibility API is disabled!" from `hook_run` and calls
//! `abort()`, which takes down the whole Node sidecar and, through the shell's
//! sidecar watcher, the app itself. A native abort cannot be caught in JavaScript,
//! so Node asks this first and simply does not start the hook when the answer is no.

/// macOS: whether this process is trusted for Accessibility right now.
///
/// `AXIsProcessTrusted` returns a C `Boolean` (an unsigned char), so it is read as
/// `u8` rather than Rust's `bool`, which requires the value to be exactly 0 or 1.
#[cfg(target_os = "macos")]
pub fn trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
    }
    unsafe { AXIsProcessTrusted() != 0 }
}

/// Every other platform grants input monitoring at install time; there is nothing
/// to ask the user for, and `systemPreferences.isTrustedAccessibilityClient` is a
/// macOS-only API that Electron reports as trusted elsewhere.
#[cfg(not(target_os = "macos"))]
pub fn trusted() -> bool {
    true
}

/// `--ef-accessibility`: one JSON line on stdout, nothing else.
pub fn serve() {
    println!("{}", serde_json::json!({ "trusted": trusted() }));
}

#[cfg(test)]
mod tests {
    #[test]
    fn trusted_is_a_plain_boolean_on_every_platform() {
        // The sidecar parses `{"trusted": <bool>}`; a non-boolean would make the
        // shim fall back to "not trusted" and silently disable the hotkey.
        let value = serde_json::json!({ "trusted": super::trusted() });
        assert!(value["trusted"].is_boolean());
    }
}
