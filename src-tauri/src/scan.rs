use std::cmp::Ordering;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Extensions we consider to be timelapse frames. Deliberately conservative:
/// these are all formats the `image` crate can decode for thumbnailing *and*
/// ffmpeg can decode for encoding.
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "png", "tif", "tiff", "bmp", "webp", "gif", "tga",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Seconds since the unix epoch; `None` if the platform did not report it.
    pub modified: Option<u64>,
}

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .map(|e| IMAGE_EXTS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// Compare two file names the way a human would order them, so that
/// `IMG_9.jpg` sorts before `IMG_10.jpg` instead of after it.
///
/// Letter case and zero padding are only *tiebreakers*: they decide the order
/// of names that are otherwise identical, and never outrank a difference in
/// the letters or numbers themselves. Deciding them inline would make `abc`
/// sort after `ABD`, because the case of the first letter would settle the
/// comparison before the `c`/`D` was ever looked at.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    let mut tiebreak = Ordering::Equal;

    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return tiebreak,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ac), Some(bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    // Compare a whole run of digits as a number, so `007` and
                    // `7` stay adjacent instead of sorting characterwise.
                    let a_digits = take_digits(&mut ai);
                    let b_digits = take_digits(&mut bi);
                    let a_trim = a_digits.trim_start_matches('0');
                    let b_trim = b_digits.trim_start_matches('0');
                    let ord = a_trim.len().cmp(&b_trim.len()).then_with(|| a_trim.cmp(b_trim));
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    if tiebreak == Ordering::Equal {
                        tiebreak = a_digits.len().cmp(&b_digits.len());
                    }
                } else {
                    let ord = ac.to_ascii_lowercase().cmp(&bc.to_ascii_lowercase());
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    if tiebreak == Ordering::Equal {
                        tiebreak = ac.cmp(&bc);
                    }
                    ai.next();
                    bi.next();
                }
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    while let Some(c) = it.peek() {
        if c.is_ascii_digit() {
            s.push(*c);
            it.next();
        } else {
            break;
        }
    }
    s
}

/// List every image directly inside `folder` (non-recursive), naturally sorted.
pub fn list_images(folder: &str) -> Result<Vec<ImageEntry>, String> {
    let dir = Path::new(folder);
    if !dir.is_dir() {
        return Err(format!("Not a folder: {folder}"));
    }

    let entries = std::fs::read_dir(dir).map_err(|e| format!("Could not read {folder}: {e}"))?;

    let mut out: Vec<ImageEntry> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_image(&path) {
            continue;
        }
        // Skip macOS resource forks / AppleDouble siblings.
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with("._") => n.to_string(),
            _ => continue,
        };
        let meta = entry.metadata().ok();
        out.push(ImageEntry {
            path: path.to_string_lossy().to_string(),
            name,
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
        });
    }

    out.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(out)
}

/// Pixel dimensions without decoding the whole file.
pub fn image_size(path: &str) -> Result<(u32, u32), String> {
    image::image_dimensions(path).map_err(|e| format!("Could not read image size: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_sort_numerically() {
        let mut v = vec!["IMG_10.jpg", "IMG_9.jpg", "IMG_100.jpg", "IMG_1.jpg"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["IMG_1.jpg", "IMG_9.jpg", "IMG_10.jpg", "IMG_100.jpg"]);
    }

    #[test]
    fn zero_padding_only_breaks_ties() {
        assert_eq!(natural_cmp("a007.jpg", "a7.jpg"), Ordering::Greater);
        assert_eq!(natural_cmp("a07.jpg", "a8.jpg"), Ordering::Less);
    }

    #[test]
    fn letters_outrank_case() {
        // `c` < `D` decides this, even though `a` vs `A` differs first.
        assert_eq!(natural_cmp("abc", "ABD"), Ordering::Less);
        assert_eq!(natural_cmp("abc", "abc"), Ordering::Equal);
    }

    #[test]
    fn later_characters_outrank_padding() {
        // The numbers are equal, so `b` < `c` settles it rather than `07` vs `7`.
        assert_eq!(natural_cmp("a07b.jpg", "a7c.jpg"), Ordering::Less);
    }

    #[test]
    fn ordering_is_total_and_consistent() {
        let names = [
            "IMG_1.jpg", "IMG_01.jpg", "img_1.jpg", "IMG_2.jpg", "IMG_10.jpg", "DSC0001.jpg", "a.jpg",
        ];
        for x in names {
            for y in names {
                assert_eq!(
                    natural_cmp(x, y),
                    natural_cmp(y, x).reverse(),
                    "asymmetric for {x} / {y}"
                );
            }
        }
    }
}
