//! Image work the Node side used `sharp` for: reading image sizes, making thumbnails,
//! rendering SVG to PNG and encoding JPEG. Run as `everfern --ef-image` with a JSON
//! array of operations on stdin; prints a JSON array with one result per operation.
//! A failed operation gives `{"error": "..."}` in its slot, so one bad file doesn't
//! sink the rest of a batch.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageReader, RgbImage};
use serde_json::{json, Value};
use std::io::Cursor;

/// sharp's `limitInputPixels` used by visual-classification-sheet.
const MAX_INPUT_PIXELS: u64 = 90_000_000;

pub fn run(ops: &[Value]) -> Value {
    Value::Array(
        ops.iter()
            .map(|op| run_one(op).unwrap_or_else(|error| json!({"error": error})))
            .collect(),
    )
}

fn run_one(op: &Value) -> Result<Value, String> {
    match op["op"].as_str().unwrap_or("") {
        "meta" => meta(op),
        "thumb" => thumb(op),
        "svg" => svg(op),
        "jpeg" => jpeg(op),
        other => Err(format!("unknown image op: {other:?}")),
    }
}

/// The image bytes of an op: `data` (base64, a data: URL is fine) or `path`.
fn source(op: &Value) -> Result<Vec<u8>, String> {
    if let Some(data) = op["data"].as_str() {
        let data = data.rsplit(',').next().unwrap_or(data);
        return B64
            .decode(data.trim())
            .map_err(|error| format!("bad base64 image: {error}"));
    }
    let path = op["path"]
        .as_str()
        .ok_or("image op needs `data` or `path`")?;
    std::fs::read(path).map_err(|error| format!("{path}: {error}"))
}

fn dimension(op: &Value, key: &str) -> Result<u32, String> {
    op[key]
        .as_u64()
        .filter(|n| (1..=20_000).contains(n))
        .map(|n| n as u32)
        .ok_or_else(|| format!("`{key}` must be a whole number from 1 to 20000"))
}

fn meta(op: &Value) -> Result<Value, String> {
    let bytes = source(op)?;
    let reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader
        .format()
        .map(|f| f.extensions_str().first().copied().unwrap_or(""))
        .unwrap_or("");
    let (width, height) = reader.into_dimensions().map_err(|e| e.to_string())?;
    Ok(json!({"width": width, "height": height, "format": format}))
}

/// Decodes the first frame and turns it upright using its EXIF orientation, like sharp's `.rotate()`.
fn decode_upright(bytes: &[u8]) -> Result<DynamicImage, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let (w, h) = decoder.dimensions();
    if u64::from(w) * u64::from(h) > MAX_INPUT_PIXELS {
        return Err(format!(
            "image is {w}x{h}, more than {MAX_INPUT_PIXELS} pixels"
        ));
    }
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    Ok(image)
}

/// Lays `image` over white, centred in a `width` x `height` box and scaled (up or down)
/// to fit it: sharp's `resize({fit: 'contain', background: white}).flatten()`.
fn contain_on_white(image: &DynamicImage, width: u32, height: u32) -> RgbImage {
    let scaled = image.resize(width, height, FilterType::Lanczos3).to_rgba8();
    let mut canvas = RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]));
    let left = (width - scaled.width().min(width)) / 2;
    let top = (height - scaled.height().min(height)) / 2;
    for (x, y, px) in scaled.enumerate_pixels() {
        let (cx, cy) = (left + x, top + y);
        if cx >= width || cy >= height {
            continue;
        }
        let alpha = u32::from(px[3]);
        let blend = |c: u8| ((u32::from(c) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        canvas.put_pixel(
            cx,
            cy,
            image::Rgb([blend(px[0]), blend(px[1]), blend(px[2])]),
        );
    }
    canvas
}

fn png_bytes(rgb: &RgbImage, compression: CompressionType) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, compression, PngFilter::Adaptive)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn thumb(op: &Value) -> Result<Value, String> {
    let (width, height) = (dimension(op, "width")?, dimension(op, "height")?);
    let image = decode_upright(&source(op)?)?;
    let png = png_bytes(
        &contain_on_white(&image, width, height),
        CompressionType::Fast,
    )?;
    Ok(json!({"width": width, "height": height, "png": B64.encode(png)}))
}

fn jpeg(op: &Value) -> Result<Value, String> {
    let quality = op["quality"].as_u64().unwrap_or(80).clamp(1, 100) as u8;
    let image = decode_upright(&source(op)?)?;
    // JPEG has no alpha, so transparent parts go white.
    let rgb = contain_on_white(&image, image.width(), image.height());
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok(json!({"width": rgb.width(), "height": rgb.height(), "jpeg": B64.encode(out)}))
}

fn svg(op: &Value) -> Result<Value, String> {
    let text = op["svg"].as_str().ok_or("svg op needs `svg`")?;
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = resvg::usvg::Tree::from_str(text, &options).map_err(|e| format!("bad SVG: {e}"))?;
    let size = tree.size().to_int_size();
    let (width, height) = (size.width(), size.height());
    if u64::from(width) * u64::from(height) > MAX_INPUT_PIXELS {
        return Err(format!("SVG is {width}x{height}, too large to render"));
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height).ok_or("SVG has no size")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::default(),
        &mut pixmap.as_mut(),
    );
    // Flatten onto white so the PNG is opaque RGB, as the sheets always have a background.
    let mut rgb = RgbImage::new(width, height);
    for (px, out) in pixmap.pixels().iter().zip(rgb.pixels_mut()) {
        // Premultiplied: colour + white * (1 - alpha).
        let rest = 255 - u16::from(px.alpha());
        let c = |v: u8| (u16::from(v) + rest).min(255) as u8;
        *out = image::Rgb([c(px.red()), c(px.green()), c(px.blue())]);
    }
    let compression = if op["fast"].as_bool() == Some(true) {
        CompressionType::Fast
    } else {
        CompressionType::Best
    };
    let png = png_bytes(&rgb, compression)?;
    Ok(json!({"width": width, "height": height, "png": B64.encode(png)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_b64(image: &RgbImage) -> String {
        B64.encode(png_bytes(image, CompressionType::Fast).unwrap())
    }

    #[test]
    fn meta_reads_size_from_data_url() {
        let image = RgbImage::new(37, 21);
        let out = run(&[
            json!({"op": "meta", "data": format!("data:image/png;base64,{}", png_b64(&image))}),
        ]);
        assert_eq!(out[0]["width"], 37);
        assert_eq!(out[0]["height"], 21);
        assert_eq!(out[0]["format"], "png");
    }

    #[test]
    fn thumb_letterboxes_on_white() {
        let image = RgbImage::from_pixel(100, 50, image::Rgb([0, 0, 0]));
        let out =
            run(&[json!({"op": "thumb", "data": png_b64(&image), "width": 40, "height": 40})]);
        let bytes = B64.decode(out[0]["png"].as_str().unwrap()).unwrap();
        let thumb = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert_eq!(thumb.dimensions(), (40, 40));
        assert_eq!(thumb.get_pixel(20, 2).0, [255, 255, 255]);
        assert_eq!(thumb.get_pixel(20, 20).0, [0, 0, 0]);
    }

    #[test]
    fn svg_renders_with_embedded_image() {
        let tile = RgbImage::from_pixel(4, 4, image::Rgb([200, 0, 0]));
        let svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="100%" height="100%" fill="#00ff00"/><image x="0" y="0" width="10" height="10" href="data:image/png;base64,{}"/></svg>"##,
            png_b64(&tile)
        );
        let out = run(&[json!({"op": "svg", "svg": svg, "fast": true})]);
        assert_eq!(out[0]["width"], 30);
        let bytes = B64.decode(out[0]["png"].as_str().unwrap()).unwrap();
        let png = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert_eq!(png.get_pixel(25, 15).0, [0, 255, 0]);
        assert_eq!(png.get_pixel(5, 5).0, [200, 0, 0]);
    }

    #[test]
    fn bad_ops_report_errors_in_place() {
        let out = run(&[
            json!({"op": "nope"}),
            json!({"op": "meta", "path": "Z:/does/not/exist.png"}),
        ]);
        assert!(out[0]["error"].as_str().unwrap().contains("unknown"));
        assert!(out[1]["error"].is_string());
    }
}
