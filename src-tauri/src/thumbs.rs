use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;

/// Downscaled copies live here so the grid does not have to decode
/// full-resolution frames on every scroll.
pub fn cache_dir(app_cache: &Path) -> PathBuf {
    app_cache.join("thumbs")
}

fn cache_key(src: &Path, max_dim: u32) -> String {
    // Include mtime + size so edited-in-place frames invalidate themselves.
    let (mtime, size) = std::fs::metadata(src)
        .map(|m| {
            let t = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (t, m.len())
        })
        .unwrap_or((0, 0));

    let mut h = DefaultHasher::new();
    src.to_string_lossy().hash(&mut h);
    mtime.hash(&mut h);
    size.hash(&mut h);
    max_dim.hash(&mut h);
    format!("{:016x}-{}.jpg", h.finish(), max_dim)
}

/// Produce (or reuse) a downscaled JPEG for `src` whose longest edge is at most
/// `max_dim`, and return the path to it.
pub fn get_or_create(app_cache: &Path, src: &str, max_dim: u32) -> Result<String, String> {
    let src_path = Path::new(src);
    if !src_path.is_file() {
        return Err(format!("No such file: {src}"));
    }

    let dir = cache_dir(app_cache);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create thumbnail cache: {e}"))?;

    let dest = dir.join(cache_key(src_path, max_dim));
    if dest.is_file() {
        return Ok(dest.to_string_lossy().to_string());
    }

    let img = image::ImageReader::open(src_path)
        .map_err(|e| format!("Could not open {src}: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Could not identify {src}: {e}"))?
        .decode()
        .map_err(|e| format!("Could not decode {src}: {e}"))?;

    let (w, h) = (img.width(), img.height());
    let scaled = if w.max(h) <= max_dim {
        img.to_rgb8()
    } else {
        img.resize(max_dim, max_dim, FilterType::Triangle).to_rgb8()
    };

    // Write to a temp name first so a crash mid-encode cannot leave a
    // truncated JPEG that we would happily serve forever after.
    let tmp = dest.with_extension("part");
    {
        let file =
            std::fs::File::create(&tmp).map_err(|e| format!("Could not write thumbnail: {e}"))?;
        let mut out = BufWriter::new(file);
        JpegEncoder::new_with_quality(&mut out, 82)
            .encode_image(&scaled)
            .map_err(|e| format!("Could not encode thumbnail: {e}"))?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| format!("Could not finalize thumbnail: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

/// Total bytes currently held by the thumbnail cache.
pub fn cache_size(app_cache: &Path) -> u64 {
    let dir = cache_dir(app_cache);
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}

pub fn clear_cache(app_cache: &Path) -> Result<(), String> {
    let dir = cache_dir(app_cache);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Could not clear cache: {e}"))?;
    }
    Ok(())
}
