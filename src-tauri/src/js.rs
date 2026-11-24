//! JavaScript value coercions, for ports that must treat loose tool and IPC input
//! exactly as the TypeScript they replace (`Number(x)`, `String(x)`, truthiness).

use serde_json::Value;

/// `Number(value)`; `None` is `undefined`.
pub fn number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_number(s),
        // Arrays go through their string form: [] -> 0, ["4"] -> 4, [1,2] -> NaN.
        Some(Value::Array(_)) => string_number(&string(value.unwrap())),
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// `Number(text)`.
pub fn string_number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    let radix = |prefixes: &[&str], radix| {
        prefixes
            .iter()
            .find_map(|p| t.strip_prefix(p))
            .map(|digits| u64::from_str_radix(digits, radix).map_or(f64::NAN, |n| n as f64))
    };
    if let Some(n) = radix(&["0x", "0X"], 16)
        .or_else(|| radix(&["0o", "0O"], 8))
        .or_else(|| radix(&["0b", "0B"], 2))
    {
        return n;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // Rust accepts "inf"/"nan" spellings that JavaScript does not.
    if t.chars().any(|c| c.is_ascii_alphabetic() && c != 'e' && c != 'E') {
        return f64::NAN;
    }
    t.parse().unwrap_or(f64::NAN)
}

/// `String(number)`.
pub fn number_string(f: f64) -> String {
    if f.is_nan() {
        return "NaN".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    if f.fract() == 0.0 && f.abs() < 1e21 {
        return format!("{f:.0}").replace("-0", if f == 0.0 { "0" } else { "-0" });
    }
    // JavaScript switches to exponent form outside [1e-6, 1e21): "1e+21", "1.5e-7".
    if f.abs() >= 1e21 || f.abs() < 1e-6 {
        let text = format!("{f:e}");
        return match text.split_once('e') {
            Some((mantissa, exp)) if !exp.starts_with('-') => format!("{mantissa}e+{exp}"),
            _ => text,
        };
    }
    f.to_string()
}

/// `String(value)`.
pub fn string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => number_string(n.as_f64().unwrap_or(f64::NAN)),
        },
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        // Array.prototype.join: null and undefined become "".
        Value::Array(items) => items
            .iter()
            .map(|item| if item.is_null() { String::new() } else { string(item) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `text.length`, which counts UTF-16 units.
pub fn length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `text.slice(0, max)` in UTF-16 units (a split surrogate pair is dropped).
pub fn slice(text: &str, max: usize) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= max
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn coercions_match_javascript() {
        assert_eq!(number(Some(&json!(""))), 0.0);
        assert_eq!(number(Some(&json!(" 0x1A "))), 26.0);
        assert_eq!(number(Some(&json!([]))), 0.0);
        assert_eq!(number(Some(&json!(["4"]))), 4.0);
        assert!(number(Some(&json!([1, 2]))).is_nan());
        assert!(number(Some(&json!("inf"))).is_nan());
        assert!(number(None).is_nan());
        assert_eq!(string(&json!(1e21)), "1e+21");
        assert_eq!(string(&json!(1.5e-7)), "1.5e-7");
        assert_eq!(string(&json!(0.1)), "0.1");
        assert_eq!(string(&json!(-0.0)), "0");
        assert_eq!(string(&json!([1, null, "a"])), "1,,a");
        assert_eq!(string(&json!({})), "[object Object]");
        assert_eq!(slice("ab😀c", 3), "ab");
    }
}
