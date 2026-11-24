//! Screen capture and monitor layout for the sidecar's `desktopCapturer` and `screen`.
//!
//! Runs as a short-lived CLI mode of the main exe (`--ef-displays`, `--ef-capture <n>`)
//! so the Node sidecar can call it synchronously without a WebView round trip.
//! GDI BitBlt per monitor; the PNG goes to stdout.

use serde_json::{json, Value};

#[cfg(windows)]
pub(crate) mod win {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{LPARAM, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::UI::HiDpi::{
        GetDpiForMonitor, SetProcessDpiAwarenessContext,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    pub struct Monitor {
        pub rect: RECT,
        pub work: RECT,
        pub primary: bool,
        pub scale: f64,
        pub name: String,
    }

    unsafe extern "system" fn collect(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> i32 {
        let list = &mut *(data as *mut Vec<HMONITOR>);
        list.push(m);
        1
    }

    pub fn monitors() -> Vec<Monitor> {
        unsafe {
            SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let mut handles: Vec<HMONITOR> = Vec::new();
            EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                Some(collect),
                &mut handles as *mut _ as LPARAM,
            );
            let mut out: Vec<Monitor> = handles
                .into_iter()
                .filter_map(|h| {
                    let mut info: MONITORINFOEXW = std::mem::zeroed();
                    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
                    if GetMonitorInfoW(h, &mut info as *mut _ as *mut MONITORINFO) == 0 {
                        return None;
                    }
                    let (mut dx, mut dy) = (96u32, 96u32);
                    let scale = if GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) == 0 {
                        dx as f64 / 96.0
                    } else {
                        1.0
                    };
                    let len = info
                        .szDevice
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(info.szDevice.len());
                    Some(Monitor {
                        rect: info.monitorInfo.rcMonitor,
                        work: info.monitorInfo.rcWork,
                        primary: info.monitorInfo.dwFlags & 1 != 0,
                        scale,
                        name: String::from_utf16_lossy(&info.szDevice[..len]),
                    })
                })
                .collect();
            // Primary first, like Electron's getAllDisplays()[0] on most setups.
            out.sort_by_key(|m| !m.primary);
            out
        }
    }

    pub fn cursor() -> (i32, i32) {
        let mut p = POINT { x: 0, y: 0 };
        unsafe { GetCursorPos(&mut p) };
        (p.x, p.y)
    }

    /// BGRA pixels of a screen rectangle (physical pixels), top-down.
    pub fn grab(x: i32, y: i32, w: i32, h: i32) -> Result<Vec<u8>, String> {
        unsafe {
            let screen = GetDC(std::ptr::null_mut());
            if screen.is_null() {
                return Err("GetDC failed".into());
            }
            let mem = CreateCompatibleDC(screen);
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp as HGDIOBJ);
            let ok = BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY | CAPTUREBLT);
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = w;
            info.bmiHeader.biHeight = -h; // top-down
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB as _;
            let mut pixels = vec![0u8; (w as usize) * (h as usize) * 4];
            let lines = GetDIBits(
                mem,
                bmp,
                0,
                h as u32,
                pixels.as_mut_ptr() as *mut c_void,
                &mut info,
                DIB_RGB_COLORS,
            );
            SelectObject(mem, old);
            DeleteObject(bmp as HGDIOBJ);
            DeleteDC(mem);
            ReleaseDC(std::ptr::null_mut(), screen);
            if ok == 0 || lines == 0 {
                return Err("screen capture failed".into());
            }
            Ok(pixels)
        }
    }
}

/// Monitor layout in Electron's `Display` shape (bounds in DIPs).
pub fn displays() -> Value {
    #[cfg(windows)]
    {
        let (cx, cy) = win::cursor();
        let list: Vec<Value> = win::monitors()
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let s = m.scale;
                let r = |v: i32| (v as f64 / s).round();
                let (w, h) = (m.rect.right - m.rect.left, m.rect.bottom - m.rect.top);
                let (ww, wh) = (m.work.right - m.work.left, m.work.bottom - m.work.top);
                json!({
                    "id": i + 1,
                    "label": m.name,
                    "primary": m.primary,
                    "bounds": { "x": r(m.rect.left), "y": r(m.rect.top), "width": r(w), "height": r(h) },
                    "workArea": { "x": r(m.work.left), "y": r(m.work.top), "width": r(ww), "height": r(wh) },
                    "size": { "width": r(w), "height": r(h) },
                    "workAreaSize": { "width": r(ww), "height": r(wh) },
                    "physical": { "x": m.rect.left, "y": m.rect.top, "width": w, "height": h },
                    "scaleFactor": s,
                    "rotation": 0,
                    "internal": false,
                    "touchSupport": "unknown",
                })
            })
            .collect();
        json!({ "displays": list, "cursor": { "x": cx, "y": cy } })
    }
    #[cfg(not(windows))]
    json!({ "displays": [], "cursor": { "x": 0, "y": 0 } })
}

/// PNG of monitor `index` (0-based, primary first), at physical resolution.
pub fn capture_png(index: usize) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let mons = win::monitors();
        let m = mons
            .get(index)
            .or_else(|| mons.first())
            .ok_or("no displays")?;
        let (w, h) = (m.rect.right - m.rect.left, m.rect.bottom - m.rect.top);
        let rgb = bgra_to_rgb(&win::grab(m.rect.left, m.rect.top, w, h)?);
        encode_png(&rgb, w as u32, h as u32, png::Compression::Fast)
    }
    #[cfg(not(windows))]
    {
        let _ = index;
        Err("screen capture is only implemented on Windows".into())
    }
}

/// `--ef-screenshot <index> [--max-width N] [--crop x,y,w,h]`, for the computer-use tool
/// (in place of `sharp`). The crop is in physical pixels relative to the monitor; the
/// result is then shrunk (area average) to at most `max-width` wide. Prints JSON with
/// the PNG as base64 plus the monitor's physical size.
pub fn screenshot_cli(args: &[String]) -> Result<Value, String> {
    let index: usize = args.first().and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut max_width = None;
    let mut crop = None;
    let mut rest = args.iter().skip(1);
    while let Some(option) = rest.next() {
        let value = rest
            .next()
            .ok_or_else(|| format!("{option} needs a value"))?;
        match option.as_str() {
            "--max-width" => {
                max_width = Some(
                    value
                        .parse::<u32>()
                        .map_err(|_| format!("bad --max-width {value}"))?,
                )
            }
            "--crop" => {
                let n = value
                    .split(',')
                    .map(|v| v.trim().parse::<i32>())
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| format!("bad --crop {value}"))?;
                let [x, y, w, h] = n[..] else {
                    return Err("--crop needs x,y,w,h".into());
                };
                crop = Some((x, y, w, h));
            }
            other => return Err(format!("unknown option {other}")),
        }
    }
    screenshot(index, max_width, crop)
}

fn screenshot(
    index: usize,
    max_width: Option<u32>,
    crop: Option<(i32, i32, i32, i32)>,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        use base64::Engine;
        let mons = win::monitors();
        let m = mons
            .get(index)
            .or_else(|| mons.first())
            .ok_or("no displays")?;
        let (mw, mh) = (m.rect.right - m.rect.left, m.rect.bottom - m.rect.top);
        if mw < 1 || mh < 1 {
            return Err("display has no size".into());
        }
        let (cx, cy, cw, ch) = match crop {
            Some((x, y, w, h)) => {
                let (x, y) = (x.clamp(0, mw - 1), y.clamp(0, mh - 1));
                (x, y, w.clamp(1, mw - x), h.clamp(1, mh - y))
            }
            None => (0, 0, mw, mh),
        };
        let mut rgb = bgra_to_rgb(&win::grab(m.rect.left + cx, m.rect.top + cy, cw, ch)?);
        let (mut w, mut h) = (cw as usize, ch as usize);
        if let Some(max) = max_width.map(|v| v.max(1) as usize).filter(|max| w > *max) {
            let nh = ((h as f64 * max as f64 / w as f64).round() as usize).max(1);
            rgb = downscale(&rgb, w, h, max, nh);
            (w, h) = (max, nh);
        }
        let png = encode_png(&rgb, w as u32, h as u32, png::Compression::Balanced)?;
        Ok(json!({
            "physicalWidth": mw,
            "physicalHeight": mh,
            "width": w,
            "height": h,
            "png": base64::engine::general_purpose::STANDARD.encode(png),
        }))
    }
    #[cfg(not(windows))]
    {
        let _ = (index, max_width, crop);
        Err("screen capture is only implemented on Windows".into())
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn bgra_to_rgb(bgra: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(bgra.len() / 4 * 3);
    for px in bgra.chunks_exact(4) {
        rgb.extend_from_slice(&[px[2], px[1], px[0]]);
    }
    rgb
}

#[cfg_attr(not(windows), allow(dead_code))]
fn encode_png(rgb: &[u8], w: u32, h: u32, level: png::Compression) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(rgb.len() / 4);
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(level);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgb).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// For each output pixel along one axis: the first source pixel it overlaps and how much
/// of each following source pixel it covers (the weights sum to 1).
#[cfg_attr(not(windows), allow(dead_code))]
fn area_weights(src: usize, dst: usize) -> Vec<(usize, Vec<f32>)> {
    let scale = src as f64 / dst as f64;
    (0..dst)
        .map(|i| {
            let (a, b) = (i as f64 * scale, (i + 1) as f64 * scale);
            let start = a.floor() as usize;
            let end = (b.ceil() as usize).min(src);
            let weights = (start..end)
                .map(|j| ((b.min(j as f64 + 1.0) - a.max(j as f64)) / scale) as f32)
                .collect();
            (start, weights)
        })
        .collect()
}

/// Area-average (box) downscale of packed RGB; keeps small text legible for the model.
#[cfg_attr(not(windows), allow(dead_code))]
fn downscale(rgb: &[u8], w: usize, h: usize, nw: usize, nh: usize) -> Vec<u8> {
    let mut rows = vec![0f32; nw * h * 3];
    let xs = area_weights(w, nw);
    for y in 0..h {
        let src = &rgb[y * w * 3..(y + 1) * w * 3];
        for (ox, (start, weights)) in xs.iter().enumerate() {
            let mut acc = [0f32; 3];
            for (k, wt) in weights.iter().enumerate() {
                let p = (start + k) * 3;
                acc[0] += src[p] as f32 * wt;
                acc[1] += src[p + 1] as f32 * wt;
                acc[2] += src[p + 2] as f32 * wt;
            }
            let o = (y * nw + ox) * 3;
            rows[o..o + 3].copy_from_slice(&acc);
        }
    }
    let mut out = vec![0u8; nw * nh * 3];
    for (oy, (start, weights)) in area_weights(h, nh).iter().enumerate() {
        for i in 0..nw * 3 {
            let mut acc = 0f32;
            for (k, wt) in weights.iter().enumerate() {
                acc += rows[(start + k) * nw * 3 + i] * wt;
            }
            out[oy * nw * 3 + i] = acc.round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn area_weights_cover_each_source_pixel_once() {
        for (src, dst) in [(4, 2), (3, 2), (2560, 1280), (1366, 1280)] {
            let mut total = vec![0f32; src];
            for (start, weights) in area_weights(src, dst) {
                assert!((weights.iter().sum::<f32>() - 1.0).abs() < 1e-4);
                for (k, wt) in weights.iter().enumerate() {
                    total[start + k] += wt;
                }
            }
            let expected = dst as f32 / src as f32;
            assert!(
                total.iter().all(|t| (t - expected).abs() < 1e-4),
                "{src}->{dst}"
            );
        }
    }

    #[test]
    fn downscale_averages_blocks() {
        // 2x2: black, white / white, black -> one mid-grey pixel.
        let px = [0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0];
        assert_eq!(downscale(&px, 2, 2, 1, 1), vec![128, 128, 128]);
        // 3 -> 2 across: [0, 90, 180] -> [30, 150].
        let row = [0, 0, 0, 90, 90, 90, 180, 180, 180];
        assert_eq!(downscale(&row, 3, 1, 2, 1), vec![30, 30, 30, 150, 150, 150]);
    }

    #[test]
    fn screenshot_cli_rejects_bad_options() {
        assert!(screenshot_cli(&["0".into(), "--crop".into(), "1,2,3".into()]).is_err());
        assert!(screenshot_cli(&["0".into(), "--max-width".into()]).is_err());
        assert!(screenshot_cli(&["0".into(), "--bogus".into(), "1".into()]).is_err());
    }
}
