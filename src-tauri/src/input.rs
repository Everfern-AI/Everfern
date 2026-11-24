//! Mouse and keyboard input for the computer-use tool, in place of `@jitsi/robotjs`.
//!
//! Runs as a short-lived CLI mode of the main exe (`--ef-input`), like `capture.rs`:
//! one JSON array of operations on stdin, run in order, then one JSON value on stdout
//! (what the last `pos` / `size` returned, or `null`).
//!
//! Coordinates are DIPs in the same space `--ef-displays` reports, which is what the
//! sidecar's `screen` API hands to the TS side.
//!
//! Operations:
//!   {"op":"move","x":..,"y":..}                 move the cursor
//!   {"op":"button","button":"left","down":true} press or release a mouse button
//!   {"op":"click","button":"left","double":false}
//!   {"op":"scroll","x":0,"y":3}                 robotjs units: +y scrolls down, +x right
//!   {"op":"type","text":"..."}
//!   {"op":"key","key":"a","modifiers":["control"]}            tap
//!   {"op":"keyToggle","key":"shift","down":true,"modifiers":[]}
//!   {"op":"pos"} -> {"x":..,"y":..}     {"op":"size"} -> {"width":..,"height":..}
//!   {"op":"sleep","ms":20}

use serde_json::Value;

pub fn run(ops: &[Value]) -> Result<Value, String> {
    #[cfg(windows)]
    {
        win::run(ops)
    }
    #[cfg(not(windows))]
    {
        let _ = ops;
        Err("input is only implemented on Windows".into())
    }
}

/// A key name as robotjs spells it, lowercased: (virtual key, needs the extended flag).
#[cfg_attr(not(windows), allow(dead_code))]
fn named_key(name: &str) -> Option<(u16, bool)> {
    let key = match name {
        "backspace" => (0x08, false),
        "tab" => (0x09, false),
        "enter" | "return" => (0x0D, false),
        "escape" | "esc" => (0x1B, false),
        "space" => (0x20, false),
        "pageup" | "page_up" | "pgup" => (0x21, true),
        "pagedown" | "page_down" | "pgdn" => (0x22, true),
        "end" => (0x23, true),
        "home" => (0x24, true),
        "left" | "arrowleft" => (0x25, true),
        "up" | "arrowup" => (0x26, true),
        "right" | "arrowright" => (0x27, true),
        "down" | "arrowdown" => (0x28, true),
        "printscreen" => (0x2C, true),
        "insert" => (0x2D, true),
        "delete" | "del" => (0x2E, true),
        "command" | "cmd" | "win" | "windows" | "super" | "meta" => (0x5B, true),
        "menu" => (0x5D, true),
        "shift" => (0x10, false),
        "right_shift" => (0xA1, false),
        "control" | "ctrl" => (0x11, false),
        "right_control" => (0xA3, true),
        "alt" => (0x12, false),
        "right_alt" => (0xA5, true),
        "capslock" => (0x14, false),
        "numlock" => (0x90, true),
        "audio_mute" => (0xAD, true),
        "audio_vol_down" => (0xAE, true),
        "audio_vol_up" => (0xAF, true),
        "audio_next" => (0xB0, true),
        "audio_prev" => (0xB1, true),
        "audio_stop" => (0xB2, true),
        "audio_play" | "audio_pause" => (0xB3, true),
        _ => {
            if let Some(n) = name
                .strip_prefix("numpad_")
                .and_then(|n| n.parse::<u16>().ok())
                .filter(|n| *n <= 9)
            {
                return Some((0x60 + n, false));
            }
            if let Some(n) = name
                .strip_prefix('f')
                .and_then(|n| n.parse::<u16>().ok())
                .filter(|n| (1..=24).contains(n))
            {
                return Some((0x6F + n, false));
            }
            return None;
        }
    };
    Some(key)
}

#[cfg(windows)]
mod win {
    use super::named_key;
    use crate::capture::win::{monitors, Monitor};
    use serde_json::{json, Value};
    use std::mem::size_of;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

    const VK_SHIFT: u16 = 0x10;

    pub fn run(ops: &[Value]) -> Result<Value, String> {
        // Enumerating monitors also makes this process per-monitor DPI aware, so the
        // cursor calls below work in physical pixels.
        let mons = monitors();
        let mut result = Value::Null;
        for op in ops {
            let name = op
                .get("op")
                .and_then(Value::as_str)
                .ok_or("each input op needs \"op\"")?;
            match name {
                "move" => {
                    let (x, y) = to_physical(&mons, num(op, "x")?, num(op, "y")?);
                    if unsafe { SetCursorPos(x, y) } == 0 {
                        return Err("could not move the cursor".into());
                    }
                }
                "button" => {
                    let (down, up) = button(op)?;
                    send(&[mouse(if flag(op, "down") { down } else { up }, 0)])?;
                }
                "click" => {
                    let (down, up) = button(op)?;
                    send(&[mouse(down, 0), mouse(up, 0)])?;
                    if flag(op, "double") {
                        std::thread::sleep(Duration::from_millis(50));
                        send(&[mouse(down, 0), mouse(up, 0)])?;
                    }
                }
                "scroll" => {
                    let x = num(op, "x").unwrap_or(0.0).round() as i32;
                    let y = num(op, "y").unwrap_or(0.0).round() as i32;
                    if y != 0 {
                        send(&[mouse(MOUSEEVENTF_WHEEL, -y)])?;
                    }
                    if x != 0 {
                        send(&[mouse(MOUSEEVENTF_HWHEEL, x)])?;
                    }
                }
                "type" => type_text(op.get("text").and_then(Value::as_str).unwrap_or(""))?,
                "key" => {
                    let mods = modifiers(op)?;
                    let key = resolve(text(op, "key")?)?;
                    let mut seq = Vec::new();
                    press(&mut seq, &mods, &key);
                    release(&mut seq, &mods, &key);
                    send(&seq)?;
                }
                "keyToggle" => {
                    let mods = modifiers(op)?;
                    let key = resolve(text(op, "key")?)?;
                    let mut seq = Vec::new();
                    if flag(op, "down") {
                        press(&mut seq, &mods, &key);
                    } else {
                        release(&mut seq, &mods, &key);
                    }
                    send(&seq)?;
                }
                "pos" => {
                    let mut p = POINT { x: 0, y: 0 };
                    unsafe { GetCursorPos(&mut p) };
                    let (x, y) = to_dip(&mons, p.x, p.y);
                    result = json!({ "x": x.round() as i64, "y": y.round() as i64 });
                }
                "size" => {
                    let m = mons.first().ok_or("no displays")?;
                    let w = (m.rect.right - m.rect.left) as f64 / m.scale;
                    let h = (m.rect.bottom - m.rect.top) as f64 / m.scale;
                    result = json!({ "width": w.round() as i64, "height": h.round() as i64 });
                }
                "sleep" => std::thread::sleep(Duration::from_millis(
                    num(op, "ms")?.clamp(0.0, 10_000.0) as u64,
                )),
                other => return Err(format!("unknown input op \"{other}\"")),
            }
        }
        Ok(result)
    }

    fn num(op: &Value, field: &str) -> Result<f64, String> {
        op.get(field)
            .and_then(Value::as_f64)
            .ok_or_else(|| format!("input op needs a number \"{field}\""))
    }

    fn text<'a>(op: &'a Value, field: &str) -> Result<&'a str, String> {
        op.get(field)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("input op needs \"{field}\""))
    }

    fn flag(op: &Value, field: &str) -> bool {
        op.get(field).and_then(Value::as_bool).unwrap_or(false)
    }

    // ── Coordinates ─────────────────────────────────────────────────────────

    fn dip_rect(m: &Monitor) -> (f64, f64, f64, f64) {
        let s = m.scale;
        let (l, t) = (m.rect.left as f64 / s, m.rect.top as f64 / s);
        let (w, h) = (
            (m.rect.right - m.rect.left) as f64 / s,
            (m.rect.bottom - m.rect.top) as f64 / s,
        );
        (l, t, w, h)
    }

    /// DIP point → physical pixel on whichever monitor contains it.
    pub(super) fn to_physical(mons: &[Monitor], x: f64, y: f64) -> (i32, i32) {
        for m in mons {
            let (l, t, w, h) = dip_rect(m);
            if x >= l && x < l + w && y >= t && y < t + h {
                let px = m.rect.left as f64 + (x - l) * m.scale;
                let py = m.rect.top as f64 + (y - t) * m.scale;
                return (px.round() as i32, py.round() as i32);
            }
        }
        // Off every monitor: Windows clamps the cursor; use the primary's scale.
        let s = mons.first().map(|m| m.scale).unwrap_or(1.0);
        ((x * s).round() as i32, (y * s).round() as i32)
    }

    /// Physical pixel → DIP point, the inverse of `to_physical`.
    pub(super) fn to_dip(mons: &[Monitor], px: i32, py: i32) -> (f64, f64) {
        for m in mons {
            let r = &m.rect;
            if px >= r.left && px < r.right && py >= r.top && py < r.bottom {
                let (l, t, _, _) = dip_rect(m);
                return (
                    l + (px - r.left) as f64 / m.scale,
                    t + (py - r.top) as f64 / m.scale,
                );
            }
        }
        let s = mons.first().map(|m| m.scale).unwrap_or(1.0);
        (px as f64 / s, py as f64 / s)
    }

    // ── Mouse ───────────────────────────────────────────────────────────────

    fn button(op: &Value) -> Result<(MOUSE_EVENT_FLAGS, MOUSE_EVENT_FLAGS), String> {
        match op.get("button").and_then(Value::as_str).unwrap_or("left") {
            "left" => Ok((MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)),
            "right" => Ok((MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)),
            "middle" => Ok((MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP)),
            other => Err(format!("unknown mouse button \"{other}\"")),
        }
    }

    fn mouse(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    // ── Keyboard ────────────────────────────────────────────────────────────

    #[derive(Debug, PartialEq)]
    pub(super) enum Key {
        /// A virtual key; `shift` when the character needs Shift on this layout.
        Vk { vk: u16, ext: bool, shift: bool },
        /// A character this keyboard layout has no key for.
        Unicode(Vec<u16>),
    }

    pub(super) fn resolve(name: &str) -> Result<Key, String> {
        let mut chars = name.chars();
        if let (Some(c), None) = (chars.next(), chars.next()) {
            if c == ' ' {
                return Ok(Key::Vk {
                    vk: 0x20,
                    ext: false,
                    shift: false,
                });
            }
            let mut units = [0u16; 2];
            let units = c.encode_utf16(&mut units);
            if units.len() == 1 {
                let scan = unsafe { VkKeyScanW(units[0]) };
                // Low byte: virtual key. High byte: 1 = Shift, 2 = Ctrl, 4 = Alt (AltGr).
                if scan != -1 && (scan >> 8) & 0b110 == 0 {
                    return Ok(Key::Vk {
                        vk: (scan & 0xFF) as u16,
                        ext: false,
                        shift: (scan >> 8) & 1 != 0,
                    });
                }
            }
            return Ok(Key::Unicode(units.to_vec()));
        }
        let lower = name.to_ascii_lowercase();
        named_key(&lower)
            .map(|(vk, ext)| Key::Vk {
                vk,
                ext,
                shift: false,
            })
            .ok_or_else(|| format!("unknown key \"{name}\""))
    }

    fn modifiers(op: &Value) -> Result<Vec<Key>, String> {
        match op.get("modifiers") {
            None | Some(Value::Null) => Ok(Vec::new()),
            Some(Value::String(s)) => Ok(vec![resolve(s)?]),
            Some(Value::Array(list)) => list
                .iter()
                .map(|m| {
                    m.as_str()
                        .ok_or_else(|| "modifiers must be strings".to_string())
                        .and_then(resolve)
                })
                .collect(),
            Some(_) => Err("modifiers must be a string or a list".into()),
        }
    }

    fn vk_input(vk: u16, ext: bool, up: bool) -> INPUT {
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        let mut flags = 0;
        if ext {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn unicode_input(unit: u16, up: bool) -> INPUT {
        let flags = KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 };
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: unit,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn key_events(seq: &mut Vec<INPUT>, key: &Key, up: bool) {
        match key {
            Key::Vk { vk, ext, .. } => seq.push(vk_input(*vk, *ext, up)),
            Key::Unicode(units) => seq.extend(units.iter().map(|u| unicode_input(*u, up))),
        }
    }

    fn needs_shift(mods: &[Key], key: &Key) -> bool {
        matches!(key, Key::Vk { shift: true, .. })
            && !mods
                .iter()
                .any(|m| matches!(m, Key::Vk { vk: VK_SHIFT, .. }))
    }

    /// Modifiers down, then the key down (with Shift if its character needs it).
    fn press(seq: &mut Vec<INPUT>, mods: &[Key], key: &Key) {
        for m in mods {
            key_events(seq, m, false);
        }
        if needs_shift(mods, key) {
            seq.push(vk_input(VK_SHIFT, false, false));
        }
        key_events(seq, key, false);
    }

    /// The key up, then everything `press` held, in reverse.
    fn release(seq: &mut Vec<INPUT>, mods: &[Key], key: &Key) {
        key_events(seq, key, true);
        if needs_shift(mods, key) {
            seq.push(vk_input(VK_SHIFT, false, true));
        }
        for m in mods.iter().rev() {
            key_events(seq, m, true);
        }
    }

    fn type_text(text: &str) -> Result<(), String> {
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            let mut seq = Vec::new();
            match c {
                // Apps treat a Unicode "\n" inconsistently; a real Enter / Tab always works.
                '\r' if chars.peek() == Some(&'\n') => continue,
                '\r' | '\n' => {
                    seq.push(vk_input(0x0D, false, false));
                    seq.push(vk_input(0x0D, false, true));
                }
                '\t' => {
                    seq.push(vk_input(0x09, false, false));
                    seq.push(vk_input(0x09, false, true));
                }
                _ => {
                    let mut buf = [0u16; 2];
                    for unit in c.encode_utf16(&mut buf).iter() {
                        seq.push(unicode_input(*unit, false));
                        seq.push(unicode_input(*unit, true));
                    }
                }
            }
            send(&seq)?;
        }
        Ok(())
    }

    fn send(inputs: &[INPUT]) -> Result<(), String> {
        if inputs.is_empty() {
            return Ok(());
        }
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            )
        };
        if (sent as usize) < inputs.len() {
            return Err(
                "Windows blocked the input (the target window may be running as administrator)"
                    .into(),
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::named_key;

    #[test]
    fn robotjs_key_names_resolve() {
        assert_eq!(named_key("enter"), Some((0x0D, false)));
        assert_eq!(named_key("command"), Some((0x5B, true)));
        assert_eq!(named_key("left"), Some((0x25, true)));
        assert_eq!(named_key("f1"), Some((0x70, false)));
        assert_eq!(named_key("f12"), Some((0x7B, false)));
        assert_eq!(named_key("numpad_7"), Some((0x67, false)));
        assert_eq!(named_key("f25"), None);
        assert_eq!(named_key("nope"), None);
    }

    #[cfg(windows)]
    #[test]
    fn dip_and_physical_coordinates_round_trip() {
        use super::win::{to_dip, to_physical};
        use crate::capture::win::Monitor;
        use windows_sys::Win32::Foundation::RECT;
        let rect = |left, top, right, bottom| RECT {
            left,
            top,
            right,
            bottom,
        };
        // 4K primary at 150 %, 1080p at 100 % to its right.
        let mons = vec![
            Monitor {
                rect: rect(0, 0, 3840, 2160),
                work: rect(0, 0, 3840, 2100),
                primary: true,
                scale: 1.5,
                name: "A".into(),
            },
            Monitor {
                rect: rect(3840, 0, 5760, 1080),
                work: rect(3840, 0, 5760, 1040),
                primary: false,
                scale: 1.0,
                name: "B".into(),
            },
        ];
        assert_eq!(to_physical(&mons, 100.0, 200.0), (150, 300));
        // The second monitor starts at 3840 / 1.0 = 3840 DIP.
        assert_eq!(to_physical(&mons, 3850.0, 10.0), (3850, 10));
        assert_eq!(to_dip(&mons, 150, 300), (100.0, 200.0));
        assert_eq!(to_dip(&mons, 3850, 10), (3850.0, 10.0));
    }

    #[cfg(windows)]
    #[test]
    fn single_characters_map_to_keys() {
        use super::win::{resolve, Key};
        assert_eq!(
            resolve("a").unwrap(),
            Key::Vk {
                vk: b'A' as u16,
                ext: false,
                shift: false
            }
        );
        assert!(matches!(
            resolve("A").unwrap(),
            Key::Vk {
                vk: 0x41,
                shift: true,
                ..
            }
        ));
        assert!(matches!(
            resolve("Enter").unwrap(),
            Key::Vk { vk: 0x0D, .. }
        ));
        assert!(matches!(resolve("\u{1F600}").unwrap(), Key::Unicode(_)));
        assert!(resolve("not_a_key").is_err());
    }
}
