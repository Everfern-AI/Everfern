//! WebView2 memory target: Low while the main window is hidden or minimized, Normal when shown.
//!
//! With the target at Low, WebView2 trims its caches and pages memory out, so the app sitting
//! in the tray costs far less. It goes back to Normal as soon as the window is visible again.

#[cfg(windows)]
pub fn set_low(window: &tauri::Window, low: bool) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;

    let Some(webview) = window.app_handle().get_webview_window(window.label()) else {
        return;
    };
    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    let _ = webview.with_webview(move |pw| unsafe {
        // Older WebView2 runtimes lack ICoreWebView2_19; then this does nothing.
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                let _ = core19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn set_low(_window: &tauri::Window, _low: bool) {}

/// True when the window can't be seen: hidden to the tray or minimized.
pub fn is_out_of_sight(window: &tauri::Window) -> bool {
    !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false)
}
